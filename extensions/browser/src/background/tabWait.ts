import type { ParamsOf } from '@agent-browser-bridge/protocol';
import { serializeTab } from './serialize.ts';

export function wildcardMatcher(pattern: string): (value: string | undefined) => boolean {
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`^${escaped.join('.*')}$`, 'is');
  return (value) => value !== undefined && regex.test(value);
}

export async function waitForTab({ tabId, url, title, timeoutMs }: ParamsOf<'tabs.waitFor'>) {
  if (url === undefined && title === undefined) throw new Error('Pass url, title or both to say what to wait for.');
  const urlMatches = url === undefined ? () => true : wildcardMatcher(url);
  const titleMatches = title === undefined ? () => true : wildcardMatcher(title);
  const matches = (tab: chrome.tabs.Tab) => urlMatches(tab.url) && titleMatches(tab.title);
  const wanted = [url !== undefined && `url "${url}"`, title !== undefined && `title "${title}"`].filter(Boolean).join(' and ');
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      outcome();
    };
    const check = (tab: chrome.tabs.Tab) => {
      if (matches(tab)) finish(() => resolve({ ...serializeTab(tab), elapsedMs: Date.now() - started }));
    };
    const onUpdated = (updatedId: number, _info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (updatedId === tabId) check(tab);
    };
    const onRemoved = (removedId: number) => {
      if (removedId === tabId) finish(() => reject(new Error(`Tab ${tabId} was closed before its ${wanted} matched.`)));
    };
    const timer = setTimeout(() => {
      void chrome.tabs.get(tabId).then(
        (tab) => finish(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for tab ${tabId} to match ${wanted}. It is at url "${tab.url ?? ''}" with title "${tab.title ?? ''}".`))),
        () => finish(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for tab ${tabId} to match ${wanted}.`))),
      );
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(check, (err: unknown) => finish(() => reject(err)));
  });
}
