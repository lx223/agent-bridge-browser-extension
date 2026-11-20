import type { AgentInfo } from '@agent-browser-bridge/protocol';
import type { Analytics, Properties } from './analytics.ts';

const INSTALLED_AT_KEY = 'analyticsInstalledAt';
const LAST_ACTIVE_DAY_KEY = 'analyticsLastActiveDay';
const LAST_PLAN_APPLIED_AT_KEY = 'analyticsLastPlanAppliedAt';
const MILESTONE_PREFIX = 'analyticsMilestone:';

type Milestone = 'first_connected' | 'first_plan_applied';

interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface UsageDeps {
  analytics: Analytics;
  storage: LocalStorage;
  countBrowser: () => Promise<{ tabs: number; windows: number }>;
  now?: () => number;
}

export interface ToolOutcome {
  method: string;
  params: unknown;
  agent: AgentInfo | null;
  durationMs: number;
  result?: unknown;
  error?: unknown;
}

const ERROR_CODES: [RegExp, string][] = [
  [/^Unknown method/, 'unknown_method'],
  [/^Invalid params/, 'invalid_params'],
  [/No tab with id/i, 'tab_not_found'],
  [/No group with id/i, 'group_not_found'],
  [/No window with id/i, 'window_not_found'],
  [/pinned/i, 'pinned_tab'],
  [/^Nothing to undo/, 'nothing_to_undo'],
];

export function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return ERROR_CODES.find(([pattern]) => pattern.test(message))?.[1] ?? 'other';
}

export function tabCountBucket(count: number) {
  if (count <= 10) return '1-10';
  if (count <= 25) return '11-25';
  if (count <= 50) return '26-50';
  if (count <= 100) return '51-100';
  return '100+';
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);

export function toolMetrics(method: string, params: unknown, result: unknown): Properties {
  const p = asRecord(params);
  const r = asRecord(result);
  switch (method) {
    case 'tabs.list':
      return { tab_count: lengthOf(result) };
    case 'windows.list':
      return { window_count: lengthOf(result) };
    case 'tabGroups.list':
      return { group_count: lengthOf(result) };
    case 'tabs.group':
    case 'tabs.ungroup':
    case 'tabs.move':
    case 'tabs.close':
    case 'tabs.discard':
      return { tab_count: lengthOf(p.tabIds) };
    case 'history.search':
    case 'sessions.getRecentlyClosed':
      return { result_count: lengthOf(result) };
    case 'plan.apply': {
      const groups = Array.isArray(p.groups) ? p.groups.map(asRecord) : [];
      return {
        dry_run: p.dryRun === true,
        group_count: groups.length,
        tabs_grouped: groups.reduce((sum, g) => sum + lengthOf(g.tabIds), 0),
        tabs_ungrouped: lengthOf(p.ungroupTabIds),
        warning_count: lengthOf(r.warnings),
      };
    }
    case 'plan.undo':
      return {
        tabs_restored: typeof r.tabs === 'number' ? r.tabs : 0,
        groups_restored: typeof r.groups === 'number' ? r.groups : 0,
        warning_count: lengthOf(r.warnings),
      };
    default:
      return {};
  }
}

export class UsageTracker {
  private lastClient: string | null = null;
  private connected = false;
  private readonly milestones = new Map<Milestone, Promise<void>>();

  constructor(private readonly deps: UsageDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private async read<T>(key: string) {
    return (await this.deps.storage.get(key))[key] as T | undefined;
  }

  async installed() {
    await this.deps.storage.set({ [INSTALLED_AT_KEY]: this.now() });
    await this.deps.analytics.capture('extension_installed');
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) this.lastClient = null;
  }

  milestone(name: Milestone) {
    const running = this.milestones.get(name);
    if (running) return running;
    const task = (async () => {
      const key = MILESTONE_PREFIX + name;
      if (await this.read(key)) return;
      await this.deps.storage.set({ [key]: this.now() });
      const installedAt = await this.read<number>(INSTALLED_AT_KEY);
      await this.deps.analytics.capture(name, {
        minutes_since_install: installedAt === undefined ? null : Math.round((this.now() - installedAt) / 60_000),
      });
    })();
    this.milestones.set(name, task);
    return task;
  }

  async toolCalled({ method, params, agent, durationMs, result, error }: ToolOutcome) {
    const ok = error === undefined;
    if (agent?.client) this.lastClient = agent.client.name;
    const properties: Properties = {
      method,
      ok,
      duration_ms: durationMs,
      client_name: agent?.client?.name ?? null,
      client_version: agent?.client?.version ?? null,
      server_version: agent?.serverVersion ?? null,
      ...(ok ? toolMetrics(method, params, result) : { error_code: errorCode(error) }),
    };
    const dryRun = asRecord(params).dryRun === true;

    if (ok && method === 'plan.undo') {
      const appliedAt = await this.read<number>(LAST_PLAN_APPLIED_AT_KEY);
      properties.minutes_since_apply = appliedAt === undefined ? null : Math.round((this.now() - appliedAt) / 60_000);
    }
    await this.deps.analytics.capture('tool_called', properties);

    if (ok && method === 'plan.apply' && !dryRun) {
      await this.deps.storage.set({ [LAST_PLAN_APPLIED_AT_KEY]: this.now() });
      await this.milestone('first_plan_applied');
    }
  }

  async dailyActive() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if ((await this.read(LAST_ACTIVE_DAY_KEY)) === day) return;
    await this.deps.storage.set({ [LAST_ACTIVE_DAY_KEY]: day });
    const counts = await this.deps.countBrowser().catch(() => undefined);
    await this.deps.analytics.capture('extension_active', {
      agent_connected: this.connected,
      tab_count_bucket: counts ? tabCountBucket(counts.tabs) : null,
      window_count: counts?.windows ?? null,
      client_name: this.lastClient,
    });
  }
}
