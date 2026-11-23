import { describe, expect, it, vi } from 'vitest';
import { Analytics } from './analytics.ts';
import { errorCode, tabCountBucket, toolMetrics, UsageTracker } from './usage.ts';

const DAY = 24 * 60 * 60_000;

function setup() {
  const store: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(store, items),
  };
  const fetch = vi.fn(async () => new Response('{}'));
  const analytics = new Analytics({ apiKey: 'phc_test', host: 'https://eu.i.posthog.com', version: '1.0.0', storage, fetch, randomId: () => 'anon' });
  let now = Date.UTC(2026, 10, 17, 12);
  const usage = new UsageTracker({
    analytics,
    storage,
    countBrowser: async () => ({ tabs: 42, windows: 2 }),
    installType: async () => 'normal',
    now: () => now,
  });
  const events = () =>
    fetch.mock.calls.map((call) => {
      const body = JSON.parse((call as unknown as [string, RequestInit])[1].body as string);
      return { event: body.event as string, properties: body.properties as Record<string, unknown> };
    });
  return { usage, events, advance: (ms: number) => (now += ms) };
}

describe('UsageTracker', () => {
  it('fires each milestone once, with time since install', async () => {
    const { usage, events, advance } = setup();
    await usage.installed();
    advance(5 * 60_000);
    await Promise.all([usage.milestone('first_connected'), usage.milestone('first_connected')]);
    await usage.milestone('first_connected');
    const connected = events().filter((e) => e.event === 'first_connected');
    expect(connected).toHaveLength(1);
    expect(connected[0].properties.minutes_since_install).toBe(5);
  });

  it('tags tool calls with the app and the agent that made them', async () => {
    const { usage, events } = setup();
    usage.setConnected(true);
    const agent = { serverVersion: '0.2.0', client: { name: 'cursor', version: '1.5' } };
    await usage.toolCalled({ method: 'tabs.list', params: {}, agent, result: [{}, {}], durationMs: 12 });
    expect(events()[0]).toEqual({
      event: 'tool_called',
      properties: expect.objectContaining({
        app: 'agent-browser-bridge',
        client_name: 'cursor',
        client_version: '1.5',
        server_version: '0.2.0',
        method: 'tabs.list',
        ok: true,
        tab_count: 2,
      }),
    });
  });

  it('records error codes instead of messages', async () => {
    const { usage, events } = setup();
    await usage.toolCalled({ method: 'tabs.close', params: { tabIds: [1] }, agent: null, error: new Error('No tab with id: 1.'), durationMs: 3 });
    expect(events()[0].properties).toMatchObject({ ok: false, error_code: 'tab_not_found' });
    expect(JSON.stringify(events()[0])).not.toContain('No tab with id');
  });

  it('tracks plan applies, the first-apply milestone and time to undo', async () => {
    const { usage, events, advance } = setup();
    const plan = { groups: [{ title: 'Work', tabIds: [1, 2] }, { title: 'News', tabIds: [3] }], ungroupTabIds: [4], dryRun: false };
    await usage.toolCalled({ method: 'plan.apply', params: { ...plan, dryRun: true }, agent: null, result: { warnings: ['x'] }, durationMs: 5 });
    expect(events().map((e) => e.event)).toEqual(['tool_called']);
    await usage.toolCalled({ method: 'plan.apply', params: plan, agent: null, result: { warnings: [] }, durationMs: 5 });
    advance(2 * 60_000);
    await usage.toolCalled({ method: 'plan.undo', params: {}, agent: null, result: { tabs: 4, groups: 1, warnings: [] }, durationMs: 5 });
    const [preview, apply, milestone, undo] = events();
    expect(preview.properties).toMatchObject({ dry_run: true, group_count: 2, tabs_grouped: 3, tabs_ungrouped: 1, warning_count: 1 });
    expect(apply.properties).toMatchObject({ dry_run: false });
    expect(milestone.event).toBe('first_plan_applied');
    expect(undo.properties).toMatchObject({ method: 'plan.undo', tabs_restored: 4, groups_restored: 1, minutes_since_apply: 2 });
  });

  it('reports activity at most once per day', async () => {
    const { usage, events, advance } = setup();
    usage.setConnected(true);
    await usage.dailyActive();
    await usage.dailyActive();
    advance(DAY);
    await usage.dailyActive();
    const active = events().filter((e) => e.event === 'extension_active');
    expect(active).toHaveLength(2);
    expect(active[0].properties).toMatchObject({ agent_connected: true, tab_count_bucket: '26-50', window_count: 2, install_type: 'normal' });
  });

  it('says whether the extension came from a store or was loaded unpacked', async () => {
    const { usage, events } = setup();
    await usage.installed();
    expect(events().find((e) => e.event === 'extension_installed')?.properties.install_type).toBe('normal');
  });

  it('reports the last agent seen while connected and forgets it on disconnect', async () => {
    const { usage, events, advance } = setup();
    usage.setConnected(true);
    await usage.toolCalled({ method: 'tabs.list', params: {}, agent: { serverVersion: '0.2.0', client: { name: 'cursor', version: '1.5' } }, result: [], durationMs: 1 });
    await usage.dailyActive();
    usage.setConnected(false);
    advance(DAY);
    await usage.dailyActive();
    const active = events().filter((e) => e.event === 'extension_active');
    expect(active.map((e) => e.properties.client_name)).toEqual(['cursor', null]);
  });
});

describe('helpers', () => {
  it('buckets tab counts', () => {
    expect([1, 10, 11, 50, 51, 101].map(tabCountBucket)).toEqual(['1-10', '1-10', '11-25', '26-50', '51-100', '100+']);
  });

  it('classifies unknown errors as other', () => {
    expect(errorCode(new Error('something odd'))).toBe('other');
    expect(errorCode(new Error('Cannot group pinned tabs'))).toBe('pinned_tab');
  });

  it('counts discarded tabs and history results', () => {
    expect(toolMetrics('tabs.discard', { tabIds: [1, 2] }, {})).toEqual({ tab_count: 2 });
    expect(toolMetrics('history.search', {}, [{}, {}, {}])).toEqual({ result_count: 3 });
  });

  it('ignores unknown methods', () => {
    expect(toolMetrics('nope', {}, {})).toEqual({});
  });
});
