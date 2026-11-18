import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdatesWhenIdle, MAX_UPDATE_WAIT_MS } from './update.ts';

function fakeRuntime() {
  const listeners: (() => void)[] = [];
  return {
    onUpdateAvailable: { addListener: (callback: () => void) => listeners.push(callback) },
    reload: vi.fn(),
    announceUpdate: () => listeners.forEach((listener) => listener()),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('applyUpdatesWhenIdle', () => {
  it('reloads straight away when nothing is running', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, async () => {});
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('waits for requests in flight to finish', async () => {
    const runtime = fakeRuntime();
    let idle: () => void = () => {};
    applyUpdatesWhenIdle(runtime, () => new Promise((resolve) => (idle = resolve)));
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).not.toHaveBeenCalled();
    idle();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when a request never finishes', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, () => new Promise(() => {}));
    runtime.announceUpdate();
    await vi.advanceTimersByTimeAsync(MAX_UPDATE_WAIT_MS - 1);
    expect(runtime.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when the update is announced again', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, async () => {});
    runtime.announceUpdate();
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });
});
