import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { methods, PROTOCOL_VERSION, toolDefinitions } from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startAgent, startHarness, type Harness, type Tab, type TabGroup } from './harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const tabs = () => harness.agent.call<Tab[]>('list_tabs');
const groups = () => harness.agent.call<TabGroup[]>('list_tab_groups');
const titled = async (title: string) => (await groups()).find((g) => g.title === title);

async function openThree() {
  const opened: Tab[] = [];
  for (const name of ['form.html', 'second.html', 'form.html']) opened.push(await harness.openFixture(name));
  return opened;
}

async function closeAllButOne() {
  const all = await tabs();
  if (all.length > 1) await harness.agent.call('close_tabs', { tabIds: all.slice(1).map((t) => t.id) });
}

describe('tab management through the built server and extension', () => {
  it('connects the packaged extension to the packaged server', async () => {
    const status = await harness.agent.waitUntilConnected();
    expect(status).toMatchObject({
      state: 'connected',
      role: 'host',
      extension: { extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION },
    });
  });

  it('exposes every protocol method as a tool', async () => {
    const { tools } = await harness.agent.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(methods.map((m) => toolDefinitions[m].tool)));
  });

  it('lists windows and opened tabs', async () => {
    const tab = await harness.openFixture('second.html');
    expect(tab).toMatchObject({ title: 'Second page', url: harness.fixture('second.html'), loaded: true, groupId: null });

    const windows = await harness.agent.call<Array<{ id: number; type: string; tabCount: number }>>('list_windows');
    const owner = windows.find((w) => w.id === tab.windowId)!;
    expect(owner.type).toBe('normal');

    const inWindow = await harness.agent.call<Tab[]>('list_tabs', { windowId: tab.windowId });
    expect(inWindow).toHaveLength(owner.tabCount);
    expect(inWindow.map((t) => t.id)).toContain(tab.id);
    await closeAllButOne();
  });

  it('groups, updates, moves and ungroups tabs', async () => {
    const [a, b, c] = await openThree();
    const created = await harness.agent.call<TabGroup>('group_tabs', { tabIds: [a!.id, b!.id], title: 'Research', color: 'blue' });
    expect(created).toMatchObject({ title: 'Research', color: 'blue', collapsed: false, tabIds: [a!.id, b!.id] });

    const added = await harness.agent.call<TabGroup>('group_tabs', { tabIds: [c!.id], groupId: created.id });
    expect(added.tabIds).toEqual([a!.id, b!.id, c!.id]);

    const updated = await harness.agent.call<TabGroup>('update_tab_group', { groupId: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(updated).toMatchObject({ id: created.id, title: 'Reading', color: 'green', collapsed: true });
    expect(await titled('Reading')).toMatchObject({ color: 'green', tabIds: [a!.id, b!.id, c!.id] });

    await harness.agent.call('move_tab_group', { groupId: created.id, index: 0 });
    expect((await tabs()).slice(0, 3).map((t) => t.id)).toEqual([a!.id, b!.id, c!.id]);

    const ungrouped = await harness.agent.call<{ ungrouped: number[] }>('ungroup_tabs', { tabIds: [a!.id, b!.id, c!.id] });
    expect(ungrouped.ungrouped).toEqual([a!.id, b!.id, c!.id]);
    expect(await groups()).toEqual([]);

    const moved = await harness.agent.call<Tab[]>('move_tabs', { tabIds: [c!.id], index: 0 });
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

    await harness.agent.call('apply_tab_plan', { ...plan, dryRun: true });
    expect(await groups()).toEqual([]);

    await harness.agent.call('apply_tab_plan', plan);
    expect(await titled('Forms')).toMatchObject({ color: 'purple', tabIds: [a!.id, c!.id] });
    expect(await titled('Other')).toMatchObject({ tabIds: [b!.id] });

    await harness.agent.call('undo_last_plan');
    expect(await groups()).toEqual([]);
    expect((await tabs()).map((t) => t.groupId)).not.toContainEqual(expect.any(Number));
    await closeAllButOne();
  });

  it('closes tabs', async () => {
    const [a, b, c] = await openThree();
    const closed = await harness.agent.call<{ closed: number[] }>('close_tabs', { tabIds: [a!.id, b!.id] });
    expect(closed.closed).toEqual([a!.id, b!.id]);
    const remaining = (await tabs()).map((t) => t.id);
    expect(remaining).toContain(c!.id);
    expect(remaining).not.toContain(a!.id);
    expect(remaining).not.toContain(b!.id);
    await closeAllButOne();
  });

  it('reports browser errors as tool errors', async () => {
    const result = await harness.agent.raw('close_tabs', { tabIds: [999_999_999] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No tab with id/);
  });

  it('serves a second agent session through the first', async () => {
    const second = await startAgent('e2e-second');
    try {
      const status = await second.waitUntilConnected();
      expect(status.role).toBe('relay');
      expect((await second.call<Tab[]>('list_tabs')).map((t) => t.id)).toEqual((await tabs()).map((t) => t.id));
    } finally {
      await second.close();
    }
  });
});
