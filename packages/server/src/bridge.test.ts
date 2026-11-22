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
  bridge = new ExtensionBridge({ port: 0, reconnectGraceMs: 0, reloadGraceMs: 0, hostChangeGraceMs: 0, ...opts });
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
  instanceId?: string;
  label?: string;
  name?: string;
}

async function connectExtension(
  port: number,
  handler: (method: string, params: unknown) => unknown,
  { origin = EXT_ORIGIN, browser, instanceId, label, name }: ExtensionOptions = {},
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
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test', browser, instanceId, label, name }));
  const expected = browser ?? 'chrome';
  await expect
    .poll(() => connectedTo(bridge!).some((hello) => hello.browser === expected && hello.instanceId === instanceId))
    .toBe(true);
  return ws;
}

function connectedTo(b: ExtensionBridge) {
  const status = b.status();
  return status.state === 'error' ? [] : status.browsers;
}

const browsersOf = (b: ExtensionBridge) => connectedTo(b).map((hello) => hello.browser);
const instancesOf = (b: ExtensionBridge) => connectedTo(b).map((hello) => hello.instanceId);

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
      await bridge!.request('chrome', 'tabs.list', {});
      await relay.request('chrome', 'tabs.list', {});
      await legacyRelay.request('chrome', 'tabs.list', {});
      expect(seen).toEqual([agent('host-agent'), agent('relay-agent'), undefined]);
    } finally {
      await relay.stop();
      await legacyRelay.stop();
    }
  });

  it('tells the extension which agent sessions share the bridge', async () => {
    const agent = (name: string | null) => ({ serverVersion: '9.9.9', client: name ? { name, version: '1.0' } : null });
    let hostClient: string | null = null;
    const port = await startBridge({ agentInfo: () => agent(hostClient) });
    const lists: unknown[] = [];
    const ext = await connect(port, EXT_ORIGIN);
    ext.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'agents') lists.push(msg.agents);
    });
    ext.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => lists.at(-1)).toEqual([agent(null)]);

    hostClient = 'host-agent';
    bridge!.agentChanged();
    await expect.poll(() => lists.at(-1)).toEqual([agent('host-agent')]);

    let relayClient = 'relay-agent';
    const relay = new ExtensionBridge({ port, agentInfo: () => agent(relayClient) });
    try {
      await relay.start();
      await expect.poll(() => lists.at(-1)).toEqual([agent('host-agent'), agent('relay-agent')]);
      relayClient = 'renamed-agent';
      relay.agentChanged();
      await expect.poll(() => lists.at(-1)).toEqual([agent('host-agent'), agent('renamed-agent')]);
    } finally {
      await relay.stop();
    }
    await expect.poll(() => lists.at(-1)).toEqual([agent('host-agent')]);
  });

  describe('agent session activity', () => {
    const session = (sessionId: string, name = 'claude-code') => ({
      serverVersion: '9.9.9',
      client: { name, version: '2.0' },
      sessionId,
      startedAt: 1_000,
      project: { name: 'shop', path: '/work/shop' },
    });

    async function listen(port: number) {
      const lists: Array<Array<Record<string, unknown>>> = [];
      const ws = await connectExtension(port, () => [], { instanceId: 'aaaa1111', label: 'Chrome', name: 'Work' });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'agents') lists.push(msg.agents);
      });
      return lists;
    }

    it('reports what each session last did and which instances it used', async () => {
      const port = await startBridge({ agentInfo: () => session('host-session') });
      const lists = await listen(port);
      await connectExtension(port, () => [], { instanceId: 'bbbb2222', label: 'Edge' });
      await bridge!.request('chrome', 'tabs.list', {}, undefined, 'bbbb2222');
      await bridge!.request('chrome', 'page.snapshot', { tabId: 1 }, undefined, 'aaaa1111');
      await bridge!.request('chrome', 'instance.setName', { name: 'Work' }, undefined, 'aaaa1111');
      await expect.poll(() => (lists.at(-1)?.[0]?.activity as { calls?: number } | undefined)?.calls).toBe(3);
      expect(lists.at(-1)).toEqual([
        {
          ...session('host-session'),
          activity: {
            lastUsedAt: expect.any(Number),
            lastTool: 'browser_name_instance',
            calls: 3,
            instances: [
              { browser: 'chrome', instanceId: 'aaaa1111', label: 'Chrome', name: 'Work' },
              { browser: 'chrome', instanceId: 'bbbb2222', label: 'Edge' },
            ],
          },
        },
      ]);
      expect(bridge!.agents()[0]!.activity?.lastTool).toBe('browser_name_instance');
    });

    it('names chat activity after the chat tools and leaves out unread checks', async () => {
      const port = await startBridge({ agentInfo: () => session('host-session') });
      await listen(port);
      await bridge!.request('chrome', 'chat.receive', { waitMs: 0 });
      await bridge!.request('chrome', 'chat.peek', {});
      expect(bridge!.agents()[0]!.activity).toMatchObject({ lastTool: 'browser_chat_receive', calls: 1 });
    });

    it('names tools after the browser and ignores sessions without an id', async () => {
      const port = await startBridge({ agentInfo: () => ({ serverVersion: '9.9.9', client: null }) });
      await listen(port);
      await bridge!.request('chrome', 'tabs.list', {});
      expect(bridge!.agents()).toEqual([{ serverVersion: '9.9.9', client: null }]);
      const relay = new ExtensionBridge({ port, agentInfo: () => session('relay-session') });
      try {
        await relay.start();
        await expect.poll(() => bridge!.agents().length).toBe(2);
        await relay.request('chrome', 'tabs.list', {});
        await relay.request('chrome', 'custom.method', {}).catch(() => undefined);
        expect(bridge!.agents()[1]!.activity).toMatchObject({ lastTool: 'custom.method', calls: 2 });
        await relay.request('chrome', 'tabs.list', {});
        expect(bridge!.agents()[1]!.activity).toMatchObject({ lastTool: 'chrome_tabs_list', calls: 3 });
      } finally {
        await relay.stop();
      }
    });

    it('shows one entry per session while an updated worker takes over, and forgets the session once it leaves', async () => {
      const port = await startBridge();
      const lists = await listen(port);
      const oldWorker = new ExtensionBridge({ port, agentInfo: () => session('shared', 'old') });
      const newWorker = new ExtensionBridge({ port, agentInfo: () => session('shared', 'new') });
      try {
        await oldWorker.start();
        await oldWorker.request('chrome', 'tabs.list', {});
        await newWorker.start();
        await expect.poll(() => lists.at(-1)?.map((agent) => (agent.client as { name: string }).name)).toEqual(['new']);
        await oldWorker.stop();
        await expect.poll(() => bridge!.agents()).toHaveLength(1);
        expect(bridge!.agents()[0]!.activity?.calls).toBe(1);
      } finally {
        await oldWorker.stop();
        await newWorker.stop();
      }
      await expect.poll(() => bridge!.agents()).toEqual([]);
      const comeback = new ExtensionBridge({ port, agentInfo: () => session('shared') });
      try {
        await comeback.start();
        await expect.poll(() => bridge!.agents()).toHaveLength(1);
        expect(bridge!.agents()[0]!.activity).toBeUndefined();
      } finally {
        await comeback.stop();
      }
    });
  });

  it('times out unanswered requests', async () => {
    const port = await startBridge({ requestTimeoutMs: 50 });
    const ws = await connect(port, EXT_ORIGIN);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/did not answer/);
  });

  it('waits as long as the request asks the browser to, plus a margin', async () => {
    const port = await startBridge({ requestTimeoutMs: 50 });
    const ws = await connect(port, EXT_ORIGIN);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'request') setTimeout(() => ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result: 'matched' })), 150);
    });
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
    await expect.poll(() => bridge!.status().state).toBe('connected');
    await expect(bridge!.request('chrome', 'tabs.waitFor', { tabId: 1, url: '*', timeoutMs: 100 })).resolves.toBe('matched');
    await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow('Browser did not answer tabs.list within 0.05s');
  });

  it('explains a tool the extension is too old to have, through relays too', async () => {
    const port = await startBridge({ version: '0.5.0' });
    await connectExtension(port, (method) => {
      throw new Error(`Unknown method: ${method}`);
    });
    const explained =
      'The Chrome extension is version 0.1.0, older than this server (0.5.0), and does not have chrome_tabs_update. Ask the user to quit and reopen Chrome, which installs the waiting extension update.';
    await expect(bridge!.request('chrome', 'tabs.update', { tabId: 1, active: true })).rejects.toThrow(explained);
    const second = new ExtensionBridge({ port });
    try {
      await second.start();
      await expect.poll(() => second.status()).toMatchObject({ state: 'connected', role: 'relay' });
      await expect(second.request('chrome', 'tabs.update', { tabId: 1, active: true })).rejects.toThrow(explained);
      await expect(second.request('chrome', 'other.thing', {})).rejects.toThrow('Unknown method: other.thing');
    } finally {
      await second.stop();
    }
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

  describe('when a newer server joins', () => {
    const agent = (serverVersion: string) => ({ serverVersion, client: { name: 'agent', version: '1.0' } });
    const others: ExtensionBridge[] = [];

    afterEach(async () => {
      for (const other of others.splice(0)) await other.stop();
    });

    async function joinAs(port: number, version: string) {
      const other = new ExtensionBridge({ port, version, agentInfo: () => agent(version), handoverWaitMs: 1_000 });
      others.push(other);
      await other.start();
      return other;
    }

    function reconnectOnHandover(ws: WebSocket, port: number, handler: (method: string) => unknown) {
      return new Promise<{ code: number }>((resolve) => {
        ws.once('close', (code) => {
          resolve({ code });
          void (async () => {
            for (;;) {
              try {
                await connectExtension(port, handler);
                return;
              } catch {
                await new Promise((wait) => setTimeout(wait, 50));
              }
            }
          })();
        });
      });
    }

    it('hands hosting over and keeps both sessions working', async () => {
      const port = await startBridge({ version: '0.3.0', agentInfo: () => agent('0.3.0') });
      const handler = (method: string) => `ok:${method}`;
      const ext = await connectExtension(port, handler);
      const closed = reconnectOnHandover(ext, port, handler);

      const newer = await joinAs(port, '0.4.0');
      await expect(closed).resolves.toEqual({ code: 4002 });
      await expect.poll(() => newer.status()).toMatchObject({ role: 'host', state: 'connected' });
      await expect.poll(() => bridge!.status()).toMatchObject({ role: 'relay', state: 'connected' });

      await expect(newer.request('chrome', 'tabs.list', {})).resolves.toBe('ok:tabs.list');
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('ok:tabs.list');
    });

    it('moves other relayed sessions to the new host', async () => {
      const port = await startBridge({ version: '0.3.0', agentInfo: () => agent('0.3.0') });
      const handler = () => 'ok';
      const ext = await connectExtension(port, handler);
      void reconnectOnHandover(ext, port, handler);
      const sibling = await joinAs(port, '0.3.0');
      expect(sibling.status()).toMatchObject({ role: 'relay' });

      const newer = await joinAs(port, '0.4.0');
      await expect.poll(() => newer.status()).toMatchObject({ role: 'host', state: 'connected' });
      await expect.poll(() => sibling.status()).toMatchObject({ role: 'relay', state: 'connected' });
      await expect(sibling.request('chrome', 'tabs.list', {})).resolves.toBe('ok');
    });

    it('finishes a request already in flight before handing over', async () => {
      const port = await startBridge({ version: '0.3.0', agentInfo: () => agent('0.3.0') });
      let answer: (() => void) | undefined;
      const ext = await connect(port, EXT_ORIGIN);
      ext.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'request') answer = () => ext.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result: 'slow' }));
      });
      ext.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test' }));
      await expect.poll(() => bridge!.status().state).toBe('connected');

      const inFlight = bridge!.request('chrome', 'tabs.list', {});
      await expect.poll(() => answer).toBeDefined();
      const newer = await joinAs(port, '0.4.0');
      await expect.poll(() => newer.status()).toMatchObject({ role: 'host' });
      expect(ext.readyState).toBe(WebSocket.OPEN);
      answer!();
      await expect(inFlight).resolves.toBe('slow');
      await expect.poll(() => ext.readyState).toBe(WebSocket.CLOSED);
    });

    it.each([
      ['the same version', '0.3.0'],
      ['an older version', '0.2.9'],
    ])('keeps hosting when %s joins', async (_, version) => {
      const port = await startBridge({ version: '0.3.0', agentInfo: () => agent('0.3.0') });
      const ext = await connectExtension(port, () => 'ok');
      const other = await joinAs(port, version);
      await expect.poll(() => other.status().state).toBe('connected');
      await new Promise((wait) => setTimeout(wait, 100));
      expect(bridge!.status()).toMatchObject({ role: 'host' });
      expect(other.status()).toMatchObject({ role: 'relay' });
      expect(ext.readyState).toBe(WebSocket.OPEN);
    });

    it('keeps hosting when its own version is unknown', async () => {
      const port = await startBridge();
      await connectExtension(port, () => 'ok');
      const other = await joinAs(port, '9.0.0');
      await expect.poll(() => other.status().state).toBe('connected');
      await new Promise((wait) => setTimeout(wait, 100));
      expect(bridge!.status()).toMatchObject({ role: 'host' });
    });
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

  describe('with several instances of one browser', () => {
    async function connectTwo(port: number) {
      const personal = await connectExtension(port, () => 'personal', { instanceId: 'aaaa1111', label: 'Chrome' });
      const edge = await connectExtension(port, () => 'edge', { instanceId: 'bbbb2222', label: 'Edge' });
      return { personal, edge };
    }

    it('keeps both connected', async () => {
      const port = await startBridge();
      await connectTwo(port);
      expect(instancesOf(bridge!).sort()).toEqual(['aaaa1111', 'bbbb2222']);
    });

    it('routes to the named instance', async () => {
      const port = await startBridge();
      await connectTwo(port);
      await expect(bridge!.request('chrome', 'tabs.list', {}, null, 'aaaa1111')).resolves.toBe('personal');
      await expect(bridge!.request('chrome', 'tabs.list', {}, null, 'bbbb2222')).resolves.toBe('edge');
    });

    it('asks for an instance when several could answer', async () => {
      const port = await startBridge();
      await connectTwo(port);
      await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/aaaa1111 \(Chrome\), bbbb2222 \(Edge\).*Pass instance/);
    });

    it('lists instances by name and suggests identifying them', async () => {
      const port = await startBridge();
      await connectExtension(port, () => 'work', { instanceId: 'aaaa1111', label: 'Chrome', name: 'Work' });
      await connectExtension(port, () => 'other', { instanceId: 'bbbb2222', label: 'Chrome' });
      await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(
        /"Work" \(Chrome, aaaa1111\), bbbb2222 \(Chrome\)\. Pass instance to choose one\. .*browser_identify_instances/,
      );
    });

    it('takes a new name from a repeated hello on the same connection', async () => {
      const port = await startBridge();
      const ws = await connectExtension(port, () => 'work', { instanceId: 'aaaa1111', label: 'Chrome' });
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test', instanceId: 'aaaa1111', label: 'Chrome', name: 'Work' }));
      await expect.poll(() => connectedTo(bridge!).map((hello) => hello.name)).toEqual(['Work']);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('work');
    });

    it('reports an unknown instance', async () => {
      const port = await startBridge();
      await connectTwo(port);
      await expect(bridge!.request('chrome', 'tabs.list', {}, null, 'cccc3333')).rejects.toThrow(/No chrome instance "cccc3333"/);
    });

    it('needs no instance when only one is connected', async () => {
      const port = await startBridge();
      await connectExtension(port, () => 'only', { instanceId: 'aaaa1111' });
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('only');
    });

    it('replaces the older connection from the same instance only', async () => {
      const port = await startBridge();
      const { personal } = await connectTwo(port);
      const closed = new Promise((resolve) => personal.once('close', resolve));
      await connectExtension(port, () => 'personal again', { instanceId: 'aaaa1111' });
      await closed;
      expect(instancesOf(bridge!).sort()).toEqual(['aaaa1111', 'bbbb2222']);
      await expect(bridge!.request('chrome', 'tabs.list', {}, null, 'aaaa1111')).resolves.toBe('personal again');
      await expect(bridge!.request('chrome', 'tabs.list', {}, null, 'bbbb2222')).resolves.toBe('edge');
    });

    it('relays the instance choice', async () => {
      const port = await startBridge();
      await connectTwo(port);
      const second = new ExtensionBridge({ port });
      try {
        await second.start();
        await expect.poll(() => instancesOf(second).sort()).toEqual(['aaaa1111', 'bbbb2222']);
        await expect(second.request('chrome', 'tabs.list', {}, null, 'bbbb2222')).resolves.toBe('edge');
        await expect(second.request('chrome', 'tabs.list', {})).rejects.toThrow(/Pass instance/);
      } finally {
        await second.stop();
      }
    });

    it('still replaces a legacy extension that sends no instance id', async () => {
      const port = await startBridge();
      const first = await connectExtension(port, () => 'first');
      const closed = new Promise((resolve) => first.once('close', resolve));
      await connectExtension(port, () => 'second');
      await closed;
      expect(browsersOf(bridge!)).toEqual(['chrome']);
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('second');
    });
  });

  describe('when an extension reconnects', () => {
    async function connectSilent(port: number, instanceId: string) {
      const ws = await connect(port, EXT_ORIGIN);
      const received: string[] = [];
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'request') received.push(msg.method);
      });
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.1.0', userAgent: 'test', instanceId }));
      await expect.poll(() => instancesOf(bridge!)).toContain(instanceId);
      return { ws, received };
    }

    async function reload(ws: WebSocket) {
      ws.send(JSON.stringify({ type: 'reloading' }));
      await expect.poll(() => instancesOf(bridge!).length).toBeGreaterThan(0);
      const closed = new Promise((resolve) => ws.once('close', resolve));
      ws.close();
      await closed;
    }

    it('holds a call while the extension reloads for an update and sends it once it is back', async () => {
      const port = await startBridge({ reloadGraceMs: 5_000 });
      const ext = await connectExtension(port, () => 'old', { instanceId: 'aaaa1111' });
      await reload(ext);
      await expect.poll(() => instancesOf(bridge!)).toEqual([]);
      const call = bridge!.request('chrome', 'tabs.list', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectExtension(port, () => 'updated', { instanceId: 'aaaa1111' });
      await expect(call).resolves.toBe('updated');
    });

    it('waits only briefly after an unexpected disconnect', async () => {
      const port = await startBridge({ reconnectGraceMs: 200, reloadGraceMs: 5_000 });
      const ext = await connectExtension(port, () => 'ok', { instanceId: 'aaaa1111' });
      ext.close();
      await expect.poll(() => instancesOf(bridge!)).toEqual([]);
      const started = Date.now();
      await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/not connected/);
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('does not wait for an instance once it is back', async () => {
      const port = await startBridge({ reloadGraceMs: 60_000 });
      const ext = await connectExtension(port, () => 'old', { instanceId: 'aaaa1111' });
      await reload(ext);
      await connectExtension(port, () => 'back', { instanceId: 'aaaa1111' });
      await expect(bridge!.ready('chrome')).resolves.toBeUndefined();
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('back');
    });

    it('repeats a read-only call that a reload cut off', async () => {
      const port = await startBridge({ reloadGraceMs: 5_000 });
      const { ws, received } = await connectSilent(port, 'aaaa1111');
      const call = bridge!.request('chrome', 'tabs.list', {});
      await expect.poll(() => received).toEqual(['tabs.list']);
      await reload(ws);
      await connectExtension(port, () => 'answered after the update', { instanceId: 'aaaa1111' });
      await expect(call).resolves.toBe('answered after the update');
    });

    it('does not repeat an action that a reload cut off, and says it may have happened', async () => {
      const port = await startBridge({ reloadGraceMs: 5_000 });
      const { ws, received } = await connectSilent(port, 'aaaa1111');
      const call = bridge!.request('chrome', 'tabs.close', { tabIds: [1] }).catch((err: Error) => err);
      await expect.poll(() => received).toEqual(['tabs.close']);
      await reload(ws);
      await expect(call).resolves.toHaveProperty(
        'message',
        'The browser extension in chrome reloaded to install an update. It was running chrome_tabs_close, which may or may not have taken effect; check before trying again.',
      );
    });

    it('lets relayed sessions wait for the reload too', async () => {
      const port = await startBridge({ reloadGraceMs: 5_000 });
      const ext = await connectExtension(port, () => 'old', { instanceId: 'aaaa1111' });
      const second = new ExtensionBridge({ port });
      try {
        await second.start();
        await expect.poll(() => instancesOf(second)).toEqual(['aaaa1111']);
        await reload(ext);
        await expect.poll(() => instancesOf(second)).toEqual([]);
        const call = second.request('chrome', 'tabs.list', {});
        await new Promise((resolve) => setTimeout(resolve, 50));
        await connectExtension(port, () => 'updated', { instanceId: 'aaaa1111' });
        await expect(call).resolves.toBe('updated');
      } finally {
        await second.stop();
      }
    });

    it('repeats a read-only call through a relay whose host exited', async () => {
      const port = await startBridge();
      const { received } = await connectSilent(port, 'aaaa1111');
      const second = new ExtensionBridge({ port, hostChangeGraceMs: 5_000, reconnectGraceMs: 0 });
      try {
        await second.start();
        await expect.poll(() => instancesOf(second)).toEqual(['aaaa1111']);
        const call = second.request('chrome', 'tabs.list', {});
        await expect.poll(() => received).toEqual(['tabs.list']);
        await bridge!.stop();
        bridge = second;
        await expect.poll(() => second.status()).toMatchObject({ role: 'host' });
        await connectExtension(port, () => 'answered by the new host', { instanceId: 'aaaa1111' });
        await expect(call).resolves.toBe('answered by the new host');
      } finally {
        await second.stop();
      }
    });

    it('waits for browsers to connect when it took over from a server that stopped', async () => {
      const port = await startBridge({ startupGraceMs: 5_000 });
      const call = bridge!.request('chrome', 'tabs.list', {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectExtension(port, () => 'connected after the restart');
      await expect(call).resolves.toBe('connected after the restart');
    });

    it('stops waiting for a browser once its start-up grace has passed', async () => {
      await startBridge({ startupGraceMs: 100 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const started = Date.now();
      await expect(bridge!.request('chrome', 'tabs.list', {})).rejects.toThrow(/not connected/);
      expect(Date.now() - started).toBeLessThan(50);
    });

    it('survives a connection that sends a broken frame', async () => {
      const port = await startBridge();
      const broken = await connect(port, EXT_ORIGIN);
      const closed = new Promise((resolve) => broken.once('close', resolve));
      (broken as unknown as { _socket: { write(data: Buffer): void } })._socket.write(Buffer.from([0x8f, 0x80, 0, 0, 0, 0]));
      await closed;
      await connectExtension(port, () => 'still working');
      await expect(bridge!.request('chrome', 'tabs.list', {})).resolves.toBe('still working');
    });
  });
});
