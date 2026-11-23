import {
  CHAT_PEEK_METHOD,
  CHAT_RECEIVE_METHOD,
  CHAT_SEND_METHOD,
  chatPeekParams,
  chatReceiveParams,
  chatSendParams,
  MAX_CHAT_MESSAGE_LENGTH,
  type AgentInfo,
  type ChatAgentSession,
  type ChatInbox,
  type ChatPeek,
  type ChatPeekParams,
  type ChatReceiveParams,
  type ChatTab,
} from '@agent-browser-bridge/protocol';
import { plural, t } from '../i18n/messages.ts';
import { sessionTitle } from '../settings/sessionList.ts';

export const CHAT_STORAGE_KEY = 'chat.conversations';
export const MAX_MESSAGES_PER_CONVERSATION = 500;
export const MAX_CONVERSATIONS = 20;
export const PAST_CONVERSATION_KEEP_MS = 24 * 60 * 60_000;
const LISTEN_GRACE_MS = 5_000;
export const RECONNECT_GRACE_MS = 10 * 60_000;

export type ChatAuthor = 'agent' | 'user' | 'notice';

export interface ChatMessage {
  seq: number;
  from: ChatAuthor;
  text: string;
  at: number;
  tab?: ChatTab;
}

export interface ConversationAgent {
  client?: string;
  project?: string;
}

export interface Conversation {
  id: string;
  key: string;
  sessionId: string;
  agentSessionId?: string;
  title: string;
  agent?: ConversationAgent;
  goneAt?: number;
  messages: ChatMessage[];
  nextSeq: number;
  acknowledged: number;
  delivered: number;
  seenByUser: number;
  listeningUntil: number;
  ended: boolean;
  updatedAt: number;
}

export type Conversations = Record<string, Conversation>;

export interface ChatStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChatStoreOptions {
  now?: () => number;
  ready?: Promise<void>;
  onChange?: (conversations: Conversations) => void;
  onAgentMessage?: (conversation: Conversation, message: ChatMessage) => void;
}

const sessionKey = (agent: AgentInfo | null) => {
  if (agent?.sessionId === undefined) throw new Error('The browser chat needs an agent session id. Update the agent-browser-bridge MCP server.');
  return agent.sessionId;
};

export const agentSessionKey = (agentSessionId: string) => `agent-session:${agentSessionId}`;

const conversationKey = (agent: AgentInfo | null, agentSession: ChatAgentSession | undefined) => {
  const session = sessionKey(agent);
  return agentSession ? agentSessionKey(agentSession.id) : session;
};

export const isListening = (conversation: Conversation, now: number) => !conversation.ended && conversation.listeningUntil > now;

export const isReconnecting = (conversation: Conversation, now: number) =>
  !conversation.ended && conversation.goneAt !== undefined && now - conversation.goneAt < RECONNECT_GRACE_MS;

const agentOf = (agent: AgentInfo | null): ConversationAgent => ({
  ...(agent?.client && { client: agent.client.name }),
  ...(agent?.project && { project: agent.project.path }),
});

const sameAgent = (a: ConversationAgent | undefined, b: ConversationAgent) => a !== undefined && a.client !== undefined && a.client === b.client && a.project === b.project;

export const unseenCount = (conversation: Conversation) =>
  conversation.messages.filter((message) => message.from === 'agent' && message.seq > conversation.seenByUser).length;

export const totalUnseen = (conversations: Conversations) => Object.values(conversations).reduce((sum, conversation) => sum + unseenCount(conversation), 0);

export const hasOpenConversation = (conversations: Conversations, liveSessions: ReadonlySet<string>, now = Date.now()) =>
  Object.values(conversations).some((conversation) => !conversation.ended && (liveSessions.has(conversation.sessionId) || isReconnecting(conversation, now)));

const userMessagesAfter = (conversation: Conversation, after: number) =>
  conversation.messages.filter((message) => message.from === 'user' && message.seq > after);

const newConversationId = () => crypto.randomUUID();

const withId = (conversation: Conversation) => {
  conversation.id ??= newConversationId();
  return conversation;
};

const withKeys = (all: Conversations) => {
  for (const [key, conversation] of Object.entries(all)) conversation.key ??= key;
  return all;
};

const cursorMatches = (conversation: Conversation, after: number, cursorConversation: string | undefined) =>
  cursorConversation === undefined ? after < conversation.nextSeq : cursorConversation === conversation.id;

