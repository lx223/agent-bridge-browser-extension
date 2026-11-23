import { englishI18n } from './englishI18n.ts';

/**
 * Minimal in-memory model of chrome.tabs / chrome.tabGroups / chrome.storage.session,
 * enough to exercise plan logic. Tab order within a window is the array order.
 */
interface FakeTab { id: number; windowId: number; groupId: number; pinned: boolean; title: string; url: string }
interface FakeGroup { id: number; windowId: number; title: string; color: string; collapsed: boolean }

function storageArea(items: () => Record<string, unknown>) {
  const keyList = (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]);
  return {
    set: async (next: Record<string, unknown>) => void Object.assign(items(), structuredClone(next)),
    get: async (keys: string | string[]) =>
      Object.fromEntries(keyList(keys).flatMap((key) => (key in items() ? [[key, structuredClone(items()[key])]] : []))),
    remove: async (keys: string | string[]) => keyList(keys).forEach((key) => delete items()[key]),
  };
}

export function installFakeChrome(tabs: Partial<FakeTab>[], groups: Partial<FakeGroup>[] = []) {
  const state = {
    tabs: tabs.map((t, i) => ({ id: i + 1, windowId: 1, groupId: -1, pinned: false, title: `Tab ${i + 1}`, url: `https://example.com/${i + 1}`, ...t })),
    groups: groups.map((g, i) => ({ id: 100 + i, windowId: 1, title: '', color: 'grey', collapsed: false, ...g })),
    session: {} as Record<string, unknown>,
    local: {} as Record<string, unknown>,
    nextGroupId: 200,
  };

  const indexed = () => {
    const counters = new Map<number, number>();
    return state.tabs.map((t) => {
      const index = counters.get(t.windowId) ?? 0;
      counters.set(t.windowId, index + 1);
      return { ...t, index } as unknown as chrome.tabs.Tab;
    });
  };
  const pruneGroups = () => (state.groups = state.groups.filter((g) => state.tabs.some((t) => t.groupId === g.id)));
  const tab = (id: number) => {
    const t = state.tabs.find((x) => x.id === id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return t;
  };
  const moveTo = (id: number, windowId: number, index: number) => {
    const t = tab(id);
    state.tabs.splice(state.tabs.indexOf(t), 1);
    t.windowId = windowId;
    const inWindow = state.tabs.filter((x) => x.windowId === windowId);
    const anchor = index < 0 || index >= inWindow.length ? undefined : inWindow[index];
    state.tabs.splice(anchor ? state.tabs.indexOf(anchor) : state.tabs.length, 0, t);
  };

  const fake = {
    i18n: englishI18n,
    tabs: {
      query: async (q: { windowId?: number }) => indexed().filter((t) => q.windowId === undefined || t.windowId === q.windowId),
      group: async (opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        let group = opts.groupId !== undefined ? state.groups.find((g) => g.id === opts.groupId) : undefined;
        if (opts.groupId !== undefined && !group) throw new Error(`No group with id: ${opts.groupId}.`);
        if (!group) {
          const windowId = opts.createProperties?.windowId ?? tab(opts.tabIds[0]).windowId;
          group = { id: state.nextGroupId++, windowId, title: '', color: 'grey', collapsed: false };
          state.groups.push(group);
        }
        for (const id of opts.tabIds) {
          if (tab(id).pinned) throw new Error('Cannot group pinned tabs');
          // Like Chrome: a new group forms where its first tab is; later tabs
          // are moved to sit right after the group's last tab.
          const members = state.tabs.filter((t) => t.groupId === group.id && t.id !== id);
          const last = members.at(-1);
          const t = tab(id);
          if (!last && t.windowId === group.windowId) {
            t.groupId = group.id;
            continue;
          }
          state.tabs.splice(state.tabs.indexOf(t), 1);
          t.windowId = group.windowId;
          t.groupId = group.id;
          state.tabs.splice(last ? state.tabs.indexOf(last) + 1 : state.tabs.length, 0, t);
        }
        pruneGroups();
        return group.id;
      },
      ungroup: async (ids: number[]) => {
        for (const id of ids) tab(id).groupId = -1;
        pruneGroups();
      },
      move: async (id: number, props: { windowId?: number; index: number }) => moveTo(id, props.windowId ?? tab(id).windowId, props.index),
    },
    tabGroups: {
      query: async () => state.groups.map((g) => ({ ...g })),
      update: async (id: number, props: Partial<FakeGroup>) => {
        const g = state.groups.find((x) => x.id === id);
        if (!g) throw new Error(`No group with id: ${id}.`);
        Object.assign(g, props);
        return { ...g };
      },
    },
    storage: {
      session: storageArea(() => state.session),
      local: storageArea(() => state.local),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fake;

  /** Readable layout: per window, tabs in order with their group title. */
  const layout = () =>
    [...new Set(state.tabs.map((t) => t.windowId))].map((w) =>
      state.tabs
        .filter((t) => t.windowId === w)
        .map((t) => `${t.id}${t.groupId === -1 ? '' : `:${state.groups.find((g) => g.id === t.groupId)!.title}`}`)
        .join(' '),
    );

  return { state, layout };
}
