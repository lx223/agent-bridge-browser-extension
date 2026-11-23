import { describe, expect, it, vi } from 'vitest';
import { CHAT_PEEK_METHOD, CHAT_RECEIVE_METHOD, CHAT_SEND_METHOD, type AgentInfo } from '@agent-browser-bridge/protocol';
import { CHAT_STORAGE_KEY, ChatStore, hasOpenConversation, MAX_CONVERSATIONS, PAST_CONVERSATION_KEEP_MS, RECONNECT_GRACE_MS, totalUnseen, type Conversations } from './chat.ts';

const agent = (sessionId = 'session-1', project = 'shop'): AgentInfo => ({
  serverVersion: '1.0.0',
  client: { name: 'claude-code', version: '2.0.0' },
  sessionId,
  project: { name: project, path: `/work/${project}` },
});

function memoryStorage() {
  const items: Record<string, unknown> = {};
  return {
    items,
    get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
    set: async (next: Record<string, unknown>) => {
      Object.assign(items, structuredClone(next));
    },
  };
}

function setup() {
  let now = 1_000;
  const storage = memoryStorage();
  const onChange = vi.fn();
  const onAgentMessage = vi.fn();
  const store = new ChatStore(storage, { now: () => now, onChange, onAgentMessage });
  return { store, storage, onChange, onAgentMessage, advance: (ms: number) => (now += ms) };
}

const stored = (storage: { items: Record<string, unknown> }) => storage.items[CHAT_STORAGE_KEY] as Conversations;

