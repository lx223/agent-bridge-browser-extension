import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocketClient, { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { PROTOCOL_VERSION, REMOTE_UNAUTHORIZED_CLOSE_CODE, REPLACED_CLOSE_CODE } from '@agent-browser-bridge/protocol';
import { BridgeClient, UntrustedRelayError, type ConnectionState, type ConnectionStatus } from './bridgeClient.ts';

type Dispatch = ConstructorParameters<typeof BridgeClient>[1];
type Message = Record<string, unknown>;

interface Peer {
  socket: ServerSocket;
  received: Message[];
}

class BrowserLikeSocket extends WebSocketClient {
  constructor(url: string) {
    super(url);
    this.on('error', () => {});
  }
}

let server: WebSocketServer | undefined;
let peers: Peer[] = [];
let clients: BridgeClient[] = [];
let stored: Record<string, unknown> = {};

const until = async (condition: () => boolean) => {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
};

function listen(port = 0): Promise<number> {
  return new Promise((resolve) => {
    const wss: WebSocketServer = new WebSocketServer({ port, host: '127.0.0.1' });
    wss.on('listening', () => resolve((wss.address() as { port: number }).port));
    wss.on('connection', (socket) => {
      const peer: Peer = { socket, received: [] };
      peers.push(peer);
      socket.on('message', (raw) => peer.received.push(JSON.parse(raw.toString())));
    });
    server = wss;
  });
}

async function stopServer() {
  const wss = server;
  server = undefined;
  if (!wss) return;
  for (const socket of wss.clients) socket.terminate();
  await new Promise((resolve) => wss.close(resolve));
}

function createClient(port: number, dispatch: Dispatch = async () => null) {
  const states: ConnectionState[] = [];
  const client = new BridgeClient(`ws://127.0.0.1:${port}`, dispatch, (status) => states.push(status.state));
  clients.push(client);
  return { client, states };
}

async function connected(dispatch?: Dispatch) {
  const port = await listen();
  const created = createClient(port, dispatch);
  created.client.connect();
  await until(() => peers.length === 1 && peers[0]!.received.length === 1);
  return { ...created, port, peer: peers[0]! };
}

const request = (peer: Peer, id: string, method: string, params: unknown = {}, agent?: unknown) =>
  peer.socket.send(JSON.stringify({ type: 'request', id, method, params, ...(agent ? { agent } : {}) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('WebSocket', BrowserLikeSocket);
  stored = { bridgeInstanceId: 'abc12345' };
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '9.9.9' }), getURL: () => 'chrome-extension://test/' },
    storage: {
      local: {
        get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(stored, items),
      },
    },
  });
});

