const PROTOCOL_VERSION = '1.3';
const IDLE_DETACH_MS = 5 * 60_000;

const attached = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

const isNotAttachedError = (err: unknown) => err instanceof Error && /not attached/i.test(err.message);
const isAlreadyAttachedError = (err: unknown) => err instanceof Error && /already attached/i.test(err.message);

function forget(tabId: number) {
  attached.delete(tabId);
  clearTimeout(idleTimers.get(tabId));
  idleTimers.delete(tabId);
}

function scheduleIdleDetach(tabId: number) {
  clearTimeout(idleTimers.get(tabId));
  idleTimers.set(
    tabId,
    setTimeout(() => void detach(tabId), IDLE_DETACH_MS),
  );
}

export const isAttached = (tabId: number) => attached.has(tabId);

async function attach(tabId: number) {
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (err) {
    if (!isAlreadyAttachedError(err)) throw err;
  }
  attached.add(tabId);
}

export async function detach(tabId: number): Promise<boolean> {
  const wasAttached = attached.has(tabId);
  forget(tabId);
  try {
    await chrome.debugger.detach({ tabId });
    return true;
  } catch (err) {
    if (isNotAttachedError(err)) return wasAttached;
    throw err;
  }
}

export async function send<T = Record<string, unknown>>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!attached.has(tabId)) await attach(tabId);
  scheduleIdleDetach(tabId);
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } catch (err) {
    if (!isNotAttachedError(err)) throw err;
    forget(tabId);
    await attach(tabId);
    scheduleIdleDetach(tabId);
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  }
}

export function listenForDetach() {
  chrome.debugger?.onDetach.addListener((source) => {
    if (source.tabId !== undefined) forget(source.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => forget(tabId));
}
