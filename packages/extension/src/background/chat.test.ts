import { describe, expect, it, vi } from 'vitest';
import { CHAT_PEEK_METHOD, CHAT_RECEIVE_METHOD, CHAT_SEND_METHOD, type AgentInfo } from '@agent-browser-bridge/protocol';
import { CHAT_STORAGE_KEY, ChatStore, hasOpenConversation, MAX_CONVERSATIONS, totalUnseen, type Conversations } from './chat.ts';

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
