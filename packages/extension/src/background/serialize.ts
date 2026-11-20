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
    muted: tab.mutedInfo?.muted ?? false,
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

export function serializeWindowWithTabs(win: chrome.windows.Window) {
  return { ...serializeWindow(win), tabs: (win.tabs ?? []).map(serializeTab) };
}

function serializeSessionTab(tab: chrome.tabs.Tab) {
  return { ...serializeTab(tab), sessionId: tab.sessionId };
}

export function serializeSession(session: chrome.sessions.Session) {
  return {
    lastModified: session.lastModified,
    ...(session.tab && { tab: serializeSessionTab(session.tab) }),
    ...(session.window && {
      window: { ...serializeWindow(session.window), sessionId: session.window.sessionId, tabs: (session.window.tabs ?? []).map(serializeSessionTab) },
    }),
  };
}

export function serializeDevice(device: chrome.sessions.Device) {
  return { deviceName: device.deviceName, sessions: device.sessions.map(serializeSession) };
}
