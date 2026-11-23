import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '@agent-browser-bridge/protocol';
import { installFakeChrome } from '../test/fakeChrome.ts';
import { applyPlan, undoLastPlan } from './plan.ts';

const plan = (input: unknown) => toolDefinitions['plan.apply'].params.parse(input);

describe('applyPlan', () => {
  it('creates groups with titles and colors', async () => {
    const { layout, state } = installFakeChrome([{}, {}, {}, {}]);
    const result = await applyPlan(plan({ groups: [{ title: 'Docs', color: 'blue', tabIds: [1, 3] }, { title: 'News', tabIds: [2] }] }));

    expect(result).toMatchObject({ applied: true, warnings: [] });
    expect(layout()).toEqual(['1:Docs 3:Docs 2:News 4']);
    expect(state.groups.find((g) => g.title === 'Docs')?.color).toBe('blue');
  });

  it('reuses an existing group with the same title', async () => {
    const { state } = installFakeChrome([{ groupId: 100 }, {}], [{ id: 100, title: 'Work' }]);
    await applyPlan(plan({ groups: [{ title: 'Work', tabIds: [2] }] }));
    expect(state.groups).toHaveLength(1);
    expect(state.tabs.every((t) => t.groupId === 100)).toBe(true);
  });

  it('dry run reports actions without changing anything', async () => {
    const { layout } = installFakeChrome([{}, {}]);
    const result = await applyPlan(plan({ groups: [{ title: 'A', tabIds: [1, 2] }], dryRun: true }));
    expect(result).toMatchObject({ dryRun: true, actions: [{ action: 'createGroup', title: 'A', tabIds: [1, 2] }] });
    expect(layout()).toEqual(['1 2']);
  });

  it('skips pinned, missing and duplicated tabs with warnings', async () => {
    installFakeChrome([{ pinned: true }, {}]);
    const result = await applyPlan(plan({ groups: [{ title: 'A', tabIds: [1, 2, 99] }, { title: 'B', tabIds: [2] }] }));
    expect(result).toMatchObject({ applied: true, groups: [{ title: 'A', tabCount: 1 }] });
    expect((result as { warnings: string[] }).warnings).toEqual([
      'Tab 1 is pinned and cannot be grouped; skipped.',
      'Tab 99 no longer exists; skipped.',
      'Tab 2 is listed in both "A" and "B"; kept in "A".',
      'Group "B" has no usable tabs; skipped.',
    ]);
  });
});

describe('undoLastPlan', () => {
  it('restores order and original groups', async () => {
    const { layout } = installFakeChrome([{ groupId: 100 }, { groupId: 100 }, {}, {}], [{ id: 100, title: 'Old', color: 'red' }]);
    const before = layout();
    await applyPlan(plan({ groups: [{ title: 'New', tabIds: [4, 1] }], ungroupTabIds: [2] }));
    expect(layout()).not.toEqual(before);

    const result = await undoLastPlan();
    expect(result).toMatchObject({ restored: true, tabs: 4, groups: 1, warnings: [] });
    expect(layout()).toEqual(['1:Old 2:Old 3 4']);
  });

  it('errors when there is nothing to undo', async () => {
    installFakeChrome([{}]);
    await expect(undoLastPlan()).rejects.toThrow(/Nothing to undo/);
  });
});
