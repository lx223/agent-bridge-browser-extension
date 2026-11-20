import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocketClient from 'ws';
import { describeSafariSupport } from './apiSupport.ts';

export const SAFARI_VERSION = '27.0';

const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${SAFARI_VERSION} Safari/605.1.15`;
const LOAD_MS = 5;
const START_PAGE: Page = { url: '', title: 'Start Page' };

interface Page {
  url: string;
  title: string;
}

interface SimulatedTab {
  id: number;
  pages: Page[];
  position: number;
  active: boolean;
  pinned: boolean;
  status: 'loading' | 'complete';
}

interface SimulatedWindow {
  id: number;
  focused: boolean;
  tabs: SimulatedTab[];
}

export interface SafariTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  active: boolean;
  highlighted: boolean;
  pinned: boolean;
  incognito: boolean;
  audible: boolean;
  mutedInfo: { muted: boolean };
  status: 'loading' | 'complete';
}

export interface SafariWindow {
  id: number;
  focused: boolean;
  incognito: boolean;
  type: 'normal';
  state: 'normal';
  tabs?: SafariTab[];
}

interface TabQuery {
  windowId?: number;
  active?: boolean;
  pinned?: boolean;
  audible?: boolean;
  muted?: boolean;
  title?: string;
  url?: string | string[];
  lastFocusedWindow?: boolean;
  currentWindow?: boolean;
}

interface TabChange {
  url?: string;
  active?: boolean;
  pinned?: boolean;
}

interface Manifest {
  name: string;
  version: string;
  background: { service_worker: string; type?: string };
  action?: { default_title?: string };
}

export interface SimulatedSafariOptions {
  extensionDir: string;
  backgroundSource?: string;
  windows?: string[][];
}

export interface SimulatedSafari {
  origin: string;
  userAgent: string;
  toolbar: { icon: unknown; title: string };
  errors: unknown[];
  tabs(): SafariTab[];
  windows(): SafariWindow[];
  clickToolbarButton(): void;
  fireAlarms(): void;
  sendMessage(message: unknown): Promise<unknown>;
  apiPaths(): string[];
  missingApis(): string[];
  close(): void;
}

type Callback<Args extends unknown[]> = (...args: Args) => unknown;

function createEvent<Args extends unknown[]>(report: (error: unknown) => void) {
  const listeners = new Set<Callback<Args>>();
  return {
    emit(...args: Args) {
      for (const listener of [...listeners]) {
        try {
          void Promise.resolve(listener(...args)).catch(report);
        } catch (error) {
          report(error);
        }
      }
    },
    api: {
      addListener: (listener: Callback<Args>) => void listeners.add(listener),
      removeListener: (listener: Callback<Args>) => void listeners.delete(listener),
      hasListener: (listener: Callback<Args>) => listeners.has(listener),
    },
  };
}

function observed<T extends object>(target: T, path: string, missing: Set<string>): T {
  return new Proxy(target, {
    get(inner, key, receiver) {
      if (typeof key === 'string' && !(key in inner)) missing.add(path ? `${path}.${key}` : key);
      return Reflect.get(inner, key, receiver);
    },
  });
}

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globSource = (glob: string) => glob.split('*').map(escapePattern).join('.*');
const matchesGlob = (glob: string, value: string) => new RegExp(`^${globSource(glob)}$`).test(value);

function matchesUrlPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return true;
  const parts = /^(\*|[a-z-]+):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern);
  if (!parts) throw new Error(`Invalid match pattern: ${pattern}`);
  const [, scheme, host, path] = parts as unknown as [string, string, string, string];
  const schemeSource = scheme === '*' ? 'https?' : escapePattern(scheme);
  const hostSource = host === '*' ? '[^/]*' : host.startsWith('*.') ? `([^/]*\\.)?${escapePattern(host.slice(2))}` : escapePattern(host);
  return new RegExp(`^${schemeSource}://${hostSource}${globSource(path)}$`).test(url);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function startSimulatedSafari(options: SimulatedSafariOptions): SimulatedSafari {
  const manifest = JSON.parse(readFileSync(join(options.extensionDir, 'manifest.json'), 'utf-8')) as Manifest;
  const extensionId = randomUUID().toUpperCase();
  const origin = `safari-web-extension://${extensionId}`;
  const errors: unknown[] = [];
  const report = (error: unknown) => void errors.push(error);
  const missing = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<WebSocketClient>();
  const windows: SimulatedWindow[] = [];
  const stored: Record<string, unknown> = {};
  const alarms = new Set<string>();
  const toolbar = { icon: undefined as unknown, title: manifest.action?.default_title ?? manifest.name };
  let closed = false;
  let nextId = 1;

  const onInstalled = createEvent<[{ reason: string }]>(report);
  const onMessage = createEvent<[unknown, { id: string; url: string }, (response: unknown) => void]>(report);
  const onClicked = createEvent<[SafariTab | undefined]>(report);
  const onAlarm = createEvent<[{ name: string }]>(report);
  const onStorageChanged = createEvent<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>(report);
  const onTabUpdated = createEvent<[number, { status: string }, SafariTab]>(report);
  const onTabRemoved = createEvent<[number, { windowId: number; isWindowClosing: boolean }]>(report);

  const guarded = (callback: (...args: unknown[]) => void) => (...args: unknown[]) => {
    try {
      callback(...args);
    } catch (error) {
      report(error);
    }
  };
  const scheduleOnce = (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (closed) return undefined;
    const timer = setTimeout(guarded(callback), ms, ...args);
    timers.add(timer);
    return timer;
  };
  const scheduleRepeating = (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (closed) return undefined;
    const timer = setInterval(guarded(callback), ms, ...args);
    timers.add(timer);
    return timer;
  };

  class ExtensionSocket extends WebSocketClient {
    constructor(url: string) {
      super(url, { origin });
      this.on('error', () => {});
      sockets.add(this);
    }
  }

  const titleOf = (url: string) => {
    if (url.startsWith(origin)) return manifest.name;
    try {
      const { host, pathname } = new URL(url);
      return `${host}${pathname}`;
    } catch {
      return url;
    }
  };
  const pageAt = (url: string): Page => ({ url, title: titleOf(url) });

  const windowOf = (tab: SimulatedTab) => windows.find((candidate) => candidate.tabs.includes(tab))!;
  const allTabs = () => windows.flatMap((window) => window.tabs);
  const focusedWindow = () => windows.find((window) => window.focused) ?? windows[0];

  const findTab = (id: number) => {
    const tab = allTabs().find((candidate) => candidate.id === id);
    if (!tab) throw new Error(`Invalid tab ID: ${id}`);
    return tab;
  };
  const findWindow = (id: number) => {
    const window = windows.find((candidate) => candidate.id === id);
    if (!window) throw new Error(`Invalid window ID: ${id}`);
    return window;
  };

  const describeTab = (tab: SimulatedTab): SafariTab => {
    const window = windowOf(tab);
    const page = tab.pages[tab.position]!;
    return {
      id: tab.id,
      windowId: window.id,
      index: window.tabs.indexOf(tab),
      url: page.url,
      title: page.title,
      active: tab.active,
      highlighted: tab.active,
      pinned: tab.pinned,
      incognito: false,
      audible: false,
      mutedInfo: { muted: false },
      status: tab.status,
    };
  };
  const describeWindow = (window: SimulatedWindow, populate: boolean): SafariWindow => ({
    id: window.id,
    focused: window.focused,
    incognito: false,
    type: 'normal',
    state: 'normal',
    ...(populate && { tabs: window.tabs.map(describeTab) }),
  });

  const activate = (tab: SimulatedTab) => {
    for (const sibling of windowOf(tab).tabs) sibling.active = sibling === tab;
  };
  const focus = (window: SimulatedWindow) => {
    for (const candidate of windows) candidate.focused = candidate === window;
  };
  const settle = (window: SimulatedWindow, preferredIndex = 0) => {
    if (!window.tabs.length) {
      windows.splice(windows.indexOf(window), 1);
      if (window.focused && windows[0]) focus(windows[0]);
      return;
    }
    if (!window.tabs.some((tab) => tab.active)) window.tabs[Math.min(preferredIndex, window.tabs.length - 1)]!.active = true;
  };

  const addTab = (window: SimulatedWindow, page: Page, active: boolean) => {
    const tab: SimulatedTab = { id: nextId++, pages: [page], position: 0, active: false, pinned: false, status: 'complete' };
    window.tabs.push(tab);
    if (active || window.tabs.length === 1) activate(tab);
    return tab;
  };
  const addWindow = (pages: Page[]) => {
    const window: SimulatedWindow = { id: nextId++, focused: false, tabs: [] };
    windows.push(window);
    pages.forEach((page, index) => addTab(window, page, index === 0));
    focus(window);
    return window;
  };

  const load = (tab: SimulatedTab) => {
    tab.status = 'loading';
    scheduleOnce(() => {
      if (!allTabs().includes(tab)) return;
      tab.status = 'complete';
      onTabUpdated.emit(tab.id, { status: 'complete' }, describeTab(tab));
    }, LOAD_MS);
  };
  const visit = (tab: SimulatedTab, url: string) => {
    tab.pages = [...tab.pages.slice(0, tab.position + 1), pageAt(url)];
    tab.position = tab.pages.length - 1;
    load(tab);
  };
  const step = (id: number, offset: number) => {
    const tab = findTab(id);
    if (!tab.pages[tab.position + offset]) throw new Error('The tab has no page to go to in that direction.');
    tab.position += offset;
    load(tab);
  };

  const queryTabs = (query: TabQuery = {}) => {
    const focused = focusedWindow();
    const patterns = query.url === undefined ? undefined : [query.url].flat();
    const inFocusedWindow = query.lastFocusedWindow ?? query.currentWindow;
    return allTabs()
      .map(describeTab)
      .filter(
        (tab) =>
          (query.windowId === undefined || tab.windowId === query.windowId) &&
          (query.active === undefined || tab.active === query.active) &&
          (query.pinned === undefined || tab.pinned === query.pinned) &&
          (query.audible === undefined || tab.audible === query.audible) &&
          (query.muted === undefined || tab.mutedInfo.muted === query.muted) &&
          (query.title === undefined || matchesGlob(query.title, tab.title)) &&
          (patterns === undefined || patterns.some((pattern) => matchesUrlPattern(pattern, tab.url))) &&
          (inFocusedWindow === undefined || (tab.windowId === focused?.id) === inFocusedWindow),
      );
  };

  const createTab = ({ url, windowId, active = true }: { url?: string; windowId?: number; active?: boolean } = {}) => {
    const window = windowId === undefined ? (focusedWindow() ?? addWindow([])) : findWindow(windowId);
    const tab = addTab(window, url === undefined ? START_PAGE : pageAt(url), active);
    load(tab);
    return describeTab(tab);
  };

  const updateTab = (id: number, change: TabChange) => {
    const tab = findTab(id);
    if (change.active) activate(tab);
    if (change.pinned !== undefined) tab.pinned = change.pinned;
    if (change.url !== undefined) visit(tab, change.url);
    return describeTab(tab);
  };

  const removeTabs = (ids: number | number[]) => {
    for (const tab of [ids].flat().map(findTab)) {
      const window = windowOf(tab);
      const index = window.tabs.indexOf(tab);
      window.tabs.splice(index, 1);
      onTabRemoved.emit(tab.id, { windowId: window.id, isWindowClosing: window.tabs.length === 0 });
      settle(window, index);
    }
  };

  const moveTabs = (ids: number | number[], { index, windowId }: { index: number; windowId?: number }) => {
    const moved = [ids].flat().map(findTab);
    const destination = windowId === undefined ? undefined : findWindow(windowId);
    moved.forEach((tab, offset) => {
      const from = windowOf(tab);
      const to = destination ?? from;
      const previousIndex = from.tabs.indexOf(tab);
      from.tabs.splice(previousIndex, 1);
      if (to !== from) tab.active = false;
      to.tabs.splice(index === -1 ? to.tabs.length : Math.min(index + offset, to.tabs.length), 0, tab);
      settle(to);
      if (to !== from) settle(from, previousIndex);
    });
    const described = moved.map(describeTab);
    return Array.isArray(ids) ? described : described[0];
  };

  const readStorage = (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === undefined || keys === null) return structuredClone(stored);
    const defaults = typeof keys === 'string' || Array.isArray(keys) ? {} : keys;
    const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const found: Record<string, unknown> = structuredClone(defaults);
    for (const name of names) if (name in stored) found[name] = structuredClone(stored[name]);
    return found;
  };
  const writeStorage = (items: Record<string, unknown>) => {
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [name, value] of Object.entries(items)) {
      changes[name] = { ...(name in stored && { oldValue: stored[name] }), newValue: structuredClone(value) };
      stored[name] = structuredClone(value);
    }
    onStorageChanged.emit(changes, 'local');
  };
  const clearStorage = (keys: string | string[]) => {
    const changes: Record<string, { oldValue?: unknown }> = {};
    for (const name of [keys].flat()) {
      if (!(name in stored)) continue;
      changes[name] = { oldValue: stored[name] };
      delete stored[name];
    }
    if (Object.keys(changes).length) onStorageChanged.emit(changes, 'local');
  };

  const api = {
    runtime: {
      id: extensionId,
      getURL: (path = '') => `${origin}/${path.replace(/^\//, '')}`,
      getManifest: () => structuredClone(manifest),
      sendMessage: async () => undefined,
      setUninstallURL: async () => undefined,
      onInstalled: onInstalled.api,
      onMessage: onMessage.api,
    },
    action: {
      setIcon: async ({ path }: { path: unknown }) => void (toolbar.icon = path),
      setTitle: async ({ title }: { title: string }) => void (toolbar.title = title),
      onClicked: onClicked.api,
    },
    alarms: {
      create: async (name: string) => void alarms.add(name),
      onAlarm: onAlarm.api,
    },
    storage: {
      local: {
        get: async (keys?: string | string[] | Record<string, unknown> | null) => readStorage(keys),
        set: async (items: Record<string, unknown>) => writeStorage(items),
        remove: async (keys: string | string[]) => clearStorage(keys),
      },
      onChanged: onStorageChanged.api,
    },
    windows: {
      getAll: async ({ populate = false }: { populate?: boolean } = {}) => windows.map((window) => describeWindow(window, populate)),
    },
    tabs: {
      query: async (query?: TabQuery) => queryTabs(query),
      get: async (id: number) => describeTab(findTab(id)),
      create: async (properties?: { url?: string; windowId?: number; active?: boolean }) => createTab(properties),
      update: async (id: number, change: TabChange) => updateTab(id, change),
      remove: async (ids: number | number[]) => removeTabs(ids),
      move: async (ids: number | number[], properties: { index: number; windowId?: number }) => moveTabs(ids, properties),
      reload: async (id: number) => load(findTab(id)),
      goBack: async (id: number) => step(id, -1),
      goForward: async (id: number) => step(id, 1),
      onUpdated: onTabUpdated.api,
      onRemoved: onTabRemoved.api,
    },
  };

  const namespaces = Object.fromEntries(
    Object.entries(api).map(([name, namespace]) => [name, observed(namespace, name, missing)]),
  );
  const extensionApi = observed(namespaces, '', missing);

  const missingApis = () => [...missing].map(describeSafariSupport);

  const close = () => {
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.terminate();
  };

  for (const urls of options.windows ?? [[]]) addWindow(urls.length ? urls.map(pageAt) : [START_PAGE]);

  try {
    if (manifest.background.type === 'module') throw new Error('Safari does not load module service workers.');
    const source = options.backgroundSource ?? readFileSync(join(options.extensionDir, manifest.background.service_worker), 'utf-8');
    const run = new Function('chrome', 'browser', 'WebSocket', 'navigator', 'fetch', 'setTimeout', 'setInterval', source);
    run(
      extensionApi,
      extensionApi,
      ExtensionSocket,
      { userAgent: USER_AGENT },
      async () => Promise.reject(new Error('The simulated Safari has no network access.')),
      scheduleOnce,
      scheduleRepeating,
    );
  } catch (error) {
    close();
    const lookedFor = missingApis();
    const detail = lookedFor.length ? `\nExtension APIs it looked for that the simulated Safari does not offer:\n- ${lookedFor.join('\n- ')}` : '';
    throw new Error(`The background script failed to start in the simulated Safari: ${messageOf(error)}${detail}`, { cause: error });
  }

  scheduleOnce(() => onInstalled.emit({ reason: 'install' }), 0);

  return {
    origin,
    userAgent: USER_AGENT,
    toolbar,
    errors,
    tabs: () => allTabs().map(describeTab),
    windows: () => windows.map((window) => describeWindow(window, true)),
    clickToolbarButton: () => {
      const window = focusedWindow();
      const active = window?.tabs.find((tab) => tab.active);
      onClicked.emit(active && describeTab(active));
    },
    fireAlarms: () => {
      for (const name of alarms) onAlarm.emit({ name });
    },
    sendMessage: (message) =>
      new Promise((resolve) => {
        let answered = false;
        onMessage.emit(message, { id: extensionId, url: `${origin}/src/welcome/index.html` }, (response) => {
          answered = true;
          resolve(response);
        });
        if (!answered) resolve(undefined);
      }),
    apiPaths: () => Object.entries(api).flatMap(([name, namespace]) => Object.keys(namespace).map((member) => `${name}.${member}`)),
    missingApis,
    close,
  };
}
