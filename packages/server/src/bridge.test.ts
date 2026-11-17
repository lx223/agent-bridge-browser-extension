import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@agent-browser-bridge/protocol';
import { ExtensionBridge } from './bridge.ts';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let bridge: ExtensionBridge | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await bridge?.stop();
  bridge = undefined;
});

async function startBridge(opts: Partial<ConstructorParameters<typeof ExtensionBridge>[0]> = {}) {
  bridge = new ExtensionBridge({ port: 0, ...opts });
  return bridge.start();
}

function connect(port: number, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
    sockets.push(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function connectExtension(port: number, handler: (method: string, params: unknown) => unknown) {
  const ws = await connect(port, EXT_ORIGIN);
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'request') return;
    try {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result: handler(msg.method, msg.params) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: (e as Error).message }));
    }
  });
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
  await expect.poll(() => bridge!.status().state).toBe('connected');
  return ws;
}

describe('ExtensionBridge', () => {
  it('rejects web page origins', async () => {
    const port = await startBridge();
    await expect(connect(port, 'https://evil.example')).rejects.toThrow(/401/);
  });

  it('pins to a specific extension id when configured', async () => {
    const port = await startBridge({ extensionId: 'expected' });
    await expect(connect(port, EXT_ORIGIN)).rejects.toThrow(/401/);
  });

  it('fails fast when the extension is not connected', async () => {
    await startBridge();
    await expect(bridge!.request('tabs.list', {})).rejects.toThrow(/not connected/);
  });

  it('round-trips requests and errors', async () => {
    const port = await startBridge();
    await connectExtension(port, (method, params) => {
      if (method === 'boom') throw new Error('kaboom');
      return { method, params };
    });
    await expect(bridge!.request('tabs.list', { windowId: 1 })).resolves.toEqual({ method: 'tabs.list', params: { windowId: 1 } });
    await expect(bridge!.request('boom', {})).rejects.toThrow('kaboom');
  });

  it('tells the extension which agent is connected', async () => {
    let client: { name: string; version: string } | null = null;
    const port = await startBridge({ agentInfo: () => ({ serverVersion: '9.9.9', client }) });
    const ws = await connect(port, EXT_ORIGIN);
    const welcomes: unknown[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') welcomes.push(msg);
    });
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => welcomes.length).toBe(1);
    client = { name: 'claude-code', version: '2.0.0' };
    bridge!.announceAgent();
    await expect.poll(() => welcomes.length).toBe(2);
    expect(welcomes).toEqual([
      { type: 'welcome', serverVersion: '9.9.9', client: null },
      { type: 'welcome', serverVersion: '9.9.9', client: { name: 'claude-code', version: '2.0.0' } },
    ]);
  });

  it('times out unanswered requests', async () => {
    const port = await startBridge({ requestTimeoutMs: 50 });
    const ws = await connect(port, EXT_ORIGIN);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    await expect(bridge!.request('tabs.list', {})).rejects.toThrow(/did not answer/);
  });

  it('reports a clear error when the port is taken', async () => {
    const port = await startBridge();
    const second = new ExtensionBridge({ port });
    await expect(second.start()).rejects.toThrow(/already in use/);
    expect(second.status().state).toBe('error');
  });
});
