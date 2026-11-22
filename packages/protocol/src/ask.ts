import { z } from 'zod';

export const ASK_USER_TOOL = 'browser_ask_user';

export const ASK_SHOW_METHOD = 'ask.show';
export const ASK_WAIT_METHOD = 'ask.wait';
export const ASK_CANCEL_METHOD = 'ask.cancel';
export const askMethods = [ASK_SHOW_METHOD, ASK_WAIT_METHOD, ASK_CANCEL_METHOD] as const;
export type AskMethod = (typeof askMethods)[number];
export const isAskMethod = (method: string): method is AskMethod => (askMethods as readonly string[]).includes(method);

export const askBrowsers = ['chrome', 'safari'] as const;

export const MAX_ASK_TITLE_LENGTH = 120;
export const MAX_ASK_MESSAGE_LENGTH = 1_000;
export const MAX_ASK_LABEL_LENGTH = 30;
export const MAX_ASK_WAIT_MS = 20_000;

export const askShowParams = z.object({
  tabId: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(MAX_ASK_TITLE_LENGTH).optional(),
  message: z.string().trim().min(1).max(MAX_ASK_MESSAGE_LENGTH),
  confirmLabel: z.string().trim().min(1).max(MAX_ASK_LABEL_LENGTH).default('Confirm'),
  cancelLabel: z.string().trim().min(1).max(MAX_ASK_LABEL_LENGTH).default('Cancel'),
});

export const askTab = z.object({ id: z.number().int(), title: z.string(), url: z.string() });

export const askShown = z.object({ askId: z.string().min(1), tab: askTab });

export const askWaitParams = z.object({
  askId: z.string().min(1),
  waitMs: z.number().int().min(0).max(MAX_ASK_WAIT_MS).default(0),
});

export const askCancelParams = z.object({ askId: z.string().min(1) });

export const askAnswer = z.enum(['pending', 'confirmed', 'cancelled', 'navigated', 'tabClosed', 'expired']);

export const askState = z.object({ answer: askAnswer });

export const askCancelled = z.object({ removed: z.boolean() });

export type AskShowParams = z.output<typeof askShowParams>;
export type AskWaitParams = z.output<typeof askWaitParams>;
export type AskCancelParams = z.infer<typeof askCancelParams>;
export type AskTab = z.infer<typeof askTab>;
export type AskShown = z.infer<typeof askShown>;
export type AskAnswer = z.infer<typeof askAnswer>;
export type AskState = z.infer<typeof askState>;
export type AskCancelled = z.infer<typeof askCancelled>;
