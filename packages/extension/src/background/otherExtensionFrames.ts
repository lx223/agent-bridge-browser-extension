import { send } from './debugger.ts';
import { putBackOtherExtensionFramesInPage, setAsideOtherExtensionFramesInPage } from './framesInPage.ts';

const MAX_SET_ASIDE_ROUNDS = 3;
const OTHER_EXTENSION_FRAME_ERROR = /chrome-extension:\/\/ URL of different extension/i;

export const BLOCKED_BY_OTHER_EXTENSION =
  'Chrome does not allow page control in this tab because it shows a page or frame from another extension, such as a password manager, that could not be set aside. Turn that extension off for this site, or use another tab.';

const tabsWithFramesSetAside = new Set<number>();

export const isBlockedByOtherExtension = (err: unknown) => err instanceof Error && OTHER_EXTENSION_FRAME_ERROR.test(err.message);

async function inEveryFrame<A extends unknown[]>(tabId: number, func: (...args: A) => number, args: A): Promise<number> {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  return results.reduce((sum, frame) => sum + (typeof frame.result === 'number' ? frame.result : 0), 0);
}

export async function setAsideOtherExtensionFrames(tabId: number): Promise<number> {
  if (!chrome.scripting) return 0;
  const count = await inEveryFrame(tabId, setAsideOtherExtensionFramesInPage, [chrome.runtime.getURL('')]).catch(() => 0);
  if (count) tabsWithFramesSetAside.add(tabId);
  return count;
}

export async function putBackOtherExtensionFrames(tabId: number): Promise<void> {
  if (!tabsWithFramesSetAside.delete(tabId)) return;
  await inEveryFrame(tabId, putBackOtherExtensionFramesInPage, []).catch(() => 0);
}

export async function sendPastOtherExtensionFrames<T = Record<string, unknown>>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  for (let round = 1; ; round++) {
    try {
      return await send<T>(tabId, method, params);
    } catch (err) {
      if (!isBlockedByOtherExtension(err)) throw err;
      if (round > MAX_SET_ASIDE_ROUNDS || !(await setAsideOtherExtensionFrames(tabId))) throw new Error(BLOCKED_BY_OTHER_EXTENSION);
    }
  }
}

export function puttingBackOtherExtensionFrames<P extends { tabId: number }, R>(handler: (params: P) => Promise<R>): (params: P) => Promise<R> {
  return async (params) => {
    try {
      return await handler(params);
    } finally {
      await putBackOtherExtensionFrames(params.tabId);
    }
  };
}
