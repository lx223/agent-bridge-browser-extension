import {
  SET_INSTANCE_NAME_METHOD,
  setInstanceNameParams,
  toolDefinitions,
  type GroupColor,
  type Method,
  type ParamsOf,
} from '@agent-browser-bridge/protocol';
import { instanceId, saveInstanceName } from './browser.ts';
import { toChromeColor } from './color.ts';
import { navigateTab, openTab } from './navigation.ts';
import {
  cdpDetach,
  cdpSend,
  click,
  evaluateHandler,
  hover,
  pressKeyHandler,
  screenshot,
  scroll,
  snapshot,
  typeText,
  waitFor,
} from './page.ts';
import { callPageTool, listPageTools } from './pageTools.ts';
import { applyPlan, undoLastPlan } from './plan.ts';
import { serializeDevice, serializeGroup, serializeSession, serializeTab, serializeWindow, serializeWindowWithTabs } from './serialize.ts';

type Handlers = { [M in Method]: (params: ParamsOf<M>) => Promise<unknown> };
type NonEmpty = [number, ...number[]];

const groupUpdate = (p: { title?: string; color?: GroupColor; collapsed?: boolean }): chrome.tabGroups.UpdateProperties => ({
  ...(p.title !== undefined && { title: p.title }),
  ...(p.color !== undefined && { color: toChromeColor(p.color) }),
  ...(p.collapsed !== undefined && { collapsed: p.collapsed }),
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const definedOnly = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

export const handlers: Handlers = {
  'windows.list': async () => (await chrome.windows.getAll({ populate: true })).map(serializeWindow),

  'windows.create': async (p) => {
    const win = await chrome.windows.create(definedOnly(p));
    return serializeWindowWithTabs(win!);
  },

  'windows.update': async ({ windowId, ...update }) => serializeWindow(await chrome.windows.update(windowId, definedOnly(update))),

  'windows.remove': async ({ windowId }) => {
    await chrome.windows.remove(windowId);
    return { closed: windowId };
  },

  'tabs.list': async (p) => (await chrome.tabs.query(definedOnly(p))).map(serializeTab),

  'tabGroups.list': async ({ windowId }) => {
    const filter = windowId === undefined ? {} : { windowId };
    const [groups, tabs] = await Promise.all([chrome.tabGroups.query(filter), chrome.tabs.query(filter)]);
    return groups.map((g) => serializeGroup(g, tabs));
  },

  'tabs.group': async (p) => {
    const groupId = await chrome.tabs.group({
      tabIds: p.tabIds as NonEmpty,
      ...(p.groupId !== undefined ? { groupId: p.groupId } : p.windowId !== undefined ? { createProperties: { windowId: p.windowId } } : {}),
    });
    const update = groupUpdate(p);
    const group = Object.keys(update).length ? await chrome.tabGroups.update(groupId, update) : await chrome.tabGroups.get(groupId);
    return serializeGroup(group!, await chrome.tabs.query({ windowId: group!.windowId }));
  },

  'tabGroups.update': async (p) => {
    const group = await chrome.tabGroups.update(p.groupId, groupUpdate(p));
    return serializeGroup(group!, await chrome.tabs.query({ windowId: group!.windowId }));
  },

  'tabs.ungroup': async ({ tabIds }) => {
    await chrome.tabs.ungroup(tabIds as NonEmpty);
    return { ungrouped: tabIds };
  },

  'tabs.move': async ({ tabIds, index, windowId }) => {
    const moved = await chrome.tabs.move(tabIds, { index, ...(windowId !== undefined && { windowId }) });
    return (Array.isArray(moved) ? moved : [moved]).map(serializeTab);
  },

  'tabGroups.move': async ({ groupId, index, windowId }) => {
    const group = await chrome.tabGroups.move(groupId, { index, ...(windowId !== undefined && { windowId }) });
    return group ? serializeGroup(group, await chrome.tabs.query({ windowId: group.windowId })) : null;
  },

  'tabs.close': async ({ tabIds }) => {
    await chrome.tabs.remove(tabIds);
    return { closed: tabIds };
  },

  'tabs.update': async ({ tabId, ...update }) => serializeTab((await chrome.tabs.update(tabId, definedOnly(update)))!),

  'tabs.discard': async ({ tabIds }) => {
    const results = await Promise.allSettled(tabIds.map((id) => chrome.tabs.discard(id)));
    const discarded: ReturnType<typeof serializeTab>[] = [];
    const failed: { tabId: number; error: string }[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) discarded.push(serializeTab(result.value));
      else failed.push({ tabId: tabIds[i]!, error: result.status === 'rejected' ? messageOf(result.reason) : 'The browser did not discard the tab.' });
    });
    return { discarded, failed };
  },

  'tabs.duplicate': async ({ tabId }) => serializeTab((await chrome.tabs.duplicate(tabId))!),

  'history.search': (query) => chrome.history.search(query),
  'history.getVisits': ({ url }) => chrome.history.getVisits({ url }),

  'sessions.getRecentlyClosed': async ({ maxResults }) => (await chrome.sessions.getRecentlyClosed({ maxResults })).map(serializeSession),
  'sessions.getDevices': async ({ maxResults }) => (await chrome.sessions.getDevices({ maxResults })).map(serializeDevice),
  'sessions.restore': async ({ sessionId }) => serializeSession(await chrome.sessions.restore(sessionId)),

  'plan.apply': applyPlan,
  'plan.undo': undoLastPlan,

  'tabs.create': openTab,
  'tabs.navigate': navigateTab,
  'page.snapshot': snapshot,
  'page.click': click,
  'page.hover': hover,
  'page.type': typeText,
  'page.pressKey': pressKeyHandler,
  'page.scroll': scroll,
  'page.screenshot': screenshot,
  'page.waitFor': waitFor,
  'page.evaluate': evaluateHandler,
  'page.listTools': listPageTools,
  'page.callTool': callPageTool,
  'cdp.send': cdpSend,
  'cdp.detach': cdpDetach,
};

/** Validates params against the shared schema, then runs the handler. */
async function setInstanceName(params: unknown) {
  const parsed = setInstanceNameParams.safeParse(params ?? {});
  if (!parsed.success) throw new Error(`Invalid params for ${SET_INSTANCE_NAME_METHOD}: ${parsed.error.message}`);
  const name = await saveInstanceName(chrome.storage.local, parsed.data.name);
  return { instanceId: await instanceId(chrome.storage.local), name };
}

export async function dispatch(method: string, params: unknown): Promise<unknown> {
  if (method === SET_INSTANCE_NAME_METHOD) return setInstanceName(params);
  if (!(method in toolDefinitions)) throw new Error(`Unknown method: ${method}`);
  const m = method as Method;
  const parsed = toolDefinitions[m].params.safeParse(params ?? {});
  if (!parsed.success) throw new Error(`Invalid params for ${method}: ${parsed.error.message}`);
  return (handlers[m] as (p: unknown) => Promise<unknown>)(parsed.data);
}
