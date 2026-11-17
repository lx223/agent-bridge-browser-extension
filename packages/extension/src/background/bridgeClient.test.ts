import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocketClient, { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { PROTOCOL_VERSION } from '@agent-browser-bridge/protocol';
import { BridgeClient, type ConnectionState } from './bridgeClient.ts';

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
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '9.9.9' }) } });
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
      { type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '9.9.9', userAgent: navigator.userAgent },
    ]);
    expect(states).toEqual(['connecting', 'connected']);
    expect(client.status.state).toBe('connected');
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
});
