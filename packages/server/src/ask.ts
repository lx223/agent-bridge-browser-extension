import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ASK_CANCEL_METHOD,
  ASK_SHOW_METHOD,
  ASK_USER_TOOL,
  ASK_WAIT_METHOD,
  askBrowsers,
  askShown,
  askState,
  browserLabels,
  CHAT_SEND_TOOL,
  MAX_ASK_LABEL_LENGTH,
  MAX_ASK_MESSAGE_LENGTH,
  MAX_ASK_TITLE_LENGTH,
  MAX_ASK_WAIT_MS,
  STATUS_TOOL,
  type AskAnswer,
  type AskTab,
} from '@agent-browser-bridge/protocol';
import type { BrowserBridge } from './bridge.ts';
import type { InstanceSelector } from './instances.ts';

export const DEFAULT_ASK_WAIT_SECONDS = 120;
export const MAX_ASK_WAIT_SECONDS = 600;

type Outcome = Exclude<AskAnswer, 'pending'> | 'timeout';

interface Extra {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message?: string } }) => Promise<void>;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const OUTDATED_EXTENSION = 'This browser runs an older Agent Browser Bridge extension that cannot show questions in pages. Ask the user to update the extension, and ask in your own window meanwhile.';

export const nextSteps: Record<Outcome, string> = {
  confirmed: 'The user confirmed. Go ahead.',
  cancelled: 'The user said no. Do not go ahead; ask what they would like instead.',
  navigated: 'The page changed before the user answered, so the question is gone. Check the page again and ask again if it still matters.',
  tabClosed: 'The user closed the tab before answering. Do not go ahead.',
  expired: 'The browser lost the question, for example because the extension restarted. Ask again.',
  timeout: 'The user did not answer in time and the question was removed. Do not go ahead; ask again or ask in your own window.',
};

const description =
  `Ask the user to confirm something in a small popover inside a browser tab, and wait for their answer. The tab is brought to the front, and Chrome also shows a desktop notification. Use it for a yes or no decision about what you are about to do in the browser, such as submitting a form, sending a message, buying or deleting, when the user is likely looking at the browser rather than your window. ` +
  `Pass the browser whose tab ids you use; tabId defaults to the active tab. Returns answer: confirmed, cancelled, navigated (the page changed first), tabClosed, expired or timeout. Only go ahead on confirmed. ` +
  `If a browser chat is open, ask there with ${CHAT_SEND_TOOL} instead. The popover is part of the page, so the website can read its text: never put secrets in it.`;

export class BrowserAsk {
  constructor(
    private readonly bridge: BrowserBridge,
    private readonly selector: InstanceSelector,
  ) {}

  async ask(
    { browser, instance, timeoutSeconds, ...question }: AskArgs,
    extra: Extra,
  ): Promise<{ answer: Outcome; tab: AskTab; elapsedMs: number; next: string }> {
    await this.bridge.ready(browser);
    const selected = this.selector.select(browser, instance);
    const call = (method: string, params: unknown) => this.call(browser, selected.instance, method, params);
    const started = Date.now();
    const shown = askShown.parse(await call(ASK_SHOW_METHOD, question));
    const deadline = started + timeoutSeconds * 1000;
    const result = (answer: Outcome) => ({ answer, tab: shown.tab, elapsedMs: Date.now() - started, next: nextSteps[answer] });
    try {
      for (let round = 1; ; round++) {
        const waitMs = Math.max(0, Math.min(MAX_ASK_WAIT_MS, deadline - Date.now()));
        const { answer } = askState.parse(await call(ASK_WAIT_METHOD, { askId: shown.askId, waitMs }));
        if (answer !== 'pending') return result(answer);
        if (extra.signal.aborted || Date.now() >= deadline) {
          await call(ASK_CANCEL_METHOD, { askId: shown.askId }).catch(() => undefined);
          return result('timeout');
        }
        await this.report(extra, round);
      }
    } catch (err) {
      await call(ASK_CANCEL_METHOD, { askId: shown.askId }).catch(() => undefined);
      throw err;
    }
  }

  private async report(extra: Extra, progress: number) {
    const progressToken = extra._meta?.progressToken;
    if (progressToken === undefined) return;
    await extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, message: 'Waiting for the user to answer in the browser' } })
      .catch(() => undefined);
  }

  private async call(browser: string, instance: string | undefined, method: string, params: unknown): Promise<unknown> {
    try {
      return await this.bridge.request(browser, method, params, undefined, instance);
    } catch (err) {
      if (errorMessage(err).includes(`Unknown method: ${method}`)) throw new Error(OUTDATED_EXTENSION);
      throw err;
    }
  }
}

const askInput = {
  browser: z.enum(askBrowsers).describe(`Which browser shows the question: the one whose tab you mean. ${Object.values(browserLabels).join(' and ')} are supported.`),
  message: z.string().trim().min(1).max(MAX_ASK_MESSAGE_LENGTH).describe('What you are asking, in plain words. Say what will happen if they confirm.'),
  title: z.string().trim().min(1).max(MAX_ASK_TITLE_LENGTH).optional().describe('A short question shown in bold above the message, such as "Submit the order?".'),
  confirmLabel: z.string().trim().min(1).max(MAX_ASK_LABEL_LENGTH).optional().describe('Text of the confirm button, such as "Submit order". Defaults to Confirm in the user\'s language.'),
  cancelLabel: z.string().trim().min(1).max(MAX_ASK_LABEL_LENGTH).optional().describe('Text of the cancel button. Defaults to Cancel in the user\'s language.'),
  tabId: z.number().int().nonnegative().optional().describe('The tab to ask in. Defaults to the active tab.'),
  instance: z
    .string()
    .optional()
    .describe(`Which instance of this browser, by instanceId from ${STATUS_TOOL} or by name. Only needed when several are connected; later calls stay on the same one.`),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_ASK_WAIT_SECONDS)
    .default(DEFAULT_ASK_WAIT_SECONDS)
    .describe('How long to wait for an answer before removing the question.'),
};

export type AskArgs = z.output<z.ZodObject<typeof askInput>>;

export function registerAskTool(server: McpServer, ask: BrowserAsk) {
  server.registerTool(
    ASK_USER_TOOL,
    {
      description,
      inputSchema: askInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await ask.ask(args as AskArgs, extra as Extra), null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: errorMessage(err) }], isError: true };
      }
    },
  );
}
