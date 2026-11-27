import { describe, expect, it, vi } from 'vitest';
import { newRemoteNonce, newRemoteToken, remoteProof } from '@agent-browser-bridge/protocol';
import { UntrustedRelayError, type ConnectionStatus, type HandshakeIO } from './bridgeClient.ts';
import {
  loadRemoteSettings,
  readRemoteSettings,
  relayHandshake,
  remoteAgentConfig,
  RemoteConnection,
  REMOTE_SETTINGS_KEY,
  setBrowserToken,
  setRemoteAddress,
  setRemoteEnabled,
  type ClientFactory,
  type RemoteSettings,
  type Storage,
} from './remote.ts';

function memoryStorage(initial: Record<string, unknown> = {}): Storage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  };
}

const TOKEN = newRemoteToken();

describe('remote settings', () => {
  it('starts switched off with the default address and no token', async () => {
    expect(await loadRemoteSettings(memoryStorage(), 'https://relay.example.com')).toEqual({
      enabled: false,
      address: 'https://relay.example.com',
      browserToken: '',
    });
  });

  it('drops malformed stored values', () => {
    expect(readRemoteSettings({ enabled: 'yes', address: 42, browserToken: 'x'.repeat(600) })).toEqual({ enabled: false, address: '', browserToken: '' });
  });

  it('switches remote access on and off', async () => {
    const storage = memoryStorage();
    expect((await setRemoteEnabled(storage, true)).enabled).toBe(true);
    expect((await setRemoteEnabled(storage, false)).enabled).toBe(false);
  });

  it('normalises the relay address and rejects invalid or insecure ones', async () => {
    const storage = memoryStorage();
    expect((await setRemoteAddress(storage, ' https://Relay.Example.com/ ')).address).toBe('https://relay.example.com');
    await expect(setRemoteAddress(storage, 'relay.example.com')).rejects.toThrow();
    await expect(setRemoteAddress(storage, 'http://relay.example.com')).rejects.toThrow();
    expect((await loadRemoteSettings(storage)).address).toBe('https://relay.example.com');
    expect((await setRemoteAddress(storage, 'http://localhost:8080')).address).toBe('http://localhost:8080');
    expect((await setRemoteAddress(storage, '')).address).toBe('');
  });

  it('stores a valid browser token and rejects weak ones', async () => {
    const storage = memoryStorage();
    expect((await setBrowserToken(storage, `  ${TOKEN}  `)).browserToken).toBe(TOKEN);
    await expect(setBrowserToken(storage, 'short')).rejects.toThrow();
    expect((storage.data[REMOTE_SETTINGS_KEY] as RemoteSettings).browserToken).toBe(TOKEN);
    expect((await setBrowserToken(storage, '')).browserToken).toBe('');
  });

  it('builds agent configuration that reads the agent token from the environment', () => {
    const config = remoteAgentConfig('https://relay.example.com/mcp', 'agent-browser-bridge-remote');
    expect(config.claudeCode).toBe(
      'claude mcp add --transport http agent-browser-bridge-remote https://relay.example.com/mcp --header "Authorization: Bearer $AGENT_BROWSER_BRIDGE_AGENT_TOKEN"',
    );
    expect(JSON.parse(config.json)).toEqual({
      mcpServers: {
        'agent-browser-bridge-remote': {
          type: 'http',
          url: 'https://relay.example.com/mcp',
          headers: { Authorization: 'Bearer ${AGENT_BROWSER_BRIDGE_AGENT_TOKEN}' },
        },
      },
    });
  });
});

function scriptedRelay(answer: (auth: { nonce: string; proof: string }, relayNonce: string) => Promise<unknown>, challenge?: unknown) {
  const relayNonce = newRemoteNonce();
  const sent: unknown[] = [];
  let step = 0;
  const io: HandshakeIO = {
    next: async () => {
      step++;
      if (step === 1) return challenge ?? { type: 'remoteChallenge', nonce: relayNonce };
      return answer(sent[0] as { nonce: string; proof: string }, relayNonce);
    },
    send: (message) => void sent.push(message),
  };
  return { io, sent, relayNonce };
}

