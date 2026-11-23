export const ANALYTICS_ENABLED_KEY = 'analyticsEnabled';
const DISTINCT_ID_KEY = 'analyticsDistinctId';

export const PAGE_EVENTS = ['setup_link_clicked', 'setup_snippet_copied'] as const;
export type PageEvent = (typeof PAGE_EVENTS)[number];
export const isPageEvent = (event: unknown): event is PageEvent => PAGE_EVENTS.includes(event as PageEvent);

export type Properties = Record<string, string | number | boolean | null>;

interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface AnalyticsConfig {
  apiKey: string | undefined;
  host: string;
  version: string;
  storage: LocalStorage;
  fetch: typeof fetch;
  randomId?: () => string;
}

export const APP_TAG = 'agent-browser-bridge';

export class Analytics {
  constructor(private readonly config: AnalyticsConfig) {}

  async isEnabled() {
    if (!this.config.apiKey) return false;
    const stored = await this.config.storage.get(ANALYTICS_ENABLED_KEY);
    return stored[ANALYTICS_ENABLED_KEY] !== false;
  }

  async capture(event: string, properties: Properties = {}) {
    try {
      if (!(await this.isEnabled())) return;
      await this.config.fetch(`${this.config.host.replace(/\/$/, '')}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          event,
          distinct_id: await this.distinctId(),
          timestamp: new Date().toISOString(),
          properties: {
            ...properties,
            app: APP_TAG,
            extension_version: this.config.version,
            $lib: 'agent-browser-bridge-extension',
            $process_person_profile: false,
          },
        }),
      });
    } catch {
      return;
    }
  }

  async distinctId() {
    const stored = await this.config.storage.get(DISTINCT_ID_KEY);
    const existing = stored[DISTINCT_ID_KEY];
    if (typeof existing === 'string') return existing;
    const id = (this.config.randomId ?? (() => crypto.randomUUID()))();
    await this.config.storage.set({ [DISTINCT_ID_KEY]: id });
    return id;
  }
}
