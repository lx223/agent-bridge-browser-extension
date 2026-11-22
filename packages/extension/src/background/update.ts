export const MAX_UPDATE_WAIT_MS = 60_000;

export interface UpdatableRuntime {
  onUpdateAvailable?: { addListener(callback: () => void): void };
  reload(): void;
}

export interface UpdateOptions {
  beforeReload?: () => Promise<void>;
  maxWaitMs?: number;
}

export function applyUpdatesWhenIdle(runtime: UpdatableRuntime, whenIdle: () => Promise<void>, { beforeReload, maxWaitMs = MAX_UPDATE_WAIT_MS }: UpdateOptions = {}) {
  let waiting = false;
  runtime.onUpdateAvailable?.addListener(() => {
    if (waiting) return;
    waiting = true;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs));
    void Promise.race([whenIdle(), timeout])
      .then(() => beforeReload?.())
      .catch(() => undefined)
      .then(() => runtime.reload());
  });
}
