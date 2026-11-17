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

  it('tags each request with the agent that sent it, through relays', async () => {
    const agent = (name: string) => ({ serverVersion: '9.9.9', client: { name, version: '1.0' } });
    const port = await startBridge({ agentInfo: () => agent('host-agent') });
    const seen: unknown[] = [];
    const ext = await connect(port, EXT_ORIGIN);
    ext.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'request') return;
      seen.push(msg.agent);
      ext.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result: null }));
    });
    ext.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    const relay = new ExtensionBridge({ port, agentInfo: () => agent('relay-agent') });
    const legacyRelay = new ExtensionBridge({ port });
    try {
      await relay.start();
      await legacyRelay.start();
      await expect.poll(() => legacyRelay.status().state).toBe('connected');
      await bridge!.request('tabs.list', {});
      await relay.request('tabs.list', {});
      await legacyRelay.request('tabs.list', {});
      expect(seen).toEqual([agent('host-agent'), agent('relay-agent'), undefined]);
    } finally {
      await relay.stop();
      await legacyRelay.stop();
    }
  });

  it('times out unanswered requests', async () => {
    const port = await startBridge({ requestTimeoutMs: 50 });
    const ws = await connect(port, EXT_ORIGIN);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    await expect(bridge!.request('tabs.list', {})).rejects.toThrow(/did not answer/);
  });

  it('relays requests from a second process through the host', async () => {
    const port = await startBridge();
    await connectExtension(port, (method, params) => {
      if (method === 'boom') throw new Error('kaboom');
      return { method, params };
    });
    const second = new ExtensionBridge({ port });
    try {
      await expect(second.start()).resolves.toBe(port);
      await expect.poll(() => second.status()).toMatchObject({ state: 'connected', role: 'relay' });
      await expect(second.request('tabs.list', { windowId: 2 })).resolves.toEqual({ method: 'tabs.list', params: { windowId: 2 } });
      await expect(second.request('boom', {})).rejects.toThrow('kaboom');
      await expect(bridge!.request('tabs.list', {})).resolves.toEqual({ method: 'tabs.list', params: {} });
    } finally {
      await second.stop();
    }
  });

  it('reports extension disconnects to relays', async () => {
    const port = await startBridge();
    const ext = await connectExtension(port, () => null);
    const second = new ExtensionBridge({ port });
    try {
      await second.start();
      await expect.poll(() => second.status().state).toBe('connected');
      ext.close();
      await expect.poll(() => second.status().state).toBe('listening');
      await expect(second.request('tabs.list', {})).rejects.toThrow(/not connected/);
    } finally {
      await second.stop();
    }
  });

  it('promotes a relay to host when the host exits', async () => {
    const port = await startBridge();
    const second = new ExtensionBridge({ port });
    try {
      await second.start();
      expect(second.status()).toMatchObject({ role: 'relay' });
      await bridge!.stop();
      bridge = second;
      await expect.poll(() => second.status()).toMatchObject({ state: 'listening', role: 'host' });
      await connectExtension(port, () => 'ok');
      await expect(second.request('tabs.list', {})).resolves.toBe('ok');
    } finally {
      await second.stop();
    }
  });

  it('rejects relay connections that carry a web origin', async () => {
    const port = await startBridge();
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`, { origin: 'https://evil.example' });
        sockets.push(ws);
        ws.once('open', resolve);
        ws.once('error', reject);
      }),
    ).rejects.toThrow(/401/);
  });

  it('reports a clear error when the port is held by something else', async () => {
    const { createServer } = await import('node:http');
    const blocker = createServer((_, res) => res.writeHead(404).end());
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    bridge = new ExtensionBridge({ port });
    try {
      await expect(bridge.start()).rejects.toThrow(/already in use/);
      expect(bridge.status().state).toBe('error');
    } finally {
      blocker.close();
    }
  });
});
