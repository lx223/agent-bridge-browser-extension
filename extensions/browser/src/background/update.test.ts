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

function fakeClient(whenIdle: () => Promise<void> = async () => {}) {
  return { whenIdle, announceReload: vi.fn(async () => {}) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('applyUpdatesWhenIdle', () => {
  it('reloads straight away when nothing is running', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, fakeClient());
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('waits for requests in flight to finish', async () => {
    const runtime = fakeRuntime();
    let idle: () => void = () => {};
    applyUpdatesWhenIdle(runtime, fakeClient(() => new Promise((resolve) => (idle = resolve))));
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).not.toHaveBeenCalled();
    idle();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when a request never finishes', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, fakeClient(() => new Promise(() => {})));
    runtime.announceUpdate();
    await vi.advanceTimersByTimeAsync(MAX_UPDATE_WAIT_MS - 1);
    expect(runtime.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('saves state before announcing the reload, once requests have finished', async () => {
    const runtime = fakeRuntime();
    const order: string[] = [];
    runtime.reload.mockImplementation(() => order.push('reload'));
    let idle: () => void = () => {};
    const client = fakeClient(() => new Promise((resolve) => (idle = resolve)));
    client.announceReload.mockImplementation(async () => {
      order.push('announce');
    });
    applyUpdatesWhenIdle(runtime, client, {
      beforeReload: async () => {
        order.push('save');
      },
    });
    runtime.announceUpdate();
    await flush();
    expect(order).toEqual([]);
    idle();
    await flush();
    expect(order).toEqual(['save', 'announce', 'reload']);
  });

  it('reloads even when saving state fails', async () => {
    const runtime = fakeRuntime();
    const client = fakeClient();
    applyUpdatesWhenIdle(runtime, client, { beforeReload: () => Promise.reject(new Error('quota exceeded')) });
    runtime.announceUpdate();
    await flush();
    expect(client.announceReload).toHaveBeenCalledTimes(1);
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when the update is announced again', async () => {
    const runtime = fakeRuntime();
    applyUpdatesWhenIdle(runtime, fakeClient());
    runtime.announceUpdate();
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('tells the server it is reloading before it reloads', async () => {
    const runtime = fakeRuntime();
    const order: string[] = [];
    runtime.reload.mockImplementation(() => order.push('reload'));
    const client = fakeClient();
    client.announceReload.mockImplementation(async () => {
      order.push('announce');
    });
    applyUpdatesWhenIdle(runtime, client);
    runtime.announceUpdate();
    await flush();
    expect(order).toEqual(['announce', 'reload']);
  });

  it('reloads even when the announcement fails', async () => {
    const runtime = fakeRuntime();
    const client = fakeClient();
    client.announceReload.mockRejectedValue(new Error('socket gone'));
    applyUpdatesWhenIdle(runtime, client);
    runtime.announceUpdate();
    await flush();
    expect(runtime.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser without update events, such as Safari', () => {
    const reload = vi.fn();
    expect(() => applyUpdatesWhenIdle({ reload }, fakeClient())).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
