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
  const bridge = { status, request: vi.fn(request) };
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
  const request: Request = async (_browser, method, params) => {
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
  return { sent, receives, request };
}

describe('browser chat tools', () => {
  it('posts a message and returns the reply the user typed', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 2, text: 'Group my tabs', sentAt: 0, tab: { title: 'Inbox', url: 'https://mail.example/' } }], ended: false },
    ]);
    const { client, bridge } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'What next?' } });
    expect(extension.sent).toEqual(['What next?']);
    expect(jsonOf(result)).toMatchObject({
      sent: true,
      messages: [{ text: 'Group my tabs', sentAt: '1970-01-01T00:00:00.000Z', viewingTab: { title: 'Inbox', url: 'https://mail.example/' } }],
    });
    expect(bridge.request).toHaveBeenCalledWith('chrome', CHAT_RECEIVE_METHOD, { waitMs: 20_000 }, undefined, 'aaaa1111');
  });

  it('keeps waiting in short rounds and passes back the last message it read', async () => {
    const extension = fakeExtension([
      { messages: [{ seq: 4, text: 'first', sentAt: 0 }], ended: false },
      { messages: [], ended: false },
      { messages: [{ seq: 6, text: 'second', sentAt: 0 }], ended: false },
    ]);
    const { client } = await connect(extension.request);
    await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: {} });
    const result = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: {} });
    expect(jsonOf(result).messages).toEqual([{ text: 'second', sentAt: '1970-01-01T00:00:00.000Z' }]);
    expect(extension.receives).toEqual([{ waitMs: 20_000 }, { waitMs: 20_000, after: 4 }, { waitMs: 20_000, after: 4 }]);
  });

  it('says so when no reply arrived in time', async () => {
    const extension = fakeExtension([]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_RECEIVE_TOOL, arguments: { timeoutSeconds: 0 } });
    expect(jsonOf(result)).toEqual({ messages: [], next: expect.stringContaining(`Call ${CHAT_RECEIVE_TOOL} to keep waiting`) });
    expect(extension.receives).toEqual([{ waitMs: 0 }]);
  });

  it('can post without waiting', async () => {
    const extension = fakeExtension([]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Starting now', waitForReply: false } });
    expect(jsonOf(result)).toEqual({ sent: true, next: expect.stringContaining(CHAT_RECEIVE_TOOL) });
    expect(extension.receives).toEqual([]);
  });

  it('tells the agent to stop once the user ends the chat', async () => {
    const extension = fakeExtension([{ messages: [], ended: true }]);
    const { client } = await connect(extension.request);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Done' } });
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

    await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Working on it', waitForReply: false } });
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
    await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Working on it', waitForReply: false } });
    ended = true;
    expect(textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} })).at(-1)).toMatch(/^The user ended the browser chat/);
    expect(textOf(await client.callTool({ name: 'chrome_tabs_list', arguments: {} }))).toHaveLength(2);
  });

  it('explains that the chat panel needs Chrome when only Safari is connected', async () => {
    const { client } = await connect(async () => null, [hello('safari', 'bbbb2222')]);
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Hello' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)[0]).toMatch(/only available in Chrome for now, and only Safari is connected/);
  });

  it('asks the user to update an extension that has no chat panel', async () => {
    const { client } = await connect(async (_browser, method) => {
      throw new Error(`Unknown method: ${method}`);
    });
    const result = await client.callTool({ name: CHAT_SEND_TOOL, arguments: { text: 'Hello' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)[0]).toMatch(/older Agent Browser Bridge extension without the chat panel/);
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
