import {
  ASK_CANCEL_METHOD,
  ASK_SHOW_METHOD,
  ASK_WAIT_METHOD,
  askCancelParams,
  askShowParams,
  askWaitParams,
  type AgentInfo,
  type AskAnswer,
  type AskCancelled,
  type AskCancelParams,
  type AskMethod,
  type AskShowParams,
  type AskShown,
  type AskState,
  type AskWaitParams,
} from '@agent-browser-bridge/protocol';
import { t, textDirection } from '../i18n/messages.ts';
import { readPopover, removePopover, showPopover, type PopoverAnswer, type PopoverContent } from './popover.ts';

export interface PagePrompt {
  show(tabId: number, content: PopoverContent): Promise<void>;
  read(tabId: number, askId: string): Promise<PopoverAnswer>;
  remove(tabId: number, askId: string): Promise<boolean>;
}

export interface DebuggerSend {
  <T = Record<string, unknown>>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T>;
}

interface EvaluateResult {
  result: { value?: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

const WORLD_NAME = 'agent-browser-bridge-ask';
const isGoneContext = (err: unknown) => err instanceof Error && /context/i.test(err.message);
const callOf = (fn: (arg: never) => unknown, arg: unknown) => `(${fn.toString()})(${JSON.stringify(arg)})`;

export function debuggerPrompt(send: DebuggerSend): PagePrompt {
  const worlds = new Map<string, number>();

  const evaluateIn = async (tabId: number, contextId: number, expression: string) => {
    const { result, exceptionDetails } = await send<EvaluateResult>(tabId, 'Runtime.evaluate', { expression, contextId, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  return {
    async show(tabId, content) {
      const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>(tabId, 'Page.getFrameTree');
      const { executionContextId } = await send<{ executionContextId: number }>(tabId, 'Page.createIsolatedWorld', {
        frameId: frameTree.frame.id,
        worldName: WORLD_NAME,
      });
      await evaluateIn(tabId, executionContextId, callOf(showPopover, content));
      worlds.set(content.askId, executionContextId);
    },
    async read(tabId, askId) {
      const contextId = worlds.get(askId);
      if (contextId === undefined) return 'gone';
      try {
        return (await evaluateIn(tabId, contextId, callOf(readPopover, askId))) as PopoverAnswer;
      } catch (err) {
        if (isGoneContext(err)) return 'gone';
        throw err;
      }
    },
    async remove(tabId, askId) {
      const contextId = worlds.get(askId);
      worlds.delete(askId);
      if (contextId === undefined) return false;
      try {
        return (await evaluateIn(tabId, contextId, callOf(removePopover, askId))) === true;
      } catch (err) {
        if (isGoneContext(err)) return false;
        throw err;
      }
    },
  };
}

export function scriptingPrompt(scripting: typeof chrome.scripting): PagePrompt {
  const run = async <A, R>(tabId: number, func: (arg: A) => R, arg: A): Promise<R | undefined> => {
    const [frame] = await scripting.executeScript({ target: { tabId }, func: func as (arg: unknown) => unknown, args: [arg] });
    return frame?.result as R | undefined;
  };
  return {
    async show(tabId, content) {
      await run(tabId, showPopover, content);
    },
    async read(tabId, askId) {
      return (await run(tabId, readPopover, askId)) ?? 'gone';
    },
    async remove(tabId, askId) {
      return (await run(tabId, removePopover, askId)) === true;
    },
  };
}

interface Ask {
  askId: string;
  tabId: number;
  answer: AskAnswer;
  finishedAt?: number;
}

export interface AskTabs {
  get(tabId: number): Promise<chrome.tabs.Tab>;
  query(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  update(tabId: number, props: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab | undefined>;
}

export interface AskNotifier {
  show(askId: string, from: string, content: { title?: string; message: string; url: string }): void;
  clear(askId: string): void;
}

export interface AskManagerOptions {
  prompt?: PagePrompt;
  tabs: AskTabs;
  focusWindow?: (windowId: number) => Promise<unknown>;
  notifier?: AskNotifier;
  now?: () => number;
  pollMs?: number;
  newId?: () => string;
}

const POLL_MS = 250;
const KEEP_FINISHED_MS = 10 * 60_000;
const UNSUPPORTED = 'This browser cannot show questions in its pages. Ask the user in the browser chat or in your own window instead.';

const agentName = (agent: AgentInfo | null) => agent?.client?.name ?? t('askYourAgent');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }, method: string, params: unknown): T {
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) throw new Error(`Invalid params for ${method}: ${parsed.error.message}`);
  return parsed.data;
}

export class AskManager {
  private readonly asks = new Map<string, Ask>();
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly newId: () => string;

  constructor(private readonly options: AskManagerOptions) {
    this.now = options.now ?? Date.now;
    this.pollMs = options.pollMs ?? POLL_MS;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async dispatch(method: AskMethod, params: unknown, agent: AgentInfo | null): Promise<AskShown | AskState | AskCancelled> {
    switch (method) {
      case ASK_SHOW_METHOD:
        return this.show(parse(askShowParams, method, params), agent);
      case ASK_WAIT_METHOD:
        return this.wait(parse(askWaitParams, method, params));
      case ASK_CANCEL_METHOD:
        return this.cancel(parse(askCancelParams, method, params));
    }
  }

  tabClosed(tabId: number) {
    for (const ask of this.asks.values()) {
      if (ask.tabId === tabId && ask.answer === 'pending') this.finish(ask, 'tabClosed');
    }
  }

  async reveal(askId: string): Promise<void> {
    const ask = this.asks.get(askId);
    if (!ask) return;
    const tab = await this.options.tabs.update(ask.tabId, { active: true }).catch(() => undefined);
    if (tab) await this.options.focusWindow?.(tab.windowId).catch(() => undefined);
  }

  async show(params: AskShowParams, agent: AgentInfo | null): Promise<AskShown> {
    const prompt = this.options.prompt;
    if (!prompt) throw new Error(UNSUPPORTED);
    this.forgetOld();
    const tab = await this.targetTab(params.tabId);
    const busy = [...this.asks.values()].find((ask) => ask.tabId === tab.id && ask.answer === 'pending');
    if (busy) throw new Error(`Tab ${tab.id} is already showing a question. Wait for its answer or ask in another tab.`);

    await this.options.tabs.update(tab.id!, { active: true });
    await this.options.focusWindow?.(tab.windowId).catch(() => undefined);

    const askId = this.newId();
    const from = agentName(agent);
    await prompt.show(tab.id!, {
      askId,
      heading: t('askFrom', from),
      message: params.message,
      confirmLabel: params.confirmLabel ?? t('askConfirm'),
      cancelLabel: params.cancelLabel ?? t('askCancel'),
      confirmedText: t('askConfirmed', from),
      cancelledText: t('askCancelled', from),
      dragHint: t('askDragHint'),
      dir: textDirection(),
      ...(params.title !== undefined && { title: params.title }),
    });
    this.asks.set(askId, { askId, tabId: tab.id!, answer: 'pending' });
    this.options.notifier?.show(askId, from, { message: params.message, url: tab.url ?? '', ...(params.title !== undefined && { title: params.title }) });
    return { askId, tab: { id: tab.id!, title: tab.title ?? '', url: tab.url ?? '' } };
  }

  async wait({ askId, waitMs }: AskWaitParams): Promise<AskState> {
    const ask = this.asks.get(askId);
    if (!ask) return { answer: 'expired' };
    const deadline = this.now() + waitMs;
    for (;;) {
      if (ask.answer !== 'pending') return { answer: ask.answer };
      await this.check(ask);
      if (ask.answer !== 'pending' || this.now() >= deadline) return { answer: ask.answer };
      await sleep(Math.min(this.pollMs, Math.max(0, deadline - this.now())));
    }
  }

  async cancel({ askId }: AskCancelParams): Promise<AskCancelled> {
    const ask = this.asks.get(askId);
    if (!ask) return { removed: false };
    const pending = ask.answer === 'pending';
    if (pending) this.finish(ask, 'cancelled');
    const removed = await this.options.prompt?.remove(ask.tabId, askId).catch(() => false);
    return { removed: pending && removed === true };
  }

  private async check(ask: Ask) {
    const seen = await this.options.prompt!.read(ask.tabId, ask.askId).catch(() => 'gone' as const);
    if (ask.answer !== 'pending' || seen === 'pending') return;
    if (seen !== 'gone') return this.finish(ask, seen);
    const open = await this.options.tabs.get(ask.tabId).then(
      () => true,
      () => false,
    );
    this.finish(ask, open ? 'navigated' : 'tabClosed');
  }

  private finish(ask: Ask, answer: AskAnswer) {
    ask.answer = answer;
    ask.finishedAt = this.now();
    this.options.notifier?.clear(ask.askId);
  }

  private forgetOld() {
    for (const [askId, ask] of this.asks) {
      if (ask.finishedAt !== undefined && this.now() - ask.finishedAt > KEEP_FINISHED_MS) this.asks.delete(askId);
    }
  }

  private async targetTab(tabId: number | undefined): Promise<chrome.tabs.Tab> {
    if (tabId !== undefined) return this.options.tabs.get(tabId);
    const [active] = await this.options.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id === undefined) throw new Error('No tab is active. Pass tabId.');
    return active;
  }
}

const NOTIFICATION_PREFIX = 'agent-browser-bridge-ask:';
const NOTIFICATION_ICON = 'icons/icon-128.png';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export function chromeAskNotifier(notifications: typeof chrome.notifications, reveal: (askId: string) => void): AskNotifier {
  notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFICATION_PREFIX)) return;
    reveal(id.slice(NOTIFICATION_PREFIX.length));
    void notifications.clear(id).catch(() => undefined);
  });
  return {
    show(askId, from, { title, message, url }) {
      void notifications
        .create(`${NOTIFICATION_PREFIX}${askId}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
          title: t('askNotificationTitle', from),
          message: title ?? message,
          contextMessage: hostOf(url),
          requireInteraction: true,
        })
        .catch(() => undefined);
    },
    clear(askId) {
      void notifications.clear(`${NOTIFICATION_PREFIX}${askId}`).catch(() => undefined);
    },
  };
}
