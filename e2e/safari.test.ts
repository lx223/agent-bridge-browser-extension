import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDENTIFY_INSTANCES_TOOL, NAME_INSTANCE_TOOL, PROTOCOL_VERSION } from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startAgent, testBridge, type Agent, type Tab } from './harness.ts';
import { COMPAT_DATA_VERSION, compareVersions, safariSupport } from './safari/apiSupport.ts';
import { openSetupPageAsSafari } from './safari/setupPage.ts';
import { SAFARI_VERSION, startSimulatedSafari, type SimulatedSafari } from './safari/simulatedSafari.ts';

const NEWS = 'https://news.example.com/today';
const DOCS = 'https://docs.example.com/guide';
const SHOP = 'https://shop.example.org/cart';

interface WindowSummary {
  id: number;
  focused: boolean;
  type: string;
  state: string;
  incognito: boolean;
  tabCount: number;
}

let agent: Agent;
let safari: SimulatedSafari;
let extensionDir: string;

const welcomePage = () => `${safari.origin}/src/welcome/index.html`;
const browserUrls = () => safari.tabs().map((tab) => tab.url);
const listTabs = (filter: Record<string, unknown> = {}) => agent.call<Tab[]>('safari_tabs_list', filter);
const urlsOf = (tabs: Tab[]) => tabs.map((tab) => tab.url);

beforeAll(async () => {
  ({ extensionDir } = await testBridge());
  agent = await startAgent();
  safari = startSimulatedSafari({ extensionDir, windows: [[NEWS, DOCS], [SHOP]] });
  await agent.waitUntilConnected();
});

afterAll(async () => {
  safari?.close();
  await agent?.close();
});

