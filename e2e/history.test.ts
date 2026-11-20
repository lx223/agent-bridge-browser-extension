import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type Tab } from './harness.ts';

interface HistoryItem {
  id: string;
  url: string;
  title: string;
  lastVisitTime: number;
  visitCount: number;
}

interface VisitItem {
  visitId: string;
  visitTime: number;
  transition: string;
}

interface SessionTab extends Tab {
  sessionId: string;
}

interface Session {
  lastModified: number;
  tab?: SessionTab;
  window?: { sessionId: string; tabs: SessionTab[] };
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const tabs = () => harness.agent.call<Tab[]>('chrome_list_tabs');
const searchHistory = (args: Record<string, unknown>) => harness.agent.call<HistoryItem[]>('chrome_search_history', args);
const recentlyClosed = () => harness.agent.call<Session[]>('chrome_list_recently_closed');

describe('history and sessions through the built server and extension', () => {
  it('searches history and lists visits to a page', async () => {
    const startTime = Date.now() - 60_000;
    await harness.openFixture('second.html');
    const url = harness.fixture('second.html');

    await expect.poll(async () => (await searchHistory({ text: 'Second page', startTime })).map((item) => item.url)).toContain(url);
    const [item] = (await searchHistory({ text: 'Second page', startTime })).filter((entry) => entry.url === url);
    expect(item).toMatchObject({ title: 'Second page', visitCount: expect.any(Number) });
    expect(item!.lastVisitTime).toBeGreaterThanOrEqual(startTime);

    expect(await searchHistory({ text: 'Second page', startTime, endTime: startTime - 1 })).toEqual([]);

    const visits = await harness.agent.call<VisitItem[]>('chrome_list_history_visits', { url });
    expect(visits.length).toBeGreaterThan(0);
    expect(visits[0]).toMatchObject({ visitTime: expect.any(Number), transition: expect.any(String) });
  });

  it('lists a closed tab and restores it by session id', async () => {
    const tab = await harness.openFixture('form.html');
    await harness.agent.call('chrome_close_tabs', { tabIds: [tab.id] });

    await expect.poll(async () => (await recentlyClosed())[0]?.tab?.url).toBe(harness.fixture('form.html'));
    const [latest] = await recentlyClosed();
    expect(latest!.lastModified).toBeGreaterThan(0);
    expect(latest!.tab!.sessionId).toEqual(expect.any(String));

    const restored = await harness.agent.call<Session>('chrome_restore_session', { sessionId: latest!.tab!.sessionId });
    expect(restored.tab).toMatchObject({ url: harness.fixture('form.html'), id: expect.any(Number) });
    expect((await tabs()).map((t) => t.id)).toContain(restored.tab!.id);
    await harness.agent.call('chrome_close_tabs', { tabIds: [restored.tab!.id] });
  });

  it('restores the most recently closed tab without a session id', async () => {
    const tab = await harness.openFixture('second.html');
    await harness.agent.call('chrome_close_tabs', { tabIds: [tab.id] });
    await expect.poll(async () => (await recentlyClosed())[0]?.tab?.url).toBe(harness.fixture('second.html'));

    const restored = await harness.agent.call<Session>('chrome_restore_session');
    expect(restored.tab).toMatchObject({ url: harness.fixture('second.html') });
    await harness.agent.call('chrome_close_tabs', { tabIds: [restored.tab!.id] });
  });

  it('lists no other devices when sync is off', async () => {
    expect(await harness.agent.call('chrome_list_device_sessions')).toEqual([]);
  });

  it('reports an unknown session id as a tool error', async () => {
    const result = await harness.agent.raw('chrome_restore_session', { sessionId: 'missing' });
    expect(result.isError).toBe(true);
  });
});