describe('relayHandshake', () => {
  const host = 'relay.example.com';

  it('proves the token without sending it and accepts a relay that proves it back', async () => {
    const relay = scriptedRelay(async (auth, relayNonce) => ({
      type: 'remoteWelcome',
      proof: await remoteProof(TOKEN, { role: 'relay', relayHost: host, relayNonce, browserNonce: auth.nonce }),
    }));
    await relayHandshake(TOKEN, host)(relay.io);
    const auth = relay.sent[0] as { type: string; nonce: string; proof: string };
    expect(auth.type).toBe('remoteAuth');
    expect(auth.proof).toBe(await remoteProof(TOKEN, { role: 'browser', relayHost: host, relayNonce: relay.relayNonce, browserNonce: auth.nonce }));
    expect(JSON.stringify(relay.sent)).not.toContain(TOKEN);
  });

  it('refuses a relay that cannot prove the token', async () => {
    const wrong = scriptedRelay(async (auth, relayNonce) => ({
      type: 'remoteWelcome',
      proof: await remoteProof(newRemoteToken(), { role: 'relay', relayHost: host, relayNonce, browserNonce: auth.nonce }),
    }));
    await expect(relayHandshake(TOKEN, host)(wrong.io)).rejects.toBeInstanceOf(UntrustedRelayError);
  });

  it('refuses a relay that replays our own proof or proves it for another host', async () => {
    const replay = scriptedRelay(async (auth) => ({ type: 'remoteWelcome', proof: auth.proof }));
    await expect(relayHandshake(TOKEN, host)(replay.io)).rejects.toBeInstanceOf(UntrustedRelayError);
    const elsewhere = scriptedRelay(async (auth, relayNonce) => ({
      type: 'remoteWelcome',
      proof: await remoteProof(TOKEN, { role: 'relay', relayHost: 'relay.example.net', relayNonce, browserNonce: auth.nonce }),
    }));
    await expect(relayHandshake(TOKEN, host)(elsewhere.io)).rejects.toBeInstanceOf(UntrustedRelayError);
  });

  it('refuses a missing challenge or one that reuses our nonce', async () => {
    const missing = scriptedRelay(async () => null, { type: 'hello' });
    await expect(relayHandshake(TOKEN, host)(missing.io)).rejects.toBeInstanceOf(UntrustedRelayError);
    const nonce = newRemoteNonce();
    const echo = scriptedRelay(async () => null, { type: 'remoteChallenge', nonce });
    await expect(relayHandshake(TOKEN, host, () => nonce)(echo.io)).rejects.toBeInstanceOf(UntrustedRelayError);
    expect(echo.sent).toEqual([]);
  });
});

function fakeFactory() {
  const created: Array<{ url: string; handshake: (io: HandshakeIO) => Promise<void>; client: ReturnType<ClientFactory>; onStatus: (status: ConnectionStatus) => void }> = [];
  const factory: ClientFactory = (url, _dispatch, onStatus, handshake) => {
    const client = {
      connect: vi.fn(),
      close: vi.fn(),
      reintroduce: vi.fn(),
      whenIdle: vi.fn(async () => {}),
      announceReload: vi.fn(async () => {}),
      status: { state: 'connecting', url, since: 0, agents: [] } as ConnectionStatus,
    };
    created.push({ url, handshake, client, onStatus });
    return client;
  };
  return { factory, created };
}

const enabledSettings = (overrides: Partial<RemoteSettings> = {}): RemoteSettings => ({
  enabled: true,
  address: 'https://relay.example.com',
  browserToken: TOKEN,
  ...overrides,
});

describe('RemoteConnection', () => {
  it('connects to the relay once enabled with an address and token', () => {
    const { factory, created } = fakeFactory();
    const connection = new RemoteConnection(async () => null, () => {}, factory);
    connection.apply(enabledSettings());
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe('wss://relay.example.com/extension');
    expect(created[0]!.client.connect).toHaveBeenCalled();
  });

  it('stays off while disabled, without a valid address or without a valid token', () => {
    const { factory, created } = fakeFactory();
    const connection = new RemoteConnection(async () => null, () => {}, factory);
    connection.apply(enabledSettings({ enabled: false }));
    connection.apply(enabledSettings({ address: '' }));
    connection.apply(enabledSettings({ address: 'http://relay.example.com' }));
    connection.apply(enabledSettings({ browserToken: 'short' }));
    expect(created).toHaveLength(0);
    expect(connection.status).toBeUndefined();
  });

  it('keeps the connection when nothing relevant changes', () => {
    const { factory, created } = fakeFactory();
    const connection = new RemoteConnection(async () => null, () => {}, factory);
    connection.apply(enabledSettings());
    connection.apply(enabledSettings());
    expect(created).toHaveLength(1);
  });

  it('reconnects when the address or token changes and disconnects when switched off', () => {
    const { factory, created } = fakeFactory();
    const statuses: unknown[] = [];
    const connection = new RemoteConnection(async () => null, (status) => statuses.push(status), factory);
    connection.apply(enabledSettings());
    connection.apply(enabledSettings({ address: 'https://other.example.com' }));
    connection.apply(enabledSettings({ address: 'https://other.example.com', browserToken: newRemoteToken() }));
    expect(created).toHaveLength(3);
    expect(created[0]!.client.close).toHaveBeenCalled();
    expect(created[1]!.client.close).toHaveBeenCalled();
    connection.apply(enabledSettings({ enabled: false }));
    expect(created[2]!.client.close).toHaveBeenCalled();
    expect(statuses.at(-1)).toBeUndefined();
  });

  it('passes status changes and update hooks through', async () => {
    const { factory, created } = fakeFactory();
    const statuses: Array<ConnectionStatus | undefined> = [];
    const connection = new RemoteConnection(async () => null, (status) => statuses.push(status), factory);
    await connection.whenIdle();
    await connection.announceReload();
    connection.apply(enabledSettings());
    created[0]!.onStatus({ state: 'connected', url: 'x', since: 1, agents: [] });
    expect(statuses.at(-1)?.state).toBe('connected');
    await connection.whenIdle();
    await connection.announceReload();
    connection.connect();
    connection.reintroduce();
    expect(created[0]!.client.announceReload).toHaveBeenCalled();
    expect(created[0]!.client.reintroduce).toHaveBeenCalled();
  });
});