describe('the built extension in a simulated Safari', () => {
  it('connects to the packaged server as Safari', async () => {
    const status = await agent.waitUntilConnected();
    expect(status).toMatchObject({
      state: 'connected',
      role: 'host',
      browsers: [
        { browser: 'safari', label: 'Safari', extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION, userAgent: safari.userAgent },
      ],
    });
    expect(status.browsers[0]!.instanceId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('opens the setup page on install and from the toolbar button', async () => {
    await vi.waitFor(() => expect(browserUrls().filter((url) => url === welcomePage())).toHaveLength(1));
    safari.clickToolbarButton();
    await vi.waitFor(() => expect(browserUrls().filter((url) => url === welcomePage())).toHaveLength(2));

    const opened = await listTabs({ url: `${safari.origin}/*` });
    expect(opened.map((tab) => tab.title)).toEqual(['Agent Browser Bridge', 'Agent Browser Bridge']);
    await agent.call('safari_tabs_close', { tabIds: opened.map((tab) => tab.id) });
    expect(browserUrls()).toEqual([NEWS, DOCS, SHOP]);
  });

  it('shows the connection on the toolbar button and to the setup page', async () => {
    await vi.waitFor(() => expect(safari.toolbar.icon).toEqual({ 16: 'icons/connected-16.png', 32: 'icons/connected-32.png' }));
    await vi.waitFor(() => expect(safari.toolbar.title).toMatch(/^Agent Browser Bridge: connected to e2e/));
    expect(await safari.sendMessage({ type: 'GET_STATUS' })).toMatchObject({
      state: 'connected',
      instanceId: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  it('shows the Safari wording and the connection on the setup page', async () => {
    const setup = await openSetupPageAsSafari({
      extensionDir,
      extensionOrigin: safari.origin,
      sendMessage: (message) => safari.sendMessage(message),
    });
    try {
      const { page } = setup;
      await page.waitForSelector('#status[data-state="connected"]');
      await expect.poll(() => page.locator('#agents li.session .chip').allTextContents()).toEqual(['Safari, this browser']);

      const visibleText = await page.locator('main').innerText();
      expect(visibleText).toContain('Let your AI agent find, open, move and close your Safari tabs.');
      expect(visibleText).toContain('With Safari open, ask your agent:');
      expect(visibleText).toContain('It cannot read or act in web pages in Safari.');
      expect(visibleText).not.toMatch(/With Chrome open|chrome_plan_apply|debugging banner/);
      expect(await page.locator('[data-browser="chrome"]:visible').count()).toBe(0);
      expect(setup.errors).toEqual([]);
    } finally {
      await setup.close();
    }
  });

  it('lists windows', async () => {
    const windows = await agent.call<WindowSummary[]>('safari_windows_list');
    expect(windows).toEqual([
      { id: expect.any(Number), focused: false, type: 'normal', state: 'normal', incognito: false, tabCount: 2 },
      { id: expect.any(Number), focused: true, type: 'normal', state: 'normal', incognito: false, tabCount: 1 },
    ]);
  });

  it('lists and filters tabs', async () => {
    const all = await listTabs();
    expect(all.map(({ url, title, index, active }) => ({ url, title, index, active }))).toEqual([
      { url: NEWS, title: 'news.example.com/today', index: 0, active: true },
      { url: DOCS, title: 'docs.example.com/guide', index: 1, active: false },
      { url: SHOP, title: 'shop.example.org/cart', index: 0, active: true },
    ]);
    expect(urlsOf(await listTabs({ windowId: all[2]!.windowId }))).toEqual([SHOP]);
    expect(urlsOf(await listTabs({ url: '*://*.example.com/*' }))).toEqual([NEWS, DOCS]);
    expect(urlsOf(await listTabs({ title: '*cart*' }))).toEqual([SHOP]);
    expect(urlsOf(await listTabs({ active: false }))).toEqual([DOCS]);
    expect(urlsOf(await listTabs({ lastFocusedWindow: true }))).toEqual([SHOP]);
  });

  it('leaves out the tab details Safari does not report', async () => {
    for (const tab of await listTabs()) {
      expect(tab).not.toHaveProperty('groupId');
      expect(tab).not.toHaveProperty('discarded');
      expect(tab).not.toHaveProperty('lastAccessed');
    }
  });

  it('opens tabs and waits for them to load', async () => {
    const [first, second] = safari.windows();
    const opened = await agent.call<Tab>('safari_tabs_create', { url: 'example.net/new' });
    expect(opened).toMatchObject({ url: 'https://example.net/new', windowId: second!.id, index: 1, active: true, loaded: true });

    const background = await agent.call<Tab>('safari_tabs_create', { url: 'https://example.net/later', windowId: first!.id, active: false });
    expect(background).toMatchObject({ windowId: first!.id, index: 2, active: false, loaded: true });
    expect(urlsOf(await listTabs({ windowId: first!.id, active: true }))).toEqual([NEWS]);

    await agent.call('safari_tabs_close', { tabIds: [opened.id, background.id] });
  });

  it('navigates, reloads and steps through history', async () => {
    const { id: tabId } = await agent.call<Tab>('safari_tabs_create', { url: 'https://example.net/one' });
    const navigate = (to: string) => agent.call<Tab>('safari_tabs_navigate', { tabId, to });

    expect(await navigate('example.net/two')).toMatchObject({ url: 'https://example.net/two', loaded: true });
    expect(await navigate('back')).toMatchObject({ url: 'https://example.net/one', loaded: true });
    expect(await navigate('forward')).toMatchObject({ url: 'https://example.net/two', loaded: true });
    expect(await navigate('reload')).toMatchObject({ url: 'https://example.net/two', loaded: true });

    await agent.call('safari_tabs_close', { tabIds: [tabId] });
  });

  it('moves tabs within a window and into another one', async () => {
    const [news, docs, shop] = await listTabs();

    const reordered = await agent.call<Tab[]>('safari_tabs_move', { tabIds: [docs!.id], index: 0 });
    expect(reordered).toMatchObject([{ id: docs!.id, index: 0 }]);
    expect(browserUrls()).toEqual([DOCS, NEWS, SHOP]);

    const moved = await agent.call<Tab[]>('safari_tabs_move', { tabIds: [shop!.id], index: -1, windowId: news!.windowId });
    expect(moved).toMatchObject([{ id: shop!.id, windowId: news!.windowId, index: 2 }]);
    expect(safari.windows().map((window) => window.tabs!.map((tab) => tab.url))).toEqual([[DOCS, NEWS, SHOP]]);
  });

  it('closes tabs and reports a tab that does not exist', async () => {
    const shop = (await listTabs({ title: '*cart*' }))[0]!;
    expect(await agent.call('safari_tabs_close', { tabIds: [shop.id] })).toEqual({ closed: [shop.id] });
    expect(browserUrls()).toEqual([DOCS, NEWS]);

    const missing = await agent.raw('safari_tabs_close', { tabIds: [shop.id] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Invalid tab ID/);
  });

  it('opens, focuses, resizes and closes windows', async () => {
    const [original] = safari.windows();
    const opened = await agent.call<WindowSummary & { tabs: Tab[] }>('safari_windows_create', { url: ['example.net/a', 'https://example.net/b'] });
    expect(opened).toMatchObject({ focused: true, tabCount: 2 });
    expect(urlsOf(opened.tabs)).toEqual(['https://example.net/a', 'https://example.net/b']);

    expect(await agent.call('safari_windows_update', { windowId: original!.id, focused: true, state: 'maximized' })).toMatchObject({
      id: original!.id,
      focused: true,
      state: 'maximized',
    });
    await agent.call('safari_windows_update', { windowId: opened.id, state: 'normal', left: 40, top: 30, width: 900, height: 700 });
    expect(safari.windows().map(({ id, focused, state, left, top, width, height }) => ({ id, focused, state, left, top, width, height }))).toEqual([
      { id: original!.id, focused: true, state: 'maximized', left: 0, top: 0, width: 1280, height: 800 },
      { id: opened.id, focused: false, state: 'normal', left: 40, top: 30, width: 900, height: 700 },
    ]);

    const [docs] = await listTabs({ windowId: original!.id });
    const split = await agent.call<WindowSummary & { tabs: Tab[] }>('safari_windows_create', { tabId: docs!.id, focused: false });
    expect(split).toMatchObject({ tabCount: 1, tabs: [{ id: docs!.id, url: DOCS }] });
    expect(safari.windows().find((window) => window.focused)?.id).toBe(original!.id);
    await agent.call('safari_tabs_move', { tabIds: [docs!.id], index: 0, windowId: original!.id });

    expect(await agent.call('safari_windows_remove', { windowId: opened.id })).toEqual({ closed: opened.id });
    expect(safari.windows().map((window) => window.tabs!.map((tab) => tab.url))).toEqual([[DOCS, NEWS]]);
    await agent.call('safari_windows_update', { windowId: original!.id, state: 'normal' });
  });

  it('switches, pins, mutes and duplicates tabs', async () => {
    const [docs, news] = await listTabs();

    expect(await agent.call('safari_tabs_update', { tabId: docs!.id, active: true, pinned: true, muted: true })).toMatchObject({
      id: docs!.id,
      active: true,
      pinned: true,
      muted: true,
    });
    expect(urlsOf(await listTabs({ muted: true }))).toEqual([DOCS]);
    expect(urlsOf(await listTabs({ pinned: false }))).toEqual([NEWS]);
    await agent.call('safari_tabs_update', { tabId: docs!.id, pinned: false, muted: false });

    const copy = await agent.call<Tab>('safari_tabs_duplicate', { tabId: news!.id });
    expect(copy).toMatchObject({ url: NEWS, index: 2, active: true, pinned: false });
    expect(browserUrls()).toEqual([DOCS, NEWS, NEWS]);

    await agent.call('safari_tabs_close', { tabIds: [copy.id] });
    await agent.call('safari_tabs_update', { tabId: news!.id, active: true });
    expect(browserUrls()).toEqual([DOCS, NEWS]);
  });

  it('lets the agent identify Safari, name it, and address it by name', async () => {
    const { instances } = await agent.call<{ instances: Array<{ browser: string; instanceId: string; name: string | null; sampleTabs: Array<{ site: string }> }> }>(
      IDENTIFY_INSTANCES_TOOL,
      { sampleSize: 20 },
    );
    expect(instances).toMatchObject([{ browser: 'safari', name: null }]);
    expect(instances[0]!.sampleTabs.map((tab) => tab.site)).toContain('news.example.com');

    const id = instances[0]!.instanceId;
    expect(await agent.call(NAME_INSTANCE_TOOL, { browser: 'safari', instance: id, name: 'Home' })).toEqual({ browser: 'safari', instanceId: id, name: 'Home' });
    expect((await agent.waitUntilConnected()).browsers[0]).toMatchObject({ instanceId: id, name: 'Home' });

    const byName = await agent.raw('safari_windows_list', { instance: 'home' });
    expect(byName.isError).toBe(false);
    expect(byName.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: "Home" (Safari, ${id})` });
  });

  it('reports Chrome as not connected', async () => {
    const result = await agent.raw('chrome_tabs_list');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not connected in chrome/i);
  });

  it('reconnects to a new agent session when the reconnect alarm fires', async () => {
    await agent.close();
    await vi.waitFor(() => expect(safari.toolbar.icon).toEqual({ 16: 'icons/disconnected-16.png', 32: 'icons/disconnected-32.png' }));

    agent = await startAgent();
    safari.fireAlarms();
    const status = await agent.waitUntilConnected();
    expect(status.browsers).toMatchObject([{ browser: 'safari', name: 'Home' }]);
    expect(urlsOf(await listTabs())).toEqual([DOCS, NEWS]);
  });

  it('ran without errors in the background script', () => {
    expect(safari.errors).toEqual([]);
  });
});

describe('the Safari simulation', () => {
  it(`offers only extension APIs that MDN ${COMPAT_DATA_VERSION} lists for Safari ${SAFARI_VERSION}`, () => {
    const notInSafari = safari.apiPaths().filter((path) => {
      const support = safariSupport(path);
      return support.status !== 'supported' || compareVersions(support.since, SAFARI_VERSION) > 0;
    });
    expect(notInSafari).toEqual([]);
  });

  it('names the API when a background script uses one Safari lacks', () => {
    const start = () =>
      startSimulatedSafari({ extensionDir, backgroundSource: 'chrome.runtime.onUpdateAvailable.addListener(() => {});' });
    expect(start).toThrow(/failed to start in the simulated Safari/);
    expect(start).toThrow(/runtime\.onUpdateAvailable: MDN lists it as not supported in Safari/);
  });

  it('refuses a service worker background, which Safari 27 does not run', () => {
    const start = () =>
      startSimulatedSafari({ extensionDir, manifest: { name: 'x', version: '1', background: { service_worker: 'background.js' } } });
    expect(start).toThrow(/does not run service worker backgrounds/);
  });

  it('tells a missing simulation apart from a missing Safari API', () => {
    const start = () => startSimulatedSafari({ extensionDir, backgroundSource: 'chrome.tabs.setZoom.call();' });
    expect(start).toThrow(/tabs\.setZoom: Safari [\d.]+ has it, but the simulation in e2e\/safari does not yet/);
  });
});
