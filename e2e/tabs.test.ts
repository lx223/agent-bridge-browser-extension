import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserApis, browsers, browserToolName, PROTOCOL_VERSION, STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startAgent, startHarness, type Harness, type Tab, type TabGroup } from './harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const tabs = () => harness.agent.call<Tab[]>('chrome_list_tabs');
const groups = () => harness.agent.call<TabGroup[]>('chrome_list_tab_groups');
const titled = async (title: string) => (await groups()).find((g) => g.title === title);

async function openThree() {
  const opened: Tab[] = [];
  for (const name of ['form.html', 'second.html', 'form.html']) opened.push(await harness.openFixture(name));
  return opened;
}

async function closeAllButOne() {
  const all = await tabs();
  if (all.length > 1) await harness.agent.call('chrome_close_tabs', { tabIds: all.slice(1).map((t) => t.id) });
}

describe('tab management through the built server and extension', () => {
  it('connects the packaged extension to the packaged server', async () => {
    const status = await harness.agent.waitUntilConnected();
    expect(status).toMatchObject({
      state: 'connected',
      role: 'host',
      browsers: [{ browser: 'chrome', label: 'Chrome', extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION }],
    });
    expect(status.browsers[0]!.instanceId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('exposes the status tool and every browser tool', async () => {
    const { tools } = await harness.agent.client.listTools();
    const expected = [STATUS_TOOL, ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method)))];
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('accepts the connected instance id and rejects an unknown one', async () => {
    const { browsers: connected } = await harness.agent.waitUntilConnected();
    const listed = await harness.agent.call<Tab[]>('chrome_list_tabs', { instance: connected[0]!.instanceId });
    expect(listed.length).toBeGreaterThan(0);
    expect((await harness.agent.raw('chrome_list_tabs', { instance: 'missing' })).isError).toBe(true);
  });

  it('reports Safari as not connected', async () => {
    const result = await harness.agent.raw('safari_list_tabs');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not connected in safari/i);
  });

  it('lists windows and opened tabs', async () => {
    const tab = await harness.openFixture('second.html');
    expect(tab).toMatchObject({ title: 'Second page', url: harness.fixture('second.html'), loaded: true, groupId: null });

    const windows = await harness.agent.call<Array<{ id: number; type: string; tabCount: number }>>('chrome_list_windows');
    const owner = windows.find((w) => w.id === tab.windowId)!;
    expect(owner.type).toBe('normal');

    const inWindow = await harness.agent.call<Tab[]>('chrome_list_tabs', { windowId: tab.windowId });
    expect(inWindow).toHaveLength(owner.tabCount);
    expect(inWindow.map((t) => t.id)).toContain(tab.id);
    await closeAllButOne();
  });

  it('groups, updates, moves and ungroups tabs', async () => {
    const [a, b, c] = await openThree();
    const created = await harness.agent.call<TabGroup>('chrome_group_tabs', { tabIds: [a!.id, b!.id], title: 'Research', color: 'blue' });
    expect(created).toMatchObject({ title: 'Research', color: 'blue', collapsed: false, tabIds: [a!.id, b!.id] });

    const added = await harness.agent.call<TabGroup>('chrome_group_tabs', { tabIds: [c!.id], groupId: created.id });
    expect(added.tabIds).toEqual([a!.id, b!.id, c!.id]);

    const updated = await harness.agent.call<TabGroup>('chrome_update_tab_group', { groupId: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(updated).toMatchObject({ id: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(await titled('Reading')).toMatchObject({ color: 'green', tabIds: [a!.id, b!.id, c!.id] });

    await harness.agent.call('chrome_move_tab_group', { groupId: created.id, index: 0 });
    expect((await tabs()).slice(0, 3).map((t) => t.id)).toEqual([a!.id, b!.id, c!.id]);

    const ungrouped = await harness.agent.call<{ ungrouped: number[] }>('chrome_ungroup_tabs', { tabIds: [a!.id, b!.id, c!.id] });
    expect(ungrouped.ungrouped).toEqual([a!.id, b!.id, c!.id]);
    expect(await groups()).toEqual([]);

    const moved = await harness.agent.call<Tab[]>('chrome_move_tabs', { tabIds: [c!.id], index: 0 });
    expect(moved[0]).toMatchObject({ id: c!.id, index: 0 });
    expect((await tabs())[0]!.id).toBe(c!.id);
    await closeAllButOne();
  });

  it('previews, applies and undoes a tab plan', async () => {
    const [a, b, c] = await openThree();
    const plan = {
      groups: [
        { title: 'Forms', color: 'purple', tabIds: [a!.id, c!.id] },
        { title: 'Other', tabIds: [b!.id] },
      ],
    };

    await harness.agent.call('chrome_apply_tab_plan', { ...plan, dryRun: true });
    expect(await groups()).toEqual([]);

    await harness.agent.call('chrome_apply_tab_plan', plan);
    expect(await titled('Forms')).toMatchObject({ color: 'purple', tabIds: [a!.id, c!.id] });
    expect(await titled('Other')).toMatchObject({ tabIds: [b!.id] });

    await harness.agent.call('chrome_undo_last_plan');
    expect(await groups()).toEqual([]);
    expect((await tabs()).map((t) => t.groupId)).not.toContainEqual(expect.any(Number));
    await closeAllButOne();
  });

  it('closes tabs', async () => {
    const [a, b, c] = await openThree();
    const closed = await harness.agent.call<{ closed: number[] }>('chrome_close_tabs', { tabIds: [a!.id, b!.id] });
    expect(closed.closed).toEqual([a!.id, b!.id]);
    const remaining = (await tabs()).map((t) => t.id);
    expect(remaining).toContain(c!.id);
    expect(remaining).not.toContain(a!.id);
    expect(remaining).not.toContain(b!.id);
    await closeAllButOne();
  });

  it('filters tabs by url, title and state', async () => {
    const [a, b] = await openThree();
    const second = await harness.agent.call<Tab[]>('chrome_list_tabs', { url: harness.fixture('second.html') });
    expect(second.map((t) => t.id)).toEqual([b!.id]);
    const titledSecond = await harness.agent.call<Tab[]>('chrome_list_tabs', { title: 'Second*' });
    expect(titledSecond.map((t) => t.id)).toEqual([b!.id]);
    await harness.agent.call('chrome_group_tabs', { tabIds: [a!.id], title: 'Filtered' });
    const grouped = await harness.agent.call<Tab[]>('chrome_list_tabs', { groupId: (await titled('Filtered'))!.id });
    expect(grouped.map((t) => t.id)).toEqual([a!.id]);
    await closeAllButOne();
  });

  it('updates and duplicates tabs', async () => {
    const [a] = await openThree();
    expect(await harness.agent.call<Tab>('chrome_update_tab', { tabId: a!.id, active: true, muted: true })).toMatchObject({
      id: a!.id,
      active: true,
      muted: true,
    });
    expect(await harness.agent.call<Tab>('chrome_update_tab', { tabId: a!.id, pinned: true })).toMatchObject({ pinned: true });
    expect((await harness.agent.call<Tab[]>('chrome_list_tabs', { pinned: true })).map((t) => t.id)).toEqual([a!.id]);
    await harness.agent.call('chrome_update_tab', { tabId: a!.id, pinned: false });

    const copy = await harness.agent.call<Tab>('chrome_duplicate_tab', { tabId: a!.id });
    expect(copy.id).not.toBe(a!.id);
    await expect.poll(async () => (await tabs()).find((t) => t.id === copy.id)?.url).toBe(harness.fixture('form.html'));
    await closeAllButOne();
  });

  it('creates, updates and closes windows', async () => {
    const created = await harness.agent.call<{ id: number; type: string; tabs: Tab[] }>('chrome_create_window', {
      url: [harness.fixture('form.html'), harness.fixture('second.html')],
    });
    expect(created.type).toBe('normal');
    expect(created.tabs).toHaveLength(2);

    const updated = await harness.agent.call<{ id: number; state: string }>('chrome_update_window', { windowId: created.id, state: 'normal', drawAttention: true });
    expect(updated).toMatchObject({ id: created.id, state: 'normal' });

    const moved = await harness.agent.call<{ id: number; tabs: Tab[] }>('chrome_create_window', { tabId: created.tabs[1]!.id });
    expect(moved.tabs.map((t) => t.id)).toEqual([created.tabs[1]!.id]);

    expect(await harness.agent.call('chrome_close_window', { windowId: created.id })).toEqual({ closed: created.id });
    await harness.agent.call('chrome_close_window', { windowId: moved.id });
    const windows = await harness.agent.call<Array<{ id: number }>>('chrome_list_windows');
    expect(windows.map((w) => w.id)).not.toContain(created.id);
    expect(windows.map((w) => w.id)).not.toContain(moved.id);
  });

  it('reports browser errors as tool errors', async () => {
    const result = await harness.agent.raw('chrome_close_tabs', { tabIds: [999_999_999] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No tab with id/);
  });

  it('serves a second agent session through the first', async () => {
    const second = await startAgent('e2e-second');
    try {
      const status = await second.waitUntilConnected();
      expect(status.role).toBe('relay');
      expect((await second.call<Tab[]>('chrome_list_tabs')).map((t) => t.id)).toEqual((await tabs()).map((t) => t.id));
    } finally {
      await second.close();
    }
  });
});
