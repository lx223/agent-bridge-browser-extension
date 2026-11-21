import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForTab, wildcardMatcher } from './tabWait.ts';

type Listener = (...args: never[]) => void;

function event() {
  const listeners = new Set<Listener>();
  return {
    listeners,
    api: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    emit: (...args: unknown[]) => [...listeners].forEach((l) => (l as (...a: unknown[]) => void)(...args)),
  };
}

let tabs: Map<number, chrome.tabs.Tab>;
let onUpdated: ReturnType<typeof event>;
let onRemoved: ReturnType<typeof event>;

const tab = (id: number, url: string, title = 'Page') => ({ id, windowId: 1, index: 0, url, title, pinned: false, active: true }) as chrome.tabs.Tab;

function navigate(id: number, url: string, title = 'Page') {
  tabs.set(id, tab(id, url, title));
  onUpdated.emit(id, { url }, tabs.get(id));
}

beforeEach(() => {
  tabs = new Map([
    [1, tab(1, 'https://appstoreconnect.apple.com/login', 'Sign In')],
    [2, tab(2, 'https://example.com/', 'Example')],
  ]);
  onUpdated = event();
  onRemoved = event();
  vi.stubGlobal('chrome', {
    tabs: {
      get: async (id: number) => {
        const found = tabs.get(id);
        if (!found) throw new Error(`No tab with id: ${id}.`);
        return found;
      },
      onUpdated: onUpdated.api,
      onRemoved: onRemoved.api,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('wildcardMatcher', () => {
  it('matches the whole value, ignoring case, with * for any text', () => {
    const matches = wildcardMatcher('https://appstoreconnect.apple.com/apps*');
    expect(matches('https://AppStoreConnect.apple.com/apps/6837496354/distribution')).toBe(true);
    expect(matches('https://appstoreconnect.apple.com/login?targetUrl=/apps')).toBe(false);
    expect(matches(undefined)).toBe(false);
  });

  it('treats other characters literally', () => {
    expect(wildcardMatcher('a.b?(c)')('a.b?(c)')).toBe(true);
    expect(wildcardMatcher('a.b')('axb')).toBe(false);
  });
});

describe('waitForTab', () => {
  it('returns at once when the tab already matches', async () => {
    await expect(waitForTab({ tabId: 2, title: 'example', timeoutMs: 1000 })).resolves.toMatchObject({ id: 2, url: 'https://example.com/' });
    expect(onUpdated.listeners.size).toBe(0);
  });

  it('waits for the tab to reach a matching url and title, ignoring other tabs', async () => {
    const waiting = waitForTab({ tabId: 1, url: '*/apps/*', title: 'App Store Connect', timeoutMs: 1000 });
    await vi.waitFor(() => expect(onUpdated.listeners.size).toBe(1));
    navigate(2, 'https://example.com/apps/1', 'App Store Connect');
    navigate(1, 'https://appstoreconnect.apple.com/apps/1', 'Loading');
    navigate(1, 'https://appstoreconnect.apple.com/apps/1', 'App Store Connect');
    await expect(waiting).resolves.toMatchObject({ id: 1, url: 'https://appstoreconnect.apple.com/apps/1', title: 'App Store Connect' });
    expect(onUpdated.listeners.size).toBe(0);
    expect(onRemoved.listeners.size).toBe(0);
  });

  it('fails when the tab closes first', async () => {
    const waiting = waitForTab({ tabId: 1, url: '*/apps/*', timeoutMs: 1000 });
    await vi.waitFor(() => expect(onRemoved.listeners.size).toBe(1));
    onRemoved.emit(1, { windowId: 1, isWindowClosing: false });
    await expect(waiting).rejects.toThrow('Tab 1 was closed before its url "*/apps/*" matched.');
    expect(onUpdated.listeners.size).toBe(0);
  });

  it('fails after timeoutMs and says where the tab is', async () => {
    vi.useFakeTimers();
    const waiting = waitForTab({ tabId: 1, url: '*/apps/*', title: 'Done', timeoutMs: 120_000 });
    const outcome = waiting.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(outcome).resolves.toBe(
      'Timed out after 120000ms waiting for tab 1 to match url "*/apps/*" and title "Done". It is at url "https://appstoreconnect.apple.com/login" with title "Sign In".',
    );
    expect(onUpdated.listeners.size).toBe(0);
  });

  it('fails for a tab that does not exist', async () => {
    await expect(waitForTab({ tabId: 9, url: '*', timeoutMs: 1000 })).rejects.toThrow('No tab with id: 9.');
    expect(onUpdated.listeners.size).toBe(0);
  });

  it('needs something to wait for', async () => {
    await expect(waitForTab({ tabId: 1, timeoutMs: 1000 })).rejects.toThrow('Pass url, title or both');
  });
});
