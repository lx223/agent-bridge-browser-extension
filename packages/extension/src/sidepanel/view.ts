import type { AgentSession } from '@agent-browser-bridge/protocol';
import { isListening, unseenCount, type ChatMessage, type Conversation, type Conversations } from '../background/chat.ts';
import { clockTime, plural, relativeTime, t, type MessageKey } from '../i18n/messages.ts';

export type ConversationState = 'waiting' | 'working' | 'disconnected' | 'ended';

export interface ConversationOption {
  sessionId: string;
  label: string;
}

export interface MessageView {
  key: string;
  from: ChatMessage['from'];
  text: string;
  meta: string;
}

export interface PanelView {
  options: ConversationOption[];
  selected?: string;
  title: string;
  state?: ConversationState;
  status: string;
  messages: MessageView[];
  canSend: boolean;
  composerHint: string;
  canEnd: boolean;
  canRemove: boolean;
}

const CHAT_TOOL_PREFIX = 'browser_chat_';

const STATUS = {
  waiting: 'chatStatusWaiting',
  working: 'chatStatusWorking',
  disconnected: 'chatStatusDisconnected',
  ended: 'chatStatusEnded',
} as const satisfies Record<ConversationState, MessageKey>;

const HINT = {
  waiting: 'chatHintWaiting',
  working: 'chatHintWorking',
  disconnected: 'chatHintDisconnected',
  ended: 'chatHintEnded',
} as const satisfies Record<ConversationState, MessageKey>;

const byRecency = (a: Conversation, b: Conversation) => Number(a.ended) - Number(b.ended) || b.updatedAt - a.updatedAt;

export function chooseConversation(conversations: Conversations, preferred?: string): string | undefined {
  if (preferred !== undefined && conversations[preferred]) return preferred;
  return Object.values(conversations).sort(byRecency)[0]?.sessionId;
}

export function conversationState(conversation: Conversation, agents: AgentSession[], now: number): ConversationState {
  if (conversation.ended) return 'ended';
  if (!agents.some((agent) => agent.sessionId === conversation.sessionId)) return 'disconnected';
  return isListening(conversation, now) ? 'waiting' : 'working';
}

function statusText(state: ConversationState, agent: AgentSession | undefined, now: number): string {
  if (state !== 'working' || !agent?.activity || agent.activity.lastTool.startsWith(CHAT_TOOL_PREFIX)) return t(STATUS[state]);
  return t('chatStatusWorkingTool', agent.activity.lastTool, relativeTime(agent.activity.lastUsedAt, now));
}

function messageMeta(message: ChatMessage, conversation: Conversation): string {
  if (message.from !== 'user') return clockTime(message.at);
  const read = t(message.seq <= conversation.delivered ? 'chatReadByAgent' : 'chatNotReadYet');
  return `${clockTime(message.at)} · ${read}`;
}

export function panelView(conversations: Conversations, agents: AgentSession[], now: number, preferred?: string): PanelView {
  const selected = chooseConversation(conversations, preferred);
  const options = Object.values(conversations)
    .sort(byRecency)
    .map((conversation) => {
      const unseen = conversation.sessionId === selected ? 0 : unseenCount(conversation);
      return { sessionId: conversation.sessionId, label: unseen ? plural('chatUnseen', unseen, conversation.title) : conversation.title };
    });
  const conversation = selected === undefined ? undefined : conversations[selected];
  if (!conversation) {
    return { options, title: t('chatTitle'), status: '', messages: [], canSend: false, composerHint: '', canEnd: false, canRemove: false };
  }
  const state = conversationState(conversation, agents, now);
  const agent = agents.find((candidate) => candidate.sessionId === conversation.sessionId);
  return {
    options,
    selected,
    title: conversation.title,
    state,
    status: statusText(state, agent, now),
    messages: conversation.messages.map((message) => ({
      key: `${conversation.sessionId}-${message.seq}`,
      from: message.from,
      text: message.text,
      meta: messageMeta(message, conversation),
    })),
    canSend: state === 'waiting' || state === 'working',
    composerHint: t(HINT[state]),
    canEnd: state === 'waiting' || state === 'working',
    canRemove: state === 'ended' || state === 'disconnected',
  };
}