afterEach(async () => {
  vi.clearAllTimers();
  await stopServer();
  await until(() => clients.every((c) => c.status.state === 'disconnected'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  peers = [];
  clients = [];
});

describe('BridgeClient', () => {
  it('starts out disconnected', () => {
    const { client } = createClient(1);
    expect(client.status).toMatchObject({ state: 'disconnected', url: 'ws://127.0.0.1:1' });
  });

  it('introduces itself once the socket opens', async () => {
    const { client, states, peer } = await connected();
    expect(peer.received).toEqual([
      {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        extensionVersion: '9.9.9',
        userAgent: navigator.userAgent,
        browser: 'chrome',
        instanceId: 'abc12345',
        label: 'Chrome',
      },
    ]);
    expect(states).toEqual(['connecting', 'connected']);
    expect(client.status.state).toBe('connected');
  });

  it('reports its own instance id once it has introduced itself', async () => {
    const { client } = createClient(1);
    expect(client.status).not.toHaveProperty('instanceId');
    const { client: introduced } = await connected();
    expect(introduced.status.instanceId).toBe('abc12345');
  });

  it('keeps a single socket when asked to connect again', async () => {
    const { client, states } = await connected();
    client.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(peers).toHaveLength(1);
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('answers requests with the dispatched result', async () => {
    const dispatch = vi.fn(async () => [{ id: 1 }]);
    const { peer } = await connected(dispatch);
    const agent = { serverVersion: '1.0.0', client: { name: 'claude', version: '2.0.0' } };
    request(peer, 'a', 'tabs.list', { windowId: 3 }, agent);
    await until(() => peer.received.length === 2);
    expect(dispatch).toHaveBeenCalledWith('tabs.list', { windowId: 3 }, agent);
    expect(peer.received[1]).toEqual({ type: 'response', id: 'a', ok: true, result: [{ id: 1 }] });
  });

  it('is idle when no request is being handled', async () => {
    const { client } = await connected();
    await expect(client.whenIdle()).resolves.toBeUndefined();
  });

  it('becomes idle only once every request in flight has been answered', async () => {
    const finishers: (() => void)[] = [];
    const dispatch = vi.fn(() => new Promise((resolve) => finishers.push(() => resolve(null))));
    const { client, peer } = await connected(dispatch);
    request(peer, 'a', 'tabs.list');
    request(peer, 'b', 'tabs.list');
    await until(() => finishers.length === 2);
    let idle = false;
    void client.whenIdle().then(() => (idle = true));
    finishers[0]!();
    await until(() => peer.received.length === 2);
    expect(idle).toBe(false);
    finishers[1]!();
    await until(() => idle);
    expect(peer.received).toHaveLength(3);
  });

  it('becomes idle after a failed request too', async () => {
    let fail: (err: Error) => void = () => {};
    const dispatch = vi.fn(() => new Promise((_, reject) => (fail = reject)));
    const { client, peer } = await connected(dispatch);
    request(peer, 'a', 'boom');
    await until(() => dispatch.mock.calls.length === 1);
    let idle = false;
    void client.whenIdle().then(() => (idle = true));
    fail(new Error('kaboom'));
    await until(() => idle);
  });

  it('passes a null agent and a null result when neither is provided', async () => {
    const dispatch = vi.fn(async () => undefined);
    const { peer } = await connected(dispatch);
    request(peer, 'b', 'tabs.close', { tabIds: [1] });
    await until(() => peer.received.length === 2);
    expect(dispatch).toHaveBeenCalledWith('tabs.close', { tabIds: [1] }, null);
    expect(peer.received[1]).toEqual({ type: 'response', id: 'b', ok: true, result: null });
  });

  it('reports handler failures as error responses', async () => {
    const { peer } = await connected(async (method) => {
      if (method === 'tabs.close') throw new Error('No tab with id: 5.');
      throw 'plain failure';
    });
    request(peer, 'c', 'tabs.close');
    request(peer, 'd', 'tabs.list');
    await until(() => peer.received.length === 3);
    expect(peer.received.slice(1)).toEqual([
      { type: 'response', id: 'c', ok: false, error: 'No tab with id: 5.' },
      { type: 'response', id: 'd', ok: false, error: 'plain failure' },
    ]);
  });

  it('ignores malformed and non-request messages', async () => {
    const dispatch = vi.fn(async () => 'ok');
    const { peer } = await connected(dispatch);
    peer.socket.send('not json');
    peer.socket.send(JSON.stringify({ type: 'request', method: 'tabs.list' }));
    peer.socket.send(JSON.stringify({ type: 'pong' }));
    request(peer, 'e', 'tabs.list');
    await until(() => peer.received.length === 2);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(peer.received[1]).toMatchObject({ id: 'e', ok: true });
  });

  it('tracks the agent sessions the server reports and forgets them on disconnect', async () => {
    const { client, states, peer } = await connected();
    const agents = [
      { serverVersion: '1.0.0', client: { name: 'claude-code', version: '2.0.0' } },
      { serverVersion: '1.0.0', client: null },
    ];
    expect(client.status.agents).toEqual([]);
    peer.socket.send(JSON.stringify({ type: 'agents', agents }));
    await until(() => client.status.agents.length === 2);
    expect(client.status).toMatchObject({ state: 'connected', agents });
    expect(states).toEqual(['connecting', 'connected', 'connected']);
    peer.socket.terminate();
    await until(() => client.status.state === 'disconnected');
    expect(client.status.agents).toEqual([]);
  });

  it('tells the server before it reloads for an update', async () => {
    const { client, peer } = await connected();
    const announced = client.announceReload();
    await vi.advanceTimersByTimeAsync(500);
    await announced;
    await until(() => peer.received.length === 2);
    expect(peer.received[1]).toEqual({ type: 'reloading' });
  });

  it('has nothing to announce while disconnected', async () => {
    const { client } = createClient(1);
    await expect(client.announceReload()).resolves.toBeUndefined();
  });

  it('pings every 20 seconds to keep the service worker alive', async () => {
    const { peer } = await connected();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(peer.received).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => peer.received.length === 2);
    await vi.advanceTimersByTimeAsync(20_000);
    await until(() => peer.received.length === 3);
    expect(peer.received.slice(1)).toEqual([{ type: 'ping' }, { type: 'ping' }]);
  });

  it('stops pinging and reconnects after the server drops the socket', async () => {
    const { states, peer } = await connected();
    peer.socket.terminate();
    await until(() => states.at(-1) === 'disconnected');
    await vi.advanceTimersByTimeAsync(999);
    expect(states.at(-1)).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(1);
    await until(() => peers.length === 2 && peers[1]!.received.length === 1);
    expect(states).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'connected']);
    expect(peers[1]!.received[0]).toMatchObject({ type: 'hello' });
    await vi.advanceTimersByTimeAsync(20_000);
    await until(() => peers[1]!.received.length === 2);
    expect(peer.received).toHaveLength(1);
  });

  it('backs off between failed attempts up to ten seconds', async () => {
    const { client, states, port } = await connected();
    await stopServer();
    await until(() => states.at(-1) === 'disconnected');

    const attempts = () => states.filter((s) => s === 'connecting').length;
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = attempts();
      let waited = 0;
      while (attempts() === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      waits.push(waited);
      await until(() => states.at(-1) === 'disconnected');
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);

    await listen(port);
    await vi.advanceTimersByTimeAsync(10_000);
    await until(() => client.status.state === 'connected');
    peers.at(-1)!.socket.terminate();
    await until(() => states.at(-1) === 'disconnected');
    const before = attempts();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts()).toBe(before + 1);
  });

  it('retries immediately when asked while waiting to reconnect', async () => {
    const { client, states, peer } = await connected();
    peer.socket.terminate();
    await until(() => states.at(-1) === 'disconnected');
    client.connect();
    await until(() => client.status.state === 'connected');
    await vi.advanceTimersByTimeAsync(5000);
    expect(peers).toHaveLength(2);
  });

  it('introduces itself with the name the user gave this profile', async () => {
    stored.bridgeInstanceName = '  Work ';
    const { peer } = await connected();
    expect(peer.received[0]).toMatchObject({ type: 'hello', instanceId: 'abc12345', name: 'Work' });
  });

  it('introduces itself again when asked, such as after a rename', async () => {
    const { client, peer } = await connected();
    stored.bridgeInstanceName = 'Personal';
    client.reintroduce();
    await until(() => peer.received.length === 2);
    expect(peer.received[1]).toMatchObject({ type: 'hello', instanceId: 'abc12345', name: 'Personal' });
  });

  it('does not introduce itself while disconnected', () => {
    const { client } = createClient(1);
    expect(() => client.reintroduce()).not.toThrow();
  });

  it('takes a new instance id when another browser with the same id replaces it', async () => {
    const { states, peer } = await connected();
    peer.socket.close(REPLACED_CLOSE_CODE, 'Replaced by a newer connection');
    await until(() => states.at(-1) === 'disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => peers.length === 2 && peers[1]!.received.length === 1);
    const renewed = peers[1]!.received[0]!.instanceId;
    expect(renewed).toMatch(/^[0-9a-f]{8}$/);
    expect(renewed).not.toBe('abc12345');
    expect(stored.bridgeInstanceId).toBe(renewed);
  });

  it('keeps its instance id when the server simply goes away', async () => {
    const { states, peer } = await connected();
    peer.socket.close(1001, 'Going away');
    await until(() => states.at(-1) === 'disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => peers.length === 2 && peers[1]!.received.length === 1);
    expect(peers[1]!.received[0]).toMatchObject({ instanceId: 'abc12345' });
  });

  it('still identifies itself when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '9.9.9' }), getURL: () => 'chrome-extension://test/' },
      storage: { local: { get: async () => Promise.reject(new Error('storage unavailable')), set: async () => {} } },
    });
    const { peer } = await connected();
    expect(peer.received[0]!.instanceId).toMatch(/^[0-9a-f]{8}$/);
    expect(peer.received[0]).not.toHaveProperty('name');
  });

  it('completes the handshake before it introduces itself or counts as connected', async () => {
    const port = await listen();
    const states: ConnectionState[] = [];
    const seen: unknown[] = [];
    const client = new BridgeClient(`ws://127.0.0.1:${port}`, async () => null, (status) => states.push(status.state), {
      handshake: async (io) => {
        seen.push(await io.next());
        io.send({ type: 'remoteAuth', nonce: 'n'.repeat(43), proof: 'a'.repeat(64) });
        seen.push(await io.next());
      },
    });
    clients.push(client);
    client.connect();
    await until(() => peers.length === 1);
    const peer = peers[0]!;
    peer.socket.send(JSON.stringify({ type: 'remoteChallenge', nonce: 'c'.repeat(43) }));
    await until(() => peer.received.length === 1);
    expect(peer.received[0]).toMatchObject({ type: 'remoteAuth' });
    expect(states).toEqual(['connecting']);
    peer.socket.send(JSON.stringify({ type: 'remoteWelcome', proof: 'b'.repeat(64) }));
    await until(() => peer.received.length === 2);
    expect(peer.received[1]).toMatchObject({ type: 'hello' });
    expect(states).toEqual(['connecting', 'connected']);
    expect(seen).toEqual([{ type: 'remoteChallenge', nonce: 'c'.repeat(43) }, { type: 'remoteWelcome', proof: 'b'.repeat(64) }]);
    expect(client.status.problem).toBeUndefined();
  });

  it('does not answer requests that arrive before the handshake finishes', async () => {
    const port = await listen();
    const dispatch = vi.fn(async () => null);
    const client = new BridgeClient(`ws://127.0.0.1:${port}`, dispatch, () => {}, {
      handshake: async (io) => {
        await io.next();
        await io.next();
        throw new UntrustedRelayError('no');
      },
    });
    clients.push(client);
    client.connect();
    await until(() => peers.length === 1);
    request(peers[0]!, 'early', 'tabs.list');
    request(peers[0]!, 'early-2', 'tabs.list');
    await until(() => client.status.state === 'disconnected');
    expect(dispatch).not.toHaveBeenCalled();
    expect(peers[0]!.received).toEqual([]);
  });

  it('reports a relay that cannot prove the token and keeps reporting it while retrying', async () => {
    const port = await listen();
    const statuses: ConnectionStatus[] = [];
    const client = new BridgeClient(`ws://127.0.0.1:${port}`, async () => null, (status) => statuses.push(status), {
      handshake: async () => {
        throw new UntrustedRelayError('no proof');
      },
    });
    clients.push(client);
    client.connect();
    await until(() => statuses.at(-1)?.state === 'disconnected');
    expect(statuses.at(-1)?.problem).toBe('untrusted');
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => statuses.at(-1)?.state === 'connecting');
    expect(statuses.at(-1)?.problem).toBe('untrusted');
  });

  it('reports a relay that rejects the token', async () => {
    const port = await listen();
    const statuses: ConnectionStatus[] = [];
    const client = new BridgeClient(`ws://127.0.0.1:${port}`, async () => null, (status) => statuses.push(status), {
      handshake: async (io) => {
        await io.next();
      },
    });
    clients.push(client);
    client.connect();
    await until(() => peers.length === 1);
    peers[0]!.socket.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, 'Wrong browser token');
    await until(() => statuses.at(-1)?.state === 'disconnected');
    expect(statuses.at(-1)?.problem).toBe('rejected');
  });

  it('gives up on a handshake that takes too long', async () => {
    const port = await listen();
    const states: ConnectionState[] = [];
    const client = new BridgeClient(`ws://127.0.0.1:${port}`, async () => null, (status) => states.push(status.state), {
      handshake: (io) => io.next().then(() => undefined),
      handshakeTimeoutMs: 5_000,
    });
    clients.push(client);
    client.connect();
    await until(() => peers.length === 1);
    await vi.advanceTimersByTimeAsync(5_000);
    await until(() => states.at(-1) === 'disconnected');
    expect(states).toEqual(['connecting', 'disconnected']);
    expect(client.status.problem).toBeUndefined();
  });

  it('stays closed once closed', async () => {
    const { client, states } = await connected();
    client.close();
    await until(() => states.at(-1) === 'disconnected');
    client.connect();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(peers).toHaveLength(1);
    expect(client.status.state).toBe('disconnected');
  });
});
