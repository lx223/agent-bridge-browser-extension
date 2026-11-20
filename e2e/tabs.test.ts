import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browserApis,
  browsers,
  browserToolName,
  IDENTIFY_INSTANCES_TOOL,
  NAME_INSTANCE_TOOL,
  PROTOCOL_VERSION,
  STATUS_TOOL,
} from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startAgent, startHarness, type Harness, type Tab, type TabGroup } from './harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const tabs = () => harness.agent.call<Tab[]>('chrome_tabs_list');
const groups = () => harness.agent.call<TabGroup[]>('chrome_tab_groups_list');
const titled = async (title: string) => (await groups()).find((g) => g.title === title);

async function openThree() {
  const opened: Tab[] = [];
  for (const name of ['form.html', 'second.html', 'form.html']) opened.push(await harness.openFixture(name));
  return opened;
}

async function closeAllButOne() {
  const all = await tabs();
  if (all.length > 1) await harness.agent.call('chrome_tabs_close', { tabIds: all.slice(1).map((t) => t.id) });
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
    const expected = [
      STATUS_TOOL,
      IDENTIFY_INSTANCES_TOOL,
      NAME_INSTANCE_TOOL,
      ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method))),
    ];
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('accepts the connected instance id and rejects an unknown one', async () => {
    const { browsers: connected } = await harness.agent.waitUntilConnected();
    const listed = await harness.agent.call<Tab[]>('chrome_tabs_list', { instance: connected[0]!.instanceId });
    expect(listed.length).toBeGreaterThan(0);
    expect((await harness.agent.raw('chrome_tabs_list', { instance: 'missing' })).isError).toBe(true);
    const tagged = await harness.agent.raw('chrome_windows_list');
    expect(tagged.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: ${connected[0]!.instanceId} (Chrome)` });
  });

  it('lets the agent identify the profile, name it, and address it by name', async () => {
    const opened = await harness.openFixture('second.html');
    const { instances } = await harness.agent.call<{ instances: Array<{ instanceId: string; name: string | null; sampleTabs: Array<{ title: string; site: string }> }> }>(
      IDENTIFY_INSTANCES_TOOL,
      { sampleSize: 20 },
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]!.name).toBeNull();
    expect(instances[0]!.sampleTabs.map((tab) => tab.site)).toContain(new URL(harness.fixture('second.html')).hostname);

    const id = instances[0]!.instanceId;
    expect(await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance: id, name: 'Work' })).toEqual({ browser: 'chrome', instanceId: id, name: 'Work' });
    const { browsers: connected } = await harness.agent.waitUntilConnected();
    expect(connected[0]).toMatchObject({ instanceId: id, name: 'Work' });

    const byName = await harness.agent.raw('chrome_windows_list', { instance: 'work' });
    expect(byName.isError).toBe(false);
    expect(byName.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: "Work" (Chrome, ${id})` });

    await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance: 'Work', name: '' });
    expect((await harness.agent.waitUntilConnected()).browsers[0]).not.toHaveProperty('name');
    await harness.agent.call('chrome_tabs_close', { tabIds: [opened.id] });
  });

  it('reports Safari as not connected', async () => {
    const result = await harness.agent.raw('safari_tabs_list');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not connected in safari/i);
  });

  it('lists windows and opened tabs', async () => {
    const tab = await harness.openFixture('second.html');
    expect(tab).toMatchObject({ title: 'Second page', url: harness.fixture('second.html'), loaded: true, groupId: null });

    const windows = await harness.agent.call<Array<{ id: number; type: string; tabCount: number }>>('chrome_windows_list');
    const owner = windows.find((w) => w.id === tab.windowId)!;
    expect(owner.type).toBe('normal');

    const inWindow = await harness.agent.call<Tab[]>('chrome_tabs_list', { windowId: tab.windowId });
    expect(inWindow).toHaveLength(owner.tabCount);
    expect(inWindow.map((t) => t.id)).toContain(tab.id);
    await closeAllButOne();
  });

  it('groups, updates, moves and ungroups tabs', async () => {
    const [a, b, c] = await openThree();
    const created = await harness.agent.call<TabGroup>('chrome_tabs_group', { tabIds: [a!.id, b!.id], title: 'Research', color: 'blue' });
    expect(created).toMatchObject({ title: 'Research', color: 'blue', collapsed: false, tabIds: [a!.id, b!.id] });

    const added = await harness.agent.call<TabGroup>('chrome_tabs_group', { tabIds: [c!.id], groupId: created.id });
    expect(added.tabIds).toEqual([a!.id, b!.id, c!.id]);

    const updated = await harness.agent.call<TabGroup>('chrome_tab_groups_update', { groupId: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(updated).toMatchObject({ id: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(await titled('Reading')).toMatchObject({ color: 'green', tabIds: [a!.id, b!.id, c!.id] });

    await harness.agent.call('chrome_tab_groups_move', { groupId: created.id, index: 0 });
    expect((await tabs()).slice(0, 3).map((t) => t.id)).toEqual([a!.id, b!.id, c!.id]);

    const ungrouped = await harness.agent.call<{ ungrouped: number[] }>('chrome_tabs_ungroup', { tabIds: [a!.id, b!.id, c!.id] });
    expect(ungrouped.ungrouped).toEqual([a!.id, b!.id, c!.id]);
    expect(await groups()).toEqual([]);

    const moved = await harness.agent.call<Tab[]>('chrome_tabs_move', { tabIds: [c!.id], index: 0 });
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

    await harness.agent.call('chrome_plan_apply', { ...plan, dryRun: true });
    expect(await groups()).toEqual([]);

    await harness.agent.call('chrome_plan_apply', plan);
    expect(await titled('Forms')).toMatchObject({ color: 'purple', tabIds: [a!.id, c!.id] });
    expect(await titled('Other')).toMatchObject({ tabIds: [b!.id] });

    await harness.agent.call('chrome_plan_undo');
    expect(await groups()).toEqual([]);
    expect((await tabs()).map((t) => t.groupId)).not.toContainEqual(expect.any(Number));
    await closeAllButOne();
  });

  it('closes tabs', async () => {
    const [a, b, c] = await openThree();
    const closed = await harness.agent.call<{ closed: number[] }>('chrome_tabs_close', { tabIds: [a!.id, b!.id] });
    expect(closed.closed).toEqual([a!.id, b!.id]);
    const remaining = (await tabs()).map((t) => t.id);
    expect(remaining).toContain(c!.id);
    expect(remaining).not.toContain(a!.id);
    expect(remaining).not.toContain(b!.id);
    await closeAllButOne();
  });

  it('filters tabs by url, title and state', async () => {
    const [a, b] = await openThree();
    const second = await harness.agent.call<Tab[]>('chrome_tabs_list', { url: harness.fixture('second.html') });
    expect(second.map((t) => t.id)).toEqual([b!.id]);
    const titledSecond = await harness.agent.call<Tab[]>('chrome_tabs_list', { title: 'Second*' });
    expect(titledSecond.map((t) => t.id)).toEqual([b!.id]);
    await harness.agent.call('chrome_tabs_group', { tabIds: [a!.id], title: 'Filtered' });
    const grouped = await harness.agent.call<Tab[]>('chrome_tabs_list', { groupId: (await titled('Filtered'))!.id });
    expect(grouped.map((t) => t.id)).toEqual([a!.id]);
    await closeAllButOne();
  });

  it('updates and duplicates tabs', async () => {
    const [a] = await openThree();
    expect(await harness.agent.call<Tab>('chrome_tabs_update', { tabId: a!.id, active: true, muted: true })).toMatchObject({
      id: a!.id,
      active: true,
      muted: true,
    });
    expect(await harness.agent.call<Tab>('chrome_tabs_update', { tabId: a!.id, pinned: true })).toMatchObject({ pinned: true });
    expect((await harness.agent.call<Tab[]>('chrome_tabs_list', { pinned: true })).map((t) => t.id)).toEqual([a!.id]);
    await harness.agent.call('chrome_tabs_update', { tabId: a!.id, pinned: false });

    const copy = await harness.agent.call<Tab>('chrome_tabs_duplicate', { tabId: a!.id });
    expect(copy.id).not.toBe(a!.id);
    await expect.poll(async () => (await tabs()).find((t) => t.id === copy.id)?.url).toBe(harness.fixture('form.html'));
    await closeAllButOne();
  });

  it('creates, updates and closes windows', async () => {
    const created = await harness.agent.call<{ id: number; type: string; tabs: Tab[] }>('chrome_windows_create', {
      url: [harness.fixture('form.html'), harness.fixture('second.html')],
    });
    expect(created.type).toBe('normal');
    expect(created.tabs).toHaveLength(2);

    const updated = await harness.agent.call<{ id: number; state: string }>('chrome_windows_update', { windowId: created.id, state: 'normal', drawAttention: true });
    expect(updated).toMatchObject({ id: created.id, state: 'normal' });

    const moved = await harness.agent.call<{ id: number; tabs: Tab[] }>('chrome_windows_create', { tabId: created.tabs[1]!.id });
    expect(moved.tabs.map((t) => t.id)).toEqual([created.tabs[1]!.id]);

    expect(await harness.agent.call('chrome_windows_remove', { windowId: created.id })).toEqual({ closed: created.id });
    await harness.agent.call('chrome_windows_remove', { windowId: moved.id });
    const windows = await harness.agent.call<Array<{ id: number }>>('chrome_windows_list');
    expect(windows.map((w) => w.id)).not.toContain(created.id);
    expect(windows.map((w) => w.id)).not.toContain(moved.id);
  });

  it('reports browser errors as tool errors', async () => {
    const result = await harness.agent.raw('chrome_tabs_close', { tabIds: [999_999_999] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No tab with id/);
  });

  it('serves a second agent session through the first', async () => {
    const second = await startAgent('e2e-second');
    try {
      const status = await second.waitUntilConnected();
      expect(status.role).toBe('relay');
      expect((await second.call<Tab[]>('chrome_tabs_list')).map((t) => t.id)).toEqual((await tabs()).map((t) => t.id));
    } finally {
      await second.close();
    }
  });
});
