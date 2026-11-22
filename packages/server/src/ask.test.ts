import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ASK_CANCEL_METHOD,
  ASK_SHOW_METHOD,
  ASK_USER_TOOL,
  ASK_WAIT_METHOD,
  MAX_ASK_WAIT_MS,
  PROTOCOL_VERSION,
  type AskAnswer,
  type HelloMessage,
} from '@agent-browser-bridge/protocol';
import type { BridgeStatus, ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const hello = (browser: string, instanceId: string, name?: string): HelloMessage => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  extensionVersion: '1.0.0',
  userAgent: 'test',
  browser,
  instanceId,
  label: browser === 'chrome' ? 'Chrome' : 'Safari',
  ...(name !== undefined && { name }),
});

type Request = (browser: string, method: string, params: Record<string, unknown>, agent: unknown, instance?: string) => Promise<unknown>;

const shown = { askId: 'ask-1', tab: { id: 7, title: 'Checkout', url: 'https://shop.example/checkout' } };

function fakeExtension(answers: AskAnswer[]): Request {
  return async (_browser, method) => {
    if (method === ASK_SHOW_METHOD) return shown;
    if (method === ASK_WAIT_METHOD) return { answer: answers.shift() ?? 'pending' };
    if (method === ASK_CANCEL_METHOD) return { removed: true };
    throw new Error(`Unknown method: ${method}`);
  };
}

async function connect(request: Request, browsers: HelloMessage[] = [hello('chrome', 'aaaa1111')]) {
  const status = (): BridgeStatus => ({ state: 'connected', role: 'host', port: 17373, browsers });
  const bridge = { status, request: vi.fn(request), ready: async () => {} };
  const server = createMcpServer(bridge as unknown as ExtensionBridge, '1.2.3');
  const client = new Client({ name: 'ask-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(() => client.close());
  return { client, bridge };
}

const textOf = (result: unknown) => (result as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? '').join('');
const jsonOf = (result: unknown) => JSON.parse(textOf(result)) as Record<string, unknown>;
const methodsCalled = (bridge: { request: { mock: { calls: unknown[][] } } }) => bridge.request.mock.calls.map((call) => call[1]);

describe('browser_ask_user', () => {
  it('shows the question, waits in rounds and returns the answer with what to do next', async () => {
    const { client, bridge } = await connect(fakeExtension(['pending', 'confirmed']));

    const result = await client.callTool({
      name: ASK_USER_TOOL,
      arguments: { browser: 'chrome', tabId: 7, title: 'Submit the order?', message: 'This charges your card.', confirmLabel: 'Submit order' },
    });

    expect(jsonOf(result)).toMatchObject({ answer: 'confirmed', tab: shown.tab, next: 'The user confirmed. Go ahead.' });
    expect(bridge.request).toHaveBeenNthCalledWith(
      1,
      'chrome',
      ASK_SHOW_METHOD,
      { tabId: 7, title: 'Submit the order?', message: 'This charges your card.', confirmLabel: 'Submit order' },
      undefined,
      'aaaa1111',
    );
    expect(bridge.request).toHaveBeenNthCalledWith(2, 'chrome', ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: MAX_ASK_WAIT_MS }, undefined, 'aaaa1111');
    expect(methodsCalled(bridge)).toEqual([ASK_SHOW_METHOD, ASK_WAIT_METHOD, ASK_WAIT_METHOD]);
  });

  it('tells the agent not to go ahead when the user cancels', async () => {
    const { client } = await connect(fakeExtension(['cancelled']));

    const result = await client.callTool({ name: ASK_USER_TOOL, arguments: { browser: 'chrome', message: 'Delete it?' } });

    expect(jsonOf(result)).toMatchObject({ answer: 'cancelled', next: expect.stringMatching(/Do not go ahead/) });
  });

  it('removes the question and returns timeout when nobody answers in time', async () => {
    const { client, bridge } = await connect(fakeExtension([]));

    const result = await client.callTool({ name: ASK_USER_TOOL, arguments: { browser: 'chrome', message: 'Anyone?', timeoutSeconds: 1 } });

    expect(jsonOf(result)).toMatchObject({ answer: 'timeout' });
    expect(bridge.request).toHaveBeenNthCalledWith(2, 'chrome', ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: expect.any(Number) }, undefined, 'aaaa1111');
    expect((bridge.request.mock.calls[1]![2] as { waitMs: number }).waitMs).toBeLessThanOrEqual(1_000);
    expect(methodsCalled(bridge).at(-1)).toBe(ASK_CANCEL_METHOD);
  });

  it('asks in the browser it is given, picking the instance by name', async () => {
    const { client, bridge } = await connect(fakeExtension(['confirmed']), [hello('chrome', 'aaaa1111', 'Work'), hello('safari', 'bbbb2222', 'Work')]);

    await client.callTool({ name: ASK_USER_TOOL, arguments: { browser: 'safari', instance: 'Work', message: 'Go?' } });

    expect(bridge.request.mock.calls.every(([browser, , , , instance]) => browser === 'safari' && instance === 'bbbb2222')).toBe(true);
  });

  it('requires the browser, since tab ids only mean something within one', async () => {
    const { client } = await connect(fakeExtension(['confirmed']));

    const result = await client.callTool({ name: ASK_USER_TOOL, arguments: { message: 'Go?' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/browser/);
  });

  it('removes the question when waiting fails, and reports the error', async () => {
    const extension = fakeExtension([]);
    const { client, bridge } = await connect(async (browser, method, params, agent, instance) => {
      if (method === ASK_WAIT_METHOD) throw new Error('The connection to the browser closed.');
      return extension(browser, method, params, agent, instance);
    });

    const result = await client.callTool({ name: ASK_USER_TOOL, arguments: { browser: 'chrome', message: 'Go?' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The connection to the browser closed.');
    expect(methodsCalled(bridge)).toEqual([ASK_SHOW_METHOD, ASK_WAIT_METHOD, ASK_CANCEL_METHOD]);
  });

  it('asks the user to update an extension that cannot show questions', async () => {
    const { client } = await connect(async (_browser, method) => {
      throw new Error(`Unknown method: ${method}`);
    });

    const result = await client.callTool({ name: ASK_USER_TOOL, arguments: { browser: 'chrome', message: 'Go?' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/older Agent Browser Bridge extension/);
  });
});