describe('ChatStore', () => {
  it('starts a conversation per agent session, titled after the session', async () => {
    const { store, storage, onAgentMessage } = setup();
    await store.dispatch(CHAT_SEND_METHOD, { text: 'What next?' }, agent());
    await store.dispatch(CHAT_SEND_METHOD, { text: 'Hello' }, agent('session-2', 'docs'));
    const all = stored(storage);
    expect(Object.keys(all)).toEqual(['session-1', 'session-2']);
    expect(all['session-1']).toMatchObject({ title: 'claude-code 2.0.0 in shop', messages: [{ seq: 1, from: 'agent', text: 'What next?' }] });
    expect(onAgentMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }), expect.objectContaining({ text: 'What next?' }));
  });

  it('hands the user replies to the agent that is waiting for them', async () => {
    const { store } = setup();
    await store.agentSays(agent(), 'What next?');
    vi.useFakeTimers();
    try {
      const waiting = store.dispatch(CHAT_RECEIVE_METHOD, { waitMs: 20_000 }, agent());
      await vi.advanceTimersByTimeAsync(10);
      await store.userSays('session-1', '  Group my tabs  ', { title: 'Inbox', url: 'https://mail.example/' });
      await expect(waiting).resolves.toEqual({
        messages: [{ seq: 2, text: 'Group my tabs', sentAt: 1_000, tab: { title: 'Inbox', url: 'https://mail.example/' } }],
        ended: false,
        conversation: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the agent as listening while it waits', async () => {
    const { store, storage } = setup();
    vi.useFakeTimers();
    try {
      const waiting = store.receive(agent(), { waitMs: 20_000 });
      await vi.advanceTimersByTimeAsync(10);
      expect(stored(storage)['session-1']!.listeningUntil).toBe(26_000);
      await store.userSays('session-1', 'hi');
      await waiting;
      expect(stored(storage)['session-1']!.listeningUntil).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns nothing once the wait runs out', async () => {
    vi.useFakeTimers();
    try {
      const store = new ChatStore(memoryStorage());
      const waiting = store.receive(agent(), { waitMs: 5_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toEqual({ messages: [], ended: false, conversation: expect.any(String) });
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands messages over again until the agent confirms it read them', async () => {
    const { store, storage } = setup();
    await store.agentSays(agent(), 'What next?');
    await store.userSays('session-1', 'first');
    expect((await store.receive(agent(), { waitMs: 0 })).messages.map((m) => m.text)).toEqual(['first']);
    expect((await store.receive(agent(), { waitMs: 0 })).messages.map((m) => m.text)).toEqual(['first']);
    await store.userSays('session-1', 'second');
    expect((await store.receive(agent(), { waitMs: 0, after: 2 })).messages.map((m) => m.text)).toEqual(['second']);
    expect(stored(storage)['session-1']).toMatchObject({ acknowledged: 2, delivered: 3 });
    expect((await store.receive(agent(), { waitMs: 0 })).messages.map((m) => m.text)).toEqual(['second']);
  });

  it('takes a message from the agent as confirmation that it read the replies before it', async () => {
    const { store, storage } = setup();
    await store.agentSays(agent(), 'What next?');
    await store.userSays('session-1', 'first');
    const inbox = await store.receive(agent(), { waitMs: 0 });
    const sent = (await store.dispatch(CHAT_SEND_METHOD, { text: 'On it', after: 2, conversation: inbox.conversation }, agent())) as { conversation: string };
    expect(sent.conversation).toBe(inbox.conversation);
    expect(stored(storage)['session-1']).toMatchObject({ acknowledged: 2 });
    expect((await store.receive(agent('session-1'), { waitMs: 0 })).messages).toEqual([]);
  });

  describe('when the agent read an earlier conversation for the same session', () => {
    async function restarted() {
      const { store, storage } = setup();
      await store.agentSays(agent(), 'What next?');
      await store.userSays('session-1', 'one');
      await store.userSays('session-1', 'two');
      const earlier = await store.receive(agent(), { waitMs: 0 });
      await store.remove('session-1');
      await store.agentSays(agent(), 'Still there?');
      await store.userSays('session-1', 'yes');
      return { store, storage, earlier };
    }

    it('gives a new id to the new conversation', async () => {
      const { store, earlier } = await restarted();
      const now = await store.receive(agent(), { waitMs: 0 });
      expect(now.conversation).toEqual(expect.any(String));
      expect(now.conversation).not.toBe(earlier.conversation);
    });

    it('ignores a cursor from the earlier conversation and hands over the new messages', async () => {
      const { store, earlier } = await restarted();
      const inbox = await store.receive(agent(), { waitMs: 0, after: 3, conversation: earlier.conversation });
      expect(inbox.messages.map((m) => m.text)).toEqual(['yes']);
      expect(await store.peek(agent(), { after: 3, conversation: earlier.conversation })).toMatchObject({ unread: 1 });
    });

    it('ignores a cursor past the end of the conversation from a server that sends no id', async () => {
      const { store } = await restarted();
      expect((await store.receive(agent(), { waitMs: 0, after: 3 })).messages.map((m) => m.text)).toEqual(['yes']);
    });

    it('still honours a cursor for the current conversation', async () => {
      const { store } = await restarted();
      const current = await store.receive(agent(), { waitMs: 0 });
      await store.userSays('session-1', 'and then');
      const inbox = await store.receive(agent(), { waitMs: 0, after: 2, conversation: current.conversation });
      expect(inbox.messages.map((m) => m.text)).toEqual(['and then']);
    });

    it('gives a conversation saved without an id one', async () => {
      const { store, storage } = setup();
      await store.agentSays(agent(), 'What next?');
      delete (storage.items[CHAT_STORAGE_KEY] as Record<string, { id?: string }>)['session-1']!.id;
      const reloaded = new ChatStore(storage);
      expect((await reloaded.receive(agent(), { waitMs: 0 })).conversation).toEqual(expect.any(String));
    });
  });

  it('counts unread messages for other tools to mention', async () => {
    const { store } = setup();
    expect(await store.dispatch(CHAT_PEEK_METHOD, {}, agent())).toEqual({ unread: 0, ended: false });
    await store.agentSays(agent(), 'Working on it');
    await store.userSays('session-1', 'also close the docs tabs');
    await store.userSays('session-1', 'and pin the inbox');
    expect(await store.peek(agent(), {})).toEqual({ unread: 2, ended: false, conversation: expect.any(String) });
    expect(await store.peek(agent(), { after: 2 })).toEqual({ unread: 1, ended: false, conversation: expect.any(String) });
  });

  it('wakes the waiting agent when the user ends the chat, and reopens when the agent writes again', async () => {
    const { store, storage } = setup();
    await store.agentSays(agent(), 'What next?');
    vi.useFakeTimers();
    try {
      const waiting = store.receive(agent(), { waitMs: 20_000 });
      await vi.advanceTimersByTimeAsync(10);
      await store.end('session-1');
      await expect(waiting).resolves.toEqual({ messages: [], ended: true, conversation: expect.any(String) });
    } finally {
      vi.useRealTimers();
    }
    await expect(store.userSays('session-1', 'too late')).rejects.toThrow(/chat has ended/);
    expect(await store.peek(agent(), {})).toEqual({ unread: 0, ended: true, conversation: expect.any(String) });
    await store.agentSays(agent(), 'Back again');
    expect(stored(storage)['session-1']!.ended).toBe(false);
    expect(stored(storage)['session-1']!.messages.map((m) => m.from)).toEqual(['agent', 'notice', 'agent']);
  });

  it('tracks which agent messages the user has seen', async () => {
    const { store, storage } = setup();
    await store.agentSays(agent(), 'one');
    await store.agentSays(agent(), 'two');
    await store.agentSays(agent('session-2'), 'three');
    expect(totalUnseen(stored(storage))).toBe(3);
    await store.markSeen('session-1');
    expect(totalUnseen(stored(storage))).toBe(1);
    expect(hasOpenConversation(stored(storage), new Set(['session-2']))).toBe(true);
    expect(hasOpenConversation(stored(storage), new Set(['session-3']))).toBe(false);
    await store.end('session-2');
    expect(hasOpenConversation(stored(storage), new Set(['session-2']))).toBe(false);
  });

  describe('when the agent gives its own id', () => {
    const me = { id: 'agent-1', name: 'Tidy tabs' };

    it('keys the conversation by that id and titles it with the agent name', async () => {
      const { store, storage } = setup();
      await store.dispatch(CHAT_SEND_METHOD, { text: 'What next?', agentSession: me }, agent());
      expect(stored(storage)['agent-session:agent-1']).toMatchObject({ key: 'agent-session:agent-1', sessionId: 'session-1', agentSessionId: 'agent-1', title: 'Tidy tabs' });
    });

    it('keeps the conversation when the agent comes back through a new server session', async () => {
      const { store, storage } = setup();
      await store.sessionsChanged(new Set(['session-1']));
      await store.dispatch(CHAT_SEND_METHOD, { text: 'What next?', agentSession: me }, agent());
      await store.userSays('agent-session:agent-1', 'Group my tabs');
      await store.sessionsChanged(new Set(['session-2']));
      const inbox = (await store.dispatch(CHAT_RECEIVE_METHOD, { waitMs: 0, agentSession: me }, agent('session-2'))) as { messages: Array<{ text: string }> };
      expect(inbox.messages.map((message) => message.text)).toEqual(['Group my tabs']);
      expect(Object.keys(stored(storage))).toEqual(['agent-session:agent-1']);
      expect(stored(storage)['agent-session:agent-1']).toMatchObject({ sessionId: 'session-2' });
      expect(stored(storage)['agent-session:agent-1']!.goneAt).toBeUndefined();
    });

    it('gives agents sharing one server session their own conversations', async () => {
      const { store, storage } = setup();
      await store.dispatch(CHAT_SEND_METHOD, { text: 'Tabs?', agentSession: me }, agent());
      await store.dispatch(CHAT_SEND_METHOD, { text: 'PRs?', agentSession: { id: 'agent-2', name: 'Review PRs' } }, agent());
      await store.userSays('agent-session:agent-2', 'Look at the open ones');
      expect(Object.keys(stored(storage)).sort()).toEqual(['agent-session:agent-1', 'agent-session:agent-2']);
      expect(await store.dispatch(CHAT_PEEK_METHOD, { agentSession: me }, agent())).toMatchObject({ unread: 0 });
      expect(await store.dispatch(CHAT_PEEK_METHOD, { agentSession: { id: 'agent-2' } }, agent())).toMatchObject({ unread: 1 });
    });

    it('is never taken over by a session that gives no id', async () => {
      const { store, storage } = setup();
      await store.sessionsChanged(new Set(['session-1']));
      await store.dispatch(CHAT_SEND_METHOD, { text: 'What next?', agentSession: me }, agent());
      await store.sessionsChanged(new Set(['session-2']));
      await store.agentSays(agent('session-2'), 'Hello');
      expect(Object.keys(stored(storage)).sort()).toEqual(['agent-session:agent-1', 'session-2']);
    });
  });

  it('gives conversations saved before keys existed their storage key', async () => {
    const storage = memoryStorage();
    storage.items[CHAT_STORAGE_KEY] = { 'session-1': { sessionId: 'session-1', id: 'c1', title: 't', messages: [], nextSeq: 1, acknowledged: 0, delivered: 0, seenByUser: 0, listeningUntil: 0, ended: false, updatedAt: 0 } };
    const store = new ChatStore(storage);
    expect((await store.conversations())['session-1']!.key).toBe('session-1');
  });

  describe('when the agent session reconnects with a new id', () => {
    async function dropped() {
      const context = setup();
      await context.store.sessionsChanged(new Set(['session-1']));
      await context.store.agentSays(agent(), 'What next?');
      await context.store.userSays('session-1', 'Group my tabs');
      await context.store.sessionsChanged(new Set(['session-2']));
      return context;
    }

    it('marks the conversation as reconnecting instead of closing it', async () => {
      const { store, storage } = await dropped();
      expect(stored(storage)['session-1']).toMatchObject({ goneAt: 1_000, ended: false });
      expect(hasOpenConversation(stored(storage), new Set(['session-2']), 1_000)).toBe(true);
      await store.userSays('session-1', 'and pin the inbox');
      expect(stored(storage)['session-1']!.messages).toHaveLength(3);
    });

    it('moves the conversation to the new session of the same agent and hands over the unread replies', async () => {
      const { store, storage } = await dropped();
      const inbox = await store.receive(agent('session-2'), { waitMs: 0 });
      expect(inbox.messages.map((message) => message.text)).toEqual(['Group my tabs']);
      expect(Object.keys(stored(storage))).toEqual(['session-2']);
      expect(stored(storage)['session-2']).toMatchObject({ sessionId: 'session-2', messages: [{ text: 'What next?' }, { text: 'Group my tabs' }] });
      expect(stored(storage)['session-2']!.goneAt).toBeUndefined();
    });

    it('leaves it alone for a different agent or project', async () => {
      const { store, storage } = await dropped();
      await store.agentSays(agent('session-2', 'docs'), 'Hello');
      expect(Object.keys(stored(storage)).sort()).toEqual(['session-1', 'session-2']);
    });

    it('leaves it alone once the grace period is over', async () => {
      const { store, storage, advance } = await dropped();
      advance(RECONNECT_GRACE_MS);
      expect(hasOpenConversation(stored(storage), new Set(['session-2']), 1_000 + RECONNECT_GRACE_MS)).toBe(false);
      await store.agentSays(agent('session-2'), 'Hello');
      expect(Object.keys(stored(storage)).sort()).toEqual(['session-1', 'session-2']);
    });

    it('leaves a live session alone', async () => {
      const { store, storage } = setup();
      await store.sessionsChanged(new Set(['session-1', 'session-2']));
      await store.agentSays(agent(), 'What next?');
      await store.agentSays(agent('session-2'), 'Hello');
      expect(Object.keys(stored(storage)).sort()).toEqual(['session-1', 'session-2']);
    });

    it('does not bring back a conversation for the session that left', async () => {
      const { store, storage } = await dropped();
      await store.receive(agent('session-2'), { waitMs: 0 });
      await expect(store.receive(agent(), { waitMs: 0 })).resolves.toEqual({ messages: [], ended: false });
      expect(Object.keys(stored(storage))).toEqual(['session-2']);
    });
  });

  it('forgets conversations a day after they ended or lost their agent', async () => {
    const { store, storage, advance } = setup();
    await store.sessionsChanged(new Set(['session-1', 'session-2', 'session-3']));
    await store.agentSays(agent('session-1'), 'ending');
    await store.agentSays(agent('session-2'), 'leaving');
    await store.agentSays(agent('session-3'), 'staying');
    await store.end('session-1');
    await store.sessionsChanged(new Set(['session-3']));
    advance(PAST_CONVERSATION_KEEP_MS - 1);
    await store.agentSays(agent('session-3'), 'still here');
    expect(Object.keys(stored(storage)).sort()).toEqual(['session-1', 'session-2', 'session-3']);
    advance(1);
    await store.agentSays(agent('session-3'), 'a day later');
    expect(Object.keys(stored(storage))).toEqual(['session-3']);
  });

  it('removes conversations and keeps only the most recent ones', async () => {
    const { store, storage, advance } = setup();
    for (let index = 0; index <= MAX_CONVERSATIONS; index++) {
      advance(1);
      await store.agentSays(agent(`session-${index}`), 'hi');
    }
    expect(Object.keys(stored(storage))).toHaveLength(MAX_CONVERSATIONS);
    expect(stored(storage)['session-0']).toBeUndefined();
    await store.remove('session-1');
    expect(stored(storage)['session-1']).toBeUndefined();
  });

  it('rejects messages that are empty, too long, or for unknown conversations', async () => {
    const { store, onChange } = setup();
    await store.userSays('missing', '   ');
    expect(onChange).not.toHaveBeenCalled();
    await expect(store.userSays('missing', 'hello')).rejects.toThrow(/no longer exists/);
    await store.agentSays(agent(), 'hi');
    await expect(store.userSays('session-1', 'x'.repeat(20_001))).rejects.toThrow(/at most/);
  });

  it('needs an agent session id and valid params', async () => {
    const { store } = setup();
    await expect(store.dispatch(CHAT_SEND_METHOD, { text: 'hi' }, null)).rejects.toThrow(/session id/);
    await expect(store.dispatch(CHAT_RECEIVE_METHOD, { waitMs: 60_000 }, agent())).rejects.toThrow(/Invalid params for chat.receive/);
    await expect(store.dispatch('chat.unknown', {}, agent())).rejects.toThrow(/Unknown method/);
  });
});
