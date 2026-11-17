import type { GroupColor, ParamsOf } from '@agent-browser-bridge/protocol';
import { toChromeColor } from './color.ts';

type PlanParams = ParamsOf<'plan.apply'>;
const NO_GROUP = -1;
const SNAPSHOT_KEY = 'lastPlanSnapshot';

interface Snapshot {
  takenAt: number;
  tabs: { id: number; windowId: number; index: number; groupId: number }[];
  groups: { id: number; windowId: number; title: string; color: GroupColor; collapsed: boolean }[];
}

type Action =
  | { action: 'ungroup'; tabIds: number[] }
  | { action: 'addToGroup'; groupId: number; title: string; tabIds: number[] }
  | { action: 'createGroup'; title: string; windowId: number; tabIds: number[] };

async function takeSnapshot(): Promise<Snapshot> {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  return {
    takenAt: Date.now(),
    tabs: tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({ id: t.id!, windowId: t.windowId, index: t.index, groupId: t.groupId })),
    groups: groups.map((g) => ({ id: g.id, windowId: g.windowId, title: g.title ?? '', color: g.color as GroupColor, collapsed: g.collapsed })),
  };
}

/** Works out what applying the plan would do, without touching the browser. */
async function resolvePlan(plan: PlanParams) {
  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const tabById = new Map(tabs.filter((t) => t.id !== undefined).map((t) => [t.id!, t]));
  const warnings: string[] = [];
  const claimed = new Map<number, string>();
  const usable = (id: number, title: string) => {
    const tab = tabById.get(id);
    if (!tab) return warnings.push(`Tab ${id} no longer exists; skipped.`), false;
    if (tab.pinned) return warnings.push(`Tab ${id} is pinned and cannot be grouped; skipped.`), false;
    const prior = claimed.get(id);
    if (prior !== undefined) return warnings.push(`Tab ${id} is listed in both "${prior}" and "${title}"; kept in "${prior}".`), false;
    claimed.set(id, title);
    return true;
  };

  const actions: Action[] = [];
  const ungroup = plan.ungroupTabIds.filter((id) => tabById.has(id) && tabById.get(id)!.groupId !== NO_GROUP);
  if (ungroup.length) actions.push({ action: 'ungroup', tabIds: ungroup });

  for (const g of plan.groups) {
    const tabIds = g.tabIds.filter((id) => usable(id, g.title));
    if (!tabIds.length) {
      warnings.push(`Group "${g.title}" has no usable tabs; skipped.`);
      continue;
    }
    const windowId = plan.windowId ?? tabById.get(tabIds[0])!.windowId;
    const existing = groups.find((eg) => eg.title === g.title && (plan.windowId === undefined || eg.windowId === windowId));
    actions.push(
      existing
        ? { action: 'addToGroup', groupId: existing.id, title: g.title, tabIds }
        : { action: 'createGroup', title: g.title, windowId, tabIds },
    );
  }
  return { actions, warnings };
}

export async function applyPlan(plan: PlanParams) {
  const { actions, warnings } = await resolvePlan(plan);
  if (plan.dryRun) return { dryRun: true, actions, warnings };

  await chrome.storage.session.set({ [SNAPSHOT_KEY]: await takeSnapshot() });

  const groups: { title: string; groupId: number; tabCount: number }[] = [];
  for (const step of actions) {
    if (step.action === 'ungroup') {
      await chrome.tabs.ungroup(step.tabIds as [number, ...number[]]);
      continue;
    }
    const spec = plan.groups.find((g) => g.title === step.title)!;
    const tabIds = step.tabIds as [number, ...number[]];
    const groupId =
      step.action === 'addToGroup'
        ? await chrome.tabs.group({ groupId: step.groupId, tabIds })
        : await chrome.tabs.group({ tabIds, createProperties: { windowId: step.windowId } });
    await chrome.tabGroups.update(groupId, {
      title: spec.title,
      ...(spec.color && { color: toChromeColor(spec.color) }),
      ...(spec.collapsed !== undefined && { collapsed: spec.collapsed }),
    });
    groups.push({ title: spec.title, groupId, tabCount: tabIds.length });
  }
  return { applied: true, groups, warnings, undo: 'Call chrome_undo_last_plan to restore the previous layout.' };
}

export async function undoLastPlan() {
  const stored = (await chrome.storage.session.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as Snapshot | undefined;
  if (!stored) throw new Error('Nothing to undo: no chrome_apply_tab_plan has run since the browser started.');

  const current = await chrome.tabs.query({});
  const currentIds = new Set(current.map((t) => t.id));
  const windowIds = new Set(current.map((t) => t.windowId));
  const warnings: string[] = [];
  const tabs = stored.tabs.filter((t) => currentIds.has(t.id));
  const missing = stored.tabs.length - tabs.length;
  if (missing) warnings.push(`${missing} tab(s) were closed since the plan was applied and cannot be restored.`);

  // 1. Clear grouping on the tabs we know about.
  const grouped = current.filter((t) => t.groupId !== NO_GROUP && t.id !== undefined && tabs.some((s) => s.id === t.id));
  if (grouped.length) await chrome.tabs.ungroup(grouped.map((t) => t.id!) as [number, ...number[]]);

  // 2. Put tabs back in their original window and order.
  for (const t of [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    if (!windowIds.has(t.windowId)) {
      warnings.push(`Window ${t.windowId} is gone; tab ${t.id} left where it is.`);
      continue;
    }
    await chrome.tabs.move(t.id, { windowId: t.windowId, index: t.index });
  }

  // 3. Recreate the original groups.
  let restoredGroups = 0;
  for (const g of stored.groups) {
    const members = tabs.filter((t) => t.groupId === g.id).map((t) => t.id);
    if (!members.length) continue;
    const createProperties = windowIds.has(g.windowId) ? { windowId: g.windowId } : undefined;
    const groupId = await chrome.tabs.group({ tabIds: members as [number, ...number[]], createProperties });
    await chrome.tabGroups.update(groupId, { title: g.title, color: toChromeColor(g.color), collapsed: g.collapsed });
    restoredGroups++;
  }

  await chrome.storage.session.remove(SNAPSHOT_KEY);
  return { restored: true, tabs: tabs.length, groups: restoredGroups, warnings };
}
