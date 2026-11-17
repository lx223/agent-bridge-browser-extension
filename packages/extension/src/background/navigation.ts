import type { ParamsOf } from '@agent-browser-bridge/protocol';
import { serializeTab } from './serialize.ts';

function watchForLoad(timeoutMs: number) {
  const completedEarly = new Set<number>();
  let target: number | undefined;
  let settle: (loaded: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => (settle = resolve));

  const listener = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
    if (info.status !== 'complete') return;
    if (target === undefined) completedEarly.add(tabId);
    else if (tabId === target) finish(true);
  };
  const timer = setTimeout(() => finish(false), timeoutMs);
  function finish(loaded: boolean) {
    clearTimeout(timer);
    chrome.tabs.onUpdated.removeListener(listener);
    settle(loaded);
  }
  chrome.tabs.onUpdated.addListener(listener);

  return {
    until(tabId: number) {
      target = tabId;
      if (completedEarly.has(tabId)) finish(true);
      return done;
    },
    cancel: () => finish(false),
  };
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function loadedTab(tabId: number, loaded: boolean) {
  return { ...serializeTab(await chrome.tabs.get(tabId)), loaded };
}

export async function openTab({ url, windowId, active }: ParamsOf<'tabs.create'>) {
  const watcher = watchForLoad(15_000);
  try {
    const tab = await chrome.tabs.create({
      active,
      ...(url !== undefined && { url: normalizeUrl(url) }),
      ...(windowId !== undefined && { windowId }),
    });
    return await loadedTab(tab.id!, await watcher.until(tab.id!));
  } catch (err) {
    watcher.cancel();
    throw err;
  }
}

export async function navigateTab({ tabId, to, timeoutMs }: ParamsOf<'tabs.navigate'>) {
  const watcher = watchForLoad(timeoutMs);
  try {
    const action = to.trim().toLowerCase();
    if (action === 'back') await chrome.tabs.goBack(tabId);
    else if (action === 'forward') await chrome.tabs.goForward(tabId);
    else if (action === 'reload') await chrome.tabs.reload(tabId);
    else await chrome.tabs.update(tabId, { url: normalizeUrl(to) });
    return await loadedTab(tabId, await watcher.until(tabId));
  } catch (err) {
    watcher.cancel();
    throw err;
  }
}
