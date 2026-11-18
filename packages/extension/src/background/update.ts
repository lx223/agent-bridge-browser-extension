export const MAX_UPDATE_WAIT_MS = 60_000;

export interface UpdatableRuntime {
  onUpdateAvailable: { addListener(callback: () => void): void };
  reload(): void;
}

export function applyUpdatesWhenIdle(runtime: UpdatableRuntime, whenIdle: () => Promise<void>, maxWaitMs = MAX_UPDATE_WAIT_MS) {
  let waiting = false;
  runtime.onUpdateAvailable.addListener(() => {
    if (waiting) return;
    waiting = true;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs));
    void Promise.race([whenIdle(), timeout]).then(() => runtime.reload());
  });
}
