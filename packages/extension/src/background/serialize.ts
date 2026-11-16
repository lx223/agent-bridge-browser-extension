const NO_GROUP = -1;

export function serializeTab(tab: chrome.tabs.Tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title,
    url: tab.url ?? tab.pendingUrl,
    groupId: tab.groupId === NO_GROUP ? null : tab.groupId,
    pinned: tab.pinned,
    active: tab.active,
    audible: tab.audible ?? false,
    discarded: tab.discarded,
    lastAccessed: tab.lastAccessed,
  };
}

export function serializeGroup(group: chrome.tabGroups.TabGroup, tabs: chrome.tabs.Tab[]) {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title ?? '',
    color: group.color,
    collapsed: group.collapsed,
    tabIds: tabs.filter((t) => t.groupId === group.id).map((t) => t.id),
  };
}

export function serializeWindow(win: chrome.windows.Window) {
  return {
    id: win.id,
    focused: win.focused,
    type: win.type,
    state: win.state,
    incognito: win.incognito,
    tabCount: win.tabs?.length ?? 0,
  };
}
