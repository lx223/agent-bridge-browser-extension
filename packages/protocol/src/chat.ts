import { z } from 'zod';

export const CHAT_SEND_TOOL = 'browser_chat_send';
export const CHAT_RECEIVE_TOOL = 'browser_chat_receive';
export const CHAT_PROMPT = 'continue_in_browser';

export const CHAT_SEND_METHOD = 'chat.send';
export const CHAT_RECEIVE_METHOD = 'chat.receive';
export const CHAT_PEEK_METHOD = 'chat.peek';
export const chatMethods = [CHAT_SEND_METHOD, CHAT_RECEIVE_METHOD, CHAT_PEEK_METHOD] as const;
export type ChatMethod = (typeof chatMethods)[number];
export const isChatMethod = (method: string): method is ChatMethod => (chatMethods as readonly string[]).includes(method);

export const chatToolNames: Record<ChatMethod, string> = {
  [CHAT_SEND_METHOD]: CHAT_SEND_TOOL,
  [CHAT_RECEIVE_METHOD]: CHAT_RECEIVE_TOOL,
  [CHAT_PEEK_METHOD]: CHAT_RECEIVE_TOOL,
};

export const chatBrowsers = ['chrome'] as const;

export const MAX_CHAT_MESSAGE_LENGTH = 20_000;
export const MAX_CHAT_RECEIVE_WAIT_MS = 20_000;
export const MAX_CHAT_AGENT_SESSION_ID_LENGTH = 200;
export const MAX_CHAT_AGENT_SESSION_NAME_LENGTH = 100;

const cursor = z.number().int().nonnegative().optional();
const conversationId = z.string().optional();

export const chatAgentSession = z.object({
  id: z.string().min(1).max(MAX_CHAT_AGENT_SESSION_ID_LENGTH),
  name: z.string().min(1).max(MAX_CHAT_AGENT_SESSION_NAME_LENGTH).optional(),
});

export const chatSendParams = z.object({ text: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH), agentSession: chatAgentSession.optional() });
export const chatReceiveParams = z.object({
  waitMs: z.number().int().min(0).max(MAX_CHAT_RECEIVE_WAIT_MS).default(0),
  after: cursor,
  conversation: conversationId,
  agentSession: chatAgentSession.optional(),
});
export const chatPeekParams = z.object({ after: cursor, conversation: conversationId, agentSession: chatAgentSession.optional() });

export const chatTab = z.object({ title: z.string(), url: z.string() });

export const chatUserMessage = z.object({
  seq: z.number().int().nonnegative(),
  text: z.string(),
  sentAt: z.number(),
  tab: chatTab.optional(),
});

export const chatInbox = z.object({
  messages: z.array(chatUserMessage),
  ended: z.boolean(),
  conversation: conversationId,
});

export const chatPeek = z.object({
  unread: z.number().int(),
  ended: z.boolean(),
  conversation: conversationId,
});

export type ChatAgentSession = z.infer<typeof chatAgentSession>;
export type ChatTab = z.infer<typeof chatTab>;
export type ChatUserMessage = z.infer<typeof chatUserMessage>;
export type ChatInbox = z.infer<typeof chatInbox>;
export type ChatPeek = z.infer<typeof chatPeek>;
export type ChatSendParams = z.infer<typeof chatSendParams>;
export type ChatReceiveParams = z.output<typeof chatReceiveParams>;
export type ChatPeekParams = z.infer<typeof chatPeekParams>;
