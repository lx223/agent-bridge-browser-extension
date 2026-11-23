import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CHAT_PEEK_METHOD,
  CHAT_PROMPT,
  CHAT_RECEIVE_METHOD,
  CHAT_RECEIVE_TOOL,
  CHAT_SEND_METHOD,
  CHAT_SEND_TOOL,
  PROTOCOL_VERSION,
  type ChatInbox,
  type HelloMessage,
} from '@agent-browser-bridge/protocol';
import type { BridgeStatus, ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

const closers: Array<() => Promise<void>> = [];
const ME = { agentSessionId: 'agent-1', agentSessionName: 'Tidy tabs' };
const ME_PARAM = { id: 'agent-1', name: 'Tidy tabs' };

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const hello = (browser: string, instanceId: string): HelloMessage => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  extensionVersion: '1.0.0',
  userAgent: 'test',
  browser,
  instanceId,
  label: browser === 'chrome' ? 'Chrome' : 'Safari',
});

type Request = (browser: string, method: string, params: Record<string, unknown>, agent: unknown, instance?: string) => Promise<unknown>;

async function connect(request: Request, browsers: HelloMessage[] = [hello('chrome', 'aaaa1111')]) {
  const status = (): BridgeStatus => ({ state: 'connected', role: 'host', port: 17373, browsers });
  const bridge = { status, request: vi.fn(request), ready: async () => {} };
  const server = createMcpServer(bridge as unknown as ExtensionBridge, '1.2.3');
  const client = new Client({ name: 'chat-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(() => client.close());
  return { client, bridge };
}

const textOf = (result: unknown) => (result as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? '');
const jsonOf = (result: unknown) => JSON.parse(textOf(result)[0]!) as Record<string, unknown>;

function fakeExtension(replies: ChatInbox[]) {
  const sent: string[] = [];
  const receives: Array<Record<string, unknown>> = [];
  const agentSessions: unknown[] = [];
  const request: Request = async (_browser, method, { agentSession, ...params }) => {
    agentSessions.push(agentSession);
    if (method === CHAT_SEND_METHOD) {
      sent.push(params.text as string);
      return { seq: sent.length };
    }
    if (method === CHAT_RECEIVE_METHOD) {
      receives.push(params);
      return replies.shift() ?? { messages: [], ended: false };
    }
    if (method === CHAT_PEEK_METHOD) return { unread: 0, ended: false };
    return [];
  };
  return { sent, receives, agentSessions, request };
}

describe('browser chat tools', () => {
  it('posts a message and returns the reply the user typed', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 2, text: 'Group my tabs', sentAt: 0, tab: { title: 'Inbox', url: 'https://mail.example/' } }], ended: false },
    ]);
    const { client, bridge } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'What next?' } });
    expect(extension.sent).toEqual(['What next?']);
    expect(jsonOf(result)).toMatchObject({
      sent: true,
      messages: [{ text: 'Group my tabs', sentAt: '1970-01-01T00:00:00.000Z', viewingTab: { title: 'Inbox', url: 'https://mail.example/' } }],
    });
    expect(bridge.request).toHaveBeenCalledWith('chrome', CHAT_RECEIVE_METHOD, { waitMs: 20_000, agentSession: ME_PARAM }, undefined, 'aaaa1111');
    expect(extension.agentSessions).toEqual([ME_PARAM, ME_PARAM]);
  });

  it('keeps waiting in short rounds and passes back the last message it read', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 4, text: 'first', sentAt: 0 }], ended: false },
      { messages: [], ended: false },
      { messages: [{ seq: 6, text: 'second', sentAt: 0 }], ended: false },
    ]);
    const { client } = await connect(extension.request);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    const result = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    expect(jsonOf(result).messages).toEqual([{ text: 'second', sentAt: '1970-01-01T00:00:00.000Z' }]);
    expect(extension.receives).toEqual([{ waitMs: 20_000 }, { waitMs: 20_000, after: 4 }, { waitMs: 20_000, after: 4 }]);
  });

  it('tells the browser which replies it read when it posts a message', async () => {
    const extension = fakeExtension([{ messages: [{ seq: 4, text: 'first', sentAt: 0 }], ended: false, conversation: 'first' }]);
    const sends: Array<Record<string, unknown>> = [];
    const request: Request = async (browser, method, params, agent, instance) => {
      if (method === CHAT_SEND_METHOD) {
        const { agentSession: _agentSession, ...rest } = params;
        sends.push(rest);
        return { seq: 5, conversation: 'second' };
      }
      return extension.request(browser, method, params, agent, instance);
    };
    const { client } = await connect(request);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'On it', waitForReply: false } });
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME, timeoutSeconds: 0 } });
    expect(sends).toEqual([{ text: 'On it', after: 4, conversation: 'first' }]);
    expect(extension.receives.at(-1)).toEqual({ waitMs: 0, conversation: 'second' });
  });

  it('starts reading a new conversation from the start when the browser replaced the old one', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 12, text: 'before the restart', sentAt: 0 }], ended: false, conversation: 'first' },
      { messages: [{ seq: 2, text: 'after the restart', sentAt: 0 }], ended: false, conversation: 'second' },
      { messages: [{ seq: 4, text: 'later', sentAt: 0 }], ended: false, conversation: 'second' },
    ]);
    const { client } = await connect(extension.request);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    const replaced = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    expect(jsonOf(replaced).messages).toEqual([{ text: 'after the restart', sentAt: '1970-01-01T00:00:00.000Z' }]);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    expect(extension.receives).toEqual([
      { waitMs: 20_000 },
      { waitMs: 20_000, after: 12, conversation: 'first' },
      { waitMs: 20_000, after: 2, conversation: 'second' },
    ]);
  });

  it('forgets the cursor when a peek shows the conversation was replaced', async () => {
    const extension = fakeExtension([{ messages: [{ seq: 12, text: 'before the restart', sentAt: 0 }], ended: false, conversation: 'first' }]);
    const peeks: Array<Record<string, unknown>> = [];
    const request: Request = async (browser, method, { agentSession, ...params }, agent, instance) => {
      if (method !== CHAT_PEEK_METHOD) return extension.request(browser, method, { agentSession, ...params }, agent, instance);
      expect(agentSession).toEqual(ME_PARAM);
      peeks.push(params);
      return { unread: 1, ended: false, conversation: 'second' };
    };
    const { client } = await connect(request);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    await client.callTool({ name: 'chrome_tabs_list', arguments: {} });
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME, timeoutSeconds: 0 } });
    expect(peeks).toEqual([{ after: 12, conversation: 'first' }]);
    expect(extension.receives.at(-1)).toEqual({ waitMs: 0, conversation: 'second' });
  });

  it('keeps a separate conversation and cursor for each agent sharing the server', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 4, text: 'for the first agent', sentAt: 0 }], ended: false },
      { messages: [{ seq: 9, text: 'for the second agent', sentAt: 0 }], ended: false },
      { messages: [], ended: false },
    ]);
    const { client } = await connect(extension.request);
    const other = { agentSessionId: 'agent-2', agentSessionName: 'Review PRs' };
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME } });
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...other } });
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME, timeoutSeconds: 0 } });
    expect(extension.agentSessions).toEqual([ME_PARAM, { id: 'agent-2', name: 'Review PRs' }, ME_PARAM]);
    expect(extension.receives).toEqual([{ waitMs: 20_000 }, { waitMs: 20_000 }, { waitMs: 0, after: 4 }]);
  });

  it('asks every agent for a stable id and a name', async () => {
    const { client } = await connect(async () => null);
    const { tools } = await client.listTools();
    for (const name of [CHAT_SEND_TOOL, CHAT_RECEIVE_TOOL]) {
      expect(tools.find((tool) => tool.name === name)!.inputSchema.required).toEqual(expect.arrayContaining(['agentSessionId', 'agentSessionName']));
    }
    const result = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('says so when no reply arrived in time', async () => {
    const extension = fakeExtension([]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { ...ME, timeoutSeconds: 0 } });
    expect(jsonOf(result)).toEqual({ messages: [], next: expect.stringContaining(`Call ${CHAT_RECEIVE_TOOL} to keep waiting`) });
    expect(extension.receives).toEqual([{ waitMs: 0 }]);
  });

  it('can post without waiting', async () => {
    const extension = fakeExtension([]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Starting now', waitForReply: false } });
    expect(jsonOf(result)).toEqual({ sent: true, next: expect.stringContaining(CHAT_RECEIVE_TOOL) });
    expect(extension.receives).toEqual([]);
  });

  it('tells the agent to stop once the user ends the chat', async () => {
    const extension = fakeExtension([{ messages: [], ended: true }]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Done' } });
    expect(jsonOf(result)).toMatchObject({ ended: true, next: expect.stringContaining('The user ended the browser chat') });
  });

  it('mentions unread chat messages on other browser tools once a chat has started', async () => {
    let unread = 0;
    const extension = fakeExtension([]);
    const { client, bridge } = await connect(async (browser, method, params, agent, instance) => {
      if (method === CHAT_PEEK_METHOD) return { unread, ended: false };
      return extension.request(browser, method, params, agent, instance);
    });
    await client.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(bridge.request).not.toHaveBeenCalledWith('chrome', CHAT_PEEK_METHOD, expect.anything(), undefined, expect.anything());

    await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Working on it', waitForReply: false } });
    expect(textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} }))).toHaveLength(2);

    unread = 2;
    const parts = textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} }));
    expect(parts.at(-1)).toBe(`The user sent 2 new messages in the browser chat. Call ${CHAT_RECEIVE_TOOL} to read them.`);
  });

  it('stops mentioning the chat after the user ends it', async () => {
    let ended = false;
    const extension = fakeExtension([]);
    const { client } = await connect(async (browser, method, params, agent, instance) => {
      if (method === CHAT_PEEK_METHOD) return { unread: 0, ended };
      return extension.request(browser, method, params, agent, instance);
    });
    await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Working on it', waitForReply: false } });
    ended = true;
    expect(textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} })).at(-1)).toMatch(/^The user ended the browser chat/);
    expect(textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} }))).toHaveLength(2);
  });

  it('explains that the chat panel needs Chrome when only Safari is connected', async () => {
    const { client } = await connect(async () => null, [hello('safari', 'bbbb2222')]);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Hello' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)[0]).toMatch(/only available in Chrome for now, and only Safari is connected/);
  });

  it('asks the user to update an extension that has no chat panel', async () => {
    const { client } = await connect(async (_browser, method) => {
      throw new Error(`Unknown method: ${method}`);
    });
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { ...ME, text: 'Hello' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)[0]).toMatch(/older Agent Browser Bridge extension without the chat panel/);
  });

  it('waits under a minute by default, so clients that stop calls after 60 seconds do not time out', async () => {
    const { client } = await connect(async () => null);
    const { tools } = await client.listTools();
    for (const name of [CHAT_SEND_TOOL, CHAT_RECEIVE_TOOL]) {
      const timeout = tools.find((tool) => tool.name === name)!.inputSchema.properties!.timeoutSeconds as { default: number; maximum: number };
      expect(timeout.default).toBe(50);
      expect(timeout.maximum).toBe(600);
    }
  });

  it('offers a prompt that moves the conversation to the browser', async () => {
    const { client } = await connect(async () => null);
    const plain = await client.getPrompt({ name: CHAT_PROMPT, arguments: {} });
    const text = (plain.messages[0]!.content as { text: string }).text;
    expect(text).toContain(CHAT_SEND_TOOL);
    expect(text).toContain(CHAT_RECEIVE_TOOL);
    const focused = await client.getPrompt({ name: CHAT_PROMPT, arguments: { topic: 'review my open PRs' } });
    expect((focused.messages[0]!.content as { text: string }).text).toContain('Start with this: review my open PRs');
  });
});