const overSince = (conversation: Conversation) => (conversation.ended ? conversation.updatedAt : conversation.goneAt);

const pruneConversations = (all: Conversations, now: number) => {
  for (const conversation of Object.values(all)) {
    const over = overSince(conversation);
    if (over !== undefined && now - over >= PAST_CONVERSATION_KEEP_MS) delete all[conversation.key];
  }
  const sessions = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const stale of sessions.slice(MAX_CONVERSATIONS)) delete all[stale.key];
};

export class ChatStore {
  private cache?: Promise<Conversations>;
  private queue: Promise<unknown> = Promise.resolve();
  private waiters = new Map<string, Set<() => void>>();
  private live?: ReadonlySet<string>;
  private readonly now: () => number;

  constructor(
    private readonly storage: ChatStorage,
    private readonly options: ChatStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  conversations(): Promise<Conversations> {
    return this.load().then((all) => structuredClone(all));
  }

  async sessionsChanged(live: ReadonlySet<string>): Promise<void> {
    this.live = live;
    await this.update((all) => {
      for (const conversation of Object.values(all)) {
        if (live.has(conversation.sessionId) || conversation.ended) delete conversation.goneAt;
        else conversation.goneAt ??= this.now();
      }
    });
  }

  async dispatch(method: string, params: unknown, agent: AgentInfo | null): Promise<unknown> {
    switch (method) {
      case CHAT_SEND_METHOD: {
        const { text, agentSession } = parse(chatSendParams, method, params);
        return this.agentSays(agent, text, agentSession);
      }
      case CHAT_RECEIVE_METHOD:
        return this.receive(agent, parse(chatReceiveParams, method, params));
      case CHAT_PEEK_METHOD:
        return this.peek(agent, parse(chatPeekParams, method, params));
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  async agentSays(agent: AgentInfo | null, text: string, agentSession?: ChatAgentSession): Promise<{ seq: number }> {
    const key = conversationKey(agent, agentSession);
    const { conversation, message } = await this.update((all) => {
      const conversation = this.ensure(all, key, agent, agentSession);
      conversation.ended = false;
      const message = this.append(conversation, 'agent', text);
      return { conversation: structuredClone(conversation), message };
    });
    this.options.onAgentMessage?.(conversation, message);
    return { seq: message.seq };
  }

  async receive(agent: AgentInfo | null, { waitMs, after, conversation: cursorConversation, agentSession }: ChatReceiveParams): Promise<ChatInbox> {
    const key = conversationKey(agent, agentSession);
    const deadline = this.now() + waitMs;
    for (;;) {
      const inbox = await this.update((all) => {
        if (!agentSession && !all[key] && this.isGone(key)) return this.now() >= deadline ? { messages: [], ended: false } : undefined;
        const conversation = this.ensure(all, key, agent, agentSession);
        const from = this.acknowledge(conversation, after, cursorConversation);
        const messages = userMessagesAfter(conversation, from);
        const answered = messages.length > 0 || conversation.ended;
        const ready = answered || this.now() >= deadline;
        conversation.listeningUntil = answered ? 0 : Math.max(deadline, this.now()) + LISTEN_GRACE_MS;
        if (messages.length) conversation.delivered = Math.max(conversation.delivered, messages.at(-1)!.seq);
        if (!ready) return undefined;
        return {
          messages: messages.map(({ seq, text, at, tab }) => ({ seq, text, sentAt: at, ...(tab && { tab }) })),
          ended: conversation.ended,
          conversation: conversation.id,
        };
      });
      if (inbox) return inbox;
      await this.waitForUser(key, deadline - this.now());
    }
  }

  async peek(agent: AgentInfo | null, { after, conversation: cursorConversation, agentSession }: ChatPeekParams): Promise<ChatPeek> {
    const key = conversationKey(agent, agentSession);
    return this.update((all) => {
      const conversation = all[key];
      if (!conversation) return { unread: 0, ended: false };
      const from = this.acknowledge(withId(conversation), after, cursorConversation);
      return { unread: userMessagesAfter(conversation, from).length, ended: conversation.ended, conversation: conversation.id };
    });
  }

  async userSays(key: string, text: string, tab?: ChatTab): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) throw new Error(plural('chatTooLong', MAX_CHAT_MESSAGE_LENGTH));
    await this.update((all) => {
      const conversation = all[key];
      if (!conversation) throw new Error(t('chatConversationGone'));
      if (conversation.ended) throw new Error(t('chatEndedError'));
      this.append(conversation, 'user', trimmed, tab);
    });
    this.wake(key);
  }

  async end(key: string): Promise<void> {
    await this.update((all) => {
      const conversation = all[key];
      if (!conversation || conversation.ended) return;
      conversation.ended = true;
      conversation.listeningUntil = 0;
      this.append(conversation, 'notice', t('chatEndedNotice'));
    });
    this.wake(key);
  }

  async remove(key: string): Promise<void> {
    await this.update((all) => {
      delete all[key];
    });
    this.wake(key);
  }

  async markSeen(key: string): Promise<void> {
    await this.update((all) => {
      const conversation = all[key];
      if (!conversation) return;
      const latest = conversation.messages.filter((message) => message.from === 'agent').at(-1)?.seq ?? 0;
      if (latest <= conversation.seenByUser) return false;
      conversation.seenByUser = latest;
    });
  }

  private load(): Promise<Conversations> {
    this.cache ??= Promise.resolve(this.options.ready)
      .catch(() => undefined)
      .then(() => this.storage.get(CHAT_STORAGE_KEY))
      .then((items) => withKeys((items[CHAT_STORAGE_KEY] ?? {}) as Conversations))
      .catch(() => ({}));
    return this.cache;
  }

  private update<T>(change: (all: Conversations) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const all = await this.load();
      const before = JSON.stringify(all);
      const result = change(all);
      if (JSON.stringify(all) !== before) {
        pruneConversations(all, this.now());
        await this.storage.set({ [CHAT_STORAGE_KEY]: all });
        this.options.onChange?.(structuredClone(all));
      }
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private ensure(all: Conversations, key: string, agent: AgentInfo | null, agentSession: ChatAgentSession | undefined): Conversation {
    const title = agentSession?.name ?? (agent ? sessionTitle(agent) : 'Agent');
    const sessionId = sessionKey(agent);
    const existing = all[key] ?? (agentSession ? undefined : this.adopt(all, key, agentOf(agent)));
    if (existing) {
      existing.title = agentSession?.name ?? (existing.agentSessionId === undefined ? title : existing.title);
      existing.sessionId = sessionId;
      existing.agent = agentOf(agent);
      delete existing.goneAt;
      return withId(existing);
    }
    const created: Conversation = {
      id: newConversationId(),
      key,
      sessionId,
      ...(agentSession && { agentSessionId: agentSession.id }),
      title,
      agent: agentOf(agent),
      messages: [],
      nextSeq: 1,
      acknowledged: 0,
      delivered: 0,
      seenByUser: 0,
      listeningUntil: 0,
      ended: false,
      updatedAt: this.now(),
    };
    all[key] = created;
    return created;
  }

  private isGone(key: string) {
    return this.live !== undefined && !this.live.has(key);
  }

  private adopt(all: Conversations, key: string, agent: ConversationAgent): Conversation | undefined {
    const live = this.live;
    if (!live) return undefined;
    const now = this.now();
    const previous = Object.values(all)
      .filter(
        (conversation) =>
          conversation.agentSessionId === undefined && !live.has(conversation.sessionId) && isReconnecting(conversation, now) && sameAgent(conversation.agent, agent),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!previous) return undefined;
    delete all[previous.key];
    previous.key = key;
    previous.sessionId = key;
    all[key] = previous;
    return previous;
  }

  private acknowledge(conversation: Conversation, after: number | undefined, cursorConversation: string | undefined): number {
    if (after === undefined || !cursorMatches(conversation, after, cursorConversation)) return conversation.acknowledged;
    conversation.acknowledged = Math.max(conversation.acknowledged, after);
    return after;
  }

  private append(conversation: Conversation, from: ChatAuthor, text: string, tab?: ChatTab): ChatMessage {
    const message: ChatMessage = { seq: conversation.nextSeq++, from, text, at: this.now(), ...(tab && { tab }) };
    conversation.messages.push(message);
    conversation.messages.splice(0, Math.max(0, conversation.messages.length - MAX_MESSAGES_PER_CONVERSATION));
    conversation.updatedAt = message.at;
    return message;
  }

  private waitForUser(key: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.waiters.get(key) ?? new Set();
      this.waiters.set(key, waiters);
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      waiters.add(done);
    });
  }

  private wake(key: string) {
    for (const done of [...(this.waiters.get(key) ?? [])]) done();
  }
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }, method: string, params: unknown): T {
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) throw new Error(`Invalid params for ${method}: ${parsed.error.message}`);
  return parsed.data;
}
