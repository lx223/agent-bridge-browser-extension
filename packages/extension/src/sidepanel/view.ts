import type { AgentSession } from '@agent-browser-bridge/protocol';
import { isListening, isReconnecting, unseenCount, type ChatMessage, type Conversation, type Conversations } from '../background/chat.ts';
import { clockTime, plural, relativeTime, t, type MessageKey } from '../i18n/messages.ts';

export type ConversationState = 'waiting' | 'working' | 'reconnecting' | 'disconnected' | 'ended';

export type ConversationGroup = 'open' | 'past';

export interface ConversationOption {
  key: string;
  label: string;
  group: ConversationGroup;
}

export interface MessageView {
  key: string;
  from: ChatMessage['from'];
  text: string;
  meta: string;
}

export interface PanelView {
  options: ConversationOption[];
  pickConversation: boolean;
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
  reconnecting: 'chatStatusReconnecting',
  disconnected: 'chatStatusDisconnected',
  ended: 'chatStatusEnded',
} as const satisfies Record<ConversationState, MessageKey>;

const HINT = {
  waiting: 'chatHintWaiting',
  working: 'chatHintWorking',
  reconnecting: 'chatHintReconnecting',
  disconnected: 'chatHintDisconnected',
  ended: 'chatHintEnded',
} as const satisfies Record<ConversationState, MessageKey>;

export function conversationState(conversation: Conversation, agents: AgentSession[], now: number): ConversationState {
  if (conversation.ended) return 'ended';
  if (!agents.some((agent) => agent.sessionId === conversation.sessionId)) return isReconnecting(conversation, now) ? 'reconnecting' : 'disconnected';
  return isListening(conversation, now) ? 'waiting' : 'working';
}

const groupOf = (state: ConversationState): ConversationGroup => (state === 'ended' || state === 'disconnected' ? 'past' : 'open');

function sortedByGroup(conversations: Conversations, agents: AgentSession[], now: number) {
  return Object.values(conversations)
    .map((conversation) => ({ conversation, group: groupOf(conversationState(conversation, agents, now)) }))
    .sort((a, b) => Number(a.group === 'past') - Number(b.group === 'past') || b.conversation.updatedAt - a.conversation.updatedAt);
}

export function chooseConversation(conversations: Conversations, agents: AgentSession[], now: number, preferred?: string): string | undefined {
  if (preferred !== undefined && conversations[preferred]) return preferred;
  return sortedByGroup(conversations, agents, now)[0]?.conversation.key;
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
  const selected = chooseConversation(conversations, agents, now, preferred);
  const options = sortedByGroup(conversations, agents, now).map(({ conversation, group }) => {
    const unseen = conversation.key === selected ? 0 : unseenCount(conversation);
    return { key: conversation.key, label: unseen ? plural('chatUnseen', unseen, conversation.title) : conversation.title, group };
  });
  const conversation = selected === undefined ? undefined : conversations[selected];
  if (!conversation) {
    return { options, pickConversation: false, title: t('chatTitle'), status: '', messages: [], canSend: false, composerHint: '', canEnd: false, canRemove: false };
  }
  const state = conversationState(conversation, agents, now);
  const agent = agents.find((candidate) => candidate.sessionId === conversation.sessionId);
  return {
    options,
    pickConversation: options.length > 1,
    selected,
    title: conversation.title,
    state,
    status: statusText(state, agent, now),
    messages: conversation.messages.map((message) => ({
      key: `${conversation.key}-${message.seq}`,
      from: message.from,
      text: message.text,
      meta: messageMeta(message, conversation),
    })),
    canSend: state === 'waiting' || state === 'working' || state === 'reconnecting',
    composerHint: t(HINT[state]),
    canEnd: state === 'waiting' || state === 'working' || state === 'reconnecting',
    canRemove: state === 'ended' || state === 'disconnected',
  };
}

export const canSubmit = (view: Pick<PanelView, 'canSend'>, draft: string, sending: boolean) => view.canSend && !sending && draft.trim() !== '';
