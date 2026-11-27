import { detach, isAttached, send } from './debugger.ts';

export type HistoryDirection = 'back' | 'forward';

interface NavigationHistory {
  currentIndex: number;
  entries: { id: number }[];
}

const isMissingHistoryError = (err: unknown) => err instanceof Error && /next page in history/i.test(err.message);
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function stepWithDebugger(tabId: number, direction: HistoryDirection) {
  const { currentIndex, entries } = await send<NavigationHistory>(tabId, 'Page.getNavigationHistory');
  const entry = entries[currentIndex + (direction === 'back' ? -1 : 1)];
  if (!entry) {
    const edge = direction === 'back' ? 'first' : 'last';
    throw new Error(`Cannot go ${direction}: the tab is on the ${edge} page of its history.`);
  }
  await send(tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
}

export async function stepHistory(tabId: number, direction: HistoryDirection): Promise<() => Promise<void>> {
  const nothingToRelease = async () => {};
  try {
    if (direction === 'back') await chrome.tabs.goBack(tabId);
    else await chrome.tabs.goForward(tabId);
    return nothingToRelease;
  } catch (err) {
    if (!isMissingHistoryError(err) || !chrome.debugger) throw err;
  }

  const attachedBefore = isAttached(tabId);
  const release = attachedBefore ? nothingToRelease : async () => void (await detach(tabId).catch(() => false));
  try {
    await stepWithDebugger(tabId, direction);
    return release;
  } catch (err) {
    await release();
    if (/^Cannot go /.test(messageOf(err))) throw err;
    throw new Error(
      `Cannot go ${direction}: Chrome refused the history step and the debugger fallback failed (${messageOf(err)}). Navigate to the URL you want instead.`,
    );
  }
}
