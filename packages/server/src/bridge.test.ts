import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@agent-browser-bridge/protocol';
import { ExtensionBridge } from './bridge.ts';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const SAFARI_ORIGIN = 'safari-web-extension://0A1B2C3D-0000-1111-2222-333344445555';
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

interface ExtensionOptions {
  origin?: string;
  browser?: string;
}

async function connectExtension(
  port: number,
  handler: (method: string, params: unknown) => unknown,
  { origin = EXT_ORIGIN, browser }: ExtensionOptions = {},
) {
  const ws = await connect(port, origin);
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'request') return;
    try {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result: handler(msg.method, msg.params) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: (e as Error).message }));
    }
  });
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test', browser }));
  const expected = browser ?? 'chrome';
  await expect.poll(() => browsersOf(bridge!).includes(expected)).toBe(true);
  return ws;
}

function browsersOf(b: ExtensionBridge): string[] {
  const status = b.status();
  return status.state === 'error' ? [] : status.browsers.map((hello) => hello.browser);
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
    await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/not connected/);
  });

  it('round-trips requests and errors', async () => {
    const port = await startBridge();
    await connectExtension(port, (method, params) => {
      if (method === 'boom') throw new Error('kaboom');
      return { method, params };
    });
    await expect(bridge!.request('chrome', 'tabs.list', { windowId: 1 })).resolves.toEqual({ method: 'tabs.list', params: { windowId: 1 } });
    await expect(bridge!.request('chrome', 'boom', {})).rejects.toThrow('kaboom');
  });

  it('times out unanswered requests', async () => {
    const port = await startBridge({ requestTimeoutMs: 50 });
    const ws = await connect(port, EXT_ORIGIN);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/did not answer/);
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
      await expect(second.request('chrome', 'tabs.list', { windowId: 2 })).resolves.toEqual({ method: 'tabs.list', params: { windowId: 2 } });
      await expect(second.request('chrome', 'boom', {})).rejects.toThrow('kaboom');
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toEqual({ method: 'tabs.list', params: {} });
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
      await expect(second.request('chrome', 'tabs.list', {})).rejects.toThrow(/not connected/);
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
      await expect(second.request('chrome', 'tabs.list', {})).resolves.toBe('ok');
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

  describe('with several browsers', () => {
    async function connectBoth(port: number) {
      const chrome = await connectExtension(port, (method) => `chrome:${method}`, { browser: 'chrome' });
      const safari = await connectExtension(port, (method) => `safari:${method}`, { origin: SAFARI_ORIGIN, browser: 'safari' });
      return { chrome, safari };
    }

    it('keeps Chrome and Safari connected side by side', async () => {
      const port = await startBridge();
      await connectBoth(port);
      expect(browsersOf(bridge!).sort()).toEqual(['chrome', 'safari']);
    });

    it('routes each request to the browser it names', async () => {
      const port = await startBridge();
      await connectBoth(port);
      await expect(bridge!.request('safari', 'tabs.list', {})).resolves.toBe('safari:tabs.list');
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('chrome:tabs.list');
    });

    it('reports a browser that is not connected', async () => {
      const port = await startBridge();
      await connectExtension(port, () => null);
      await expect(bridge!.request('safari', 'tabs.list', {})).rejects.toThrow(/not connected in safari/);
    });

    it('keeps one browser working when the other disconnects', async () => {
      const port = await startBridge();
      const { safari } = await connectBoth(port);
      safari.close();
      await expect.poll(() => browsersOf(bridge!)).toEqual(['chrome']);
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('chrome:tabs.list');
    });

    it('replaces only the older connection from the same browser', async () => {
      const port = await startBridge();
      const { chrome } = await connectBoth(port);
      const closed = new Promise((resolve) => chrome.once('close', resolve));
      await connectExtension(port, () => 'new chrome', { browser: 'chrome' });
      await closed;
      expect(browsersOf(bridge!).sort()).toEqual(['chrome', 'safari']);
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('new chrome');
      await expect(bridge!.request('safari', 'tabs.list', {})).resolves.toBe('safari:tabs.list');
    });

    it('relays the browser choice and the browser list', async () => {
      const port = await startBridge();
      await connectBoth(port);
      const second = new ExtensionBridge({ port });
      try {
        await second.start();
        await expect.poll(() => browsersOf(second).sort()).toEqual(['chrome', 'safari']);
        await expect(second.request('safari', 'tabs.close', { tabIds: [1] })).resolves.toBe('safari:tabs.close');
        await expect(second.request('chrome', 'tabs.close', { tabIds: [1] })).resolves.toBe('chrome:tabs.close');
      } finally {
        await second.stop();
      }
    });

    it('treats an extension without a browser field as Chrome', async () => {
      const port = await startBridge();
      await connectExtension(port, () => 'legacy');
      expect(browsersOf(bridge!)).toEqual(['chrome']);
    });
  });
});
