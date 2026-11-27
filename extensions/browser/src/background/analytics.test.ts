import { describe, expect, it, vi } from 'vitest';
import { Analytics, ANALYTICS_ENABLED_KEY, isPageEvent } from './analytics.ts';

function setup(initial: Record<string, unknown> = {}, apiKey: string | undefined = 'phc_test') {
  const store: Record<string, unknown> = { ...initial };
  const fetch = vi.fn(async () => new Response('{}'));
  const analytics = new Analytics({
    apiKey,
    host: 'https://eu.i.posthog.com/',
    version: '1.2.3',
    storage: {
      get: async (key) => (key in store ? { [key]: store[key] } : {}),
      set: async (items) => void Object.assign(store, items),
    },
    fetch,
    randomId: () => 'anon-id',
  });
  const bodies = () => fetch.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
  return { analytics, fetch, store, bodies };
}

describe('Analytics', () => {
  it('posts an anonymous event to the capture endpoint', async () => {
    const { analytics, fetch, bodies } = setup();
    await analytics.capture('tool_called', { method: 'tabs.list', ok: true });
    expect(fetch).toHaveBeenCalledWith('https://eu.i.posthog.com/i/v0/e/', expect.objectContaining({ method: 'POST' }));
    expect(bodies()[0]).toMatchObject({
      api_key: 'phc_test',
      event: 'tool_called',
      distinct_id: 'anon-id',
      properties: { method: 'tabs.list', ok: true, extension_version: '1.2.3', $process_person_profile: false },
    });
  });

  it('reuses the stored distinct id', async () => {
    const { analytics, bodies } = setup({ analyticsDistinctId: 'existing' });
    await analytics.capture('bridge_connected');
    expect(bodies()[0].distinct_id).toBe('existing');
  });

  it('sends nothing without an api key', async () => {
    const { analytics, fetch } = setup({}, '');
    await analytics.capture('bridge_connected');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends nothing after the user opts out', async () => {
    const { analytics, fetch } = setup({ [ANALYTICS_ENABLED_KEY]: false });
    await analytics.capture('bridge_connected');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('swallows network failures', async () => {
    const { analytics, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(analytics.capture('bridge_connected')).resolves.toBeUndefined();
  });

  it('accepts only known page events', () => {
    expect(isPageEvent('setup_link_clicked')).toBe(true);
    expect(isPageEvent('tool_called')).toBe(false);
  });
});
