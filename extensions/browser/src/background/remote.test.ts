import { describe, expect, it, vi } from 'vitest';
import { remoteSpaceId, remoteTokenHash, spaceOfToken, type ExtensionToRemote } from '@agent-browser-bridge/protocol';
import type { ConnectionStatus } from './bridgeClient.ts';
import {
  createRemoteToken,
  loadRemoteSettings,
  readRemoteSettings,
  remoteAgentConfig,
  RemoteConnection,
  REMOTE_SETTINGS_KEY,
  revokeRemoteToken,
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

const HASH = 'a'.repeat(64);

describe('remote settings', () => {
  it('starts switched off with the default address', async () => {
    expect(await loadRemoteSettings(memoryStorage(), 'https://relay.example.com')).toEqual({
      enabled: false,
      address: 'https://relay.example.com',
      key: '',
      tokens: [],
    });
  });

  it('drops malformed stored values', () => {
    const settings = readRemoteSettings({
      enabled: 'yes',
      address: 42,
      key: 'too-short',
      tokens: [{ id: '1', name: 'ok', hash: HASH, createdAt: 1 }, { id: '2', name: 'bad', hash: 'nope', createdAt: 1 }, null],
    });
    expect(settings).toEqual({ enabled: false, address: '', key: '', tokens: [{ id: '1', name: 'ok', hash: HASH, createdAt: 1 }] });
  });

  it('creates a key the first time remote access is switched on and keeps it after', async () => {
    const storage = memoryStorage();
    const first = await setRemoteEnabled(storage, true);
    expect(first.enabled).toBe(true);
    expect(first.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const off = await setRemoteEnabled(storage, false);
    expect(off).toMatchObject({ enabled: false, key: first.key });
    expect((await setRemoteEnabled(storage, true)).key).toBe(first.key);
  });

  it('normalises the relay address and rejects invalid ones', async () => {
    const storage = memoryStorage();
    expect((await setRemoteAddress(storage, ' https://relay.example.com/ ')).address).toBe('https://relay.example.com');
    await expect(setRemoteAddress(storage, 'relay.example.com')).rejects.toThrow();
    expect((await loadRemoteSettings(storage)).address).toBe('https://relay.example.com');
    expect((await setRemoteAddress(storage, '')).address).toBe('');
  });

  it('creates tokens for its own space and stores only their hash', async () => {
    const storage = memoryStorage();
    const enabled = await setRemoteEnabled(storage, true);
    const { token, settings } = await createRemoteToken(storage, '  Cloud agent  ', 1_000);
    expect(spaceOfToken(token)).toBe(await remoteSpaceId(enabled.key));
    expect(settings.tokens).toEqual([{ id: expect.any(String), name: 'Cloud agent', hash: await remoteTokenHash(token), createdAt: 1_000 }]);
    expect(JSON.stringify(storage.data)).not.toContain(token);
  });

  it('revokes a token by id', async () => {
    const storage = memoryStorage();
    const first = await createRemoteToken(storage, 'one');
    await createRemoteToken(storage, 'two');
    const settings = await revokeRemoteToken(storage, first.settings.tokens[0]!.id);
    expect(settings.tokens.map((token) => token.name)).toEqual(['two']);
    expect((storage.data[REMOTE_SETTINGS_KEY] as RemoteSettings).tokens).toHaveLength(1);
  });

  it('builds agent configuration for the token', () => {
    const config = remoteAgentConfig('https://relay.example.com/mcp', 'abb_x', 'agent-browser-bridge-remote');
    expect(config.claudeCode).toBe(
      'claude mcp add --transport http agent-browser-bridge-remote https://relay.example.com/mcp --header "Authorization: Bearer abb_x"',
    );
    expect(JSON.parse(config.json)).toEqual({
      mcpServers: { 'agent-browser-bridge-remote': { type: 'http', url: 'https://relay.example.com/mcp', headers: { Authorization: 'Bearer abb_x' } } },
    });
  });
});

function fakeFactory() {
  const created: Array<{ url: string; authenticate: () => Promise<ExtensionToRemote>; client: ReturnType<ClientFactory>; onStatus: (status: ConnectionStatus) => void }> = [];
  const factory: ClientFactory = (url, _dispatch, onStatus, authenticate) => {
    const client = {
      connect: vi.fn(),
      close: vi.fn(),
      sendTokens: vi.fn(),
      reintroduce: vi.fn(),
      whenIdle: vi.fn(async () => {}),
      announceReload: vi.fn(async () => {}),
      status: { state: 'connecting', url, since: 0, agents: [] } as ConnectionStatus,
    };
    created.push({ url, authenticate, client, onStatus });
    return client;
  };
  return { factory, created };
}

const enabledSettings = (overrides: Partial<RemoteSettings> = {}): RemoteSettings => ({
  enabled: true,
  address: 'https://relay.example.com',
  key: 'k'.repeat(43),
  tokens: [{ id: '1', name: 'one', hash: HASH, createdAt: 0 }],
  ...overrides,
});

describe('RemoteConnection', () => {
  it('connects to the relay with the key and token hashes once enabled', async () => {
    const { factory, created } = fakeFactory();
    const connection = new RemoteConnection(async () => null, () => {}, factory);
    connection.apply(enabledSettings());
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe('wss://relay.example.com/extension');
    expect(created[0]!.client.connect).toHaveBeenCalled();
    expect(await created[0]!.authenticate()).toEqual({ type: 'remoteAuth', key: 'k'.repeat(43), tokens: [HASH] });
  });

  it('stays off without a valid address or while disabled', () => {
    const { factory, created } = fakeFactory();
    const statuses: unknown[] = [];
    const connection = new RemoteConnection(async () => null, (status) => statuses.push(status), factory);
    connection.apply(enabledSettings({ enabled: false }));
    connection.apply(enabledSettings({ address: '' }));
    expect(created).toHaveLength(0);
    expect(connection.status).toBeUndefined();
  });

  it('sends token changes over the open connection instead of reconnecting', () => {
    const { factory, created } = fakeFactory();
    const connection = new RemoteConnection(async () => null, () => {}, factory);
    connection.apply(enabledSettings());
    connection.apply(enabledSettings({ tokens: [] }));
    expect(created).toHaveLength(1);
    expect(created[0]!.client.sendTokens).toHaveBeenCalledWith([]);
  });

  it('reconnects when the address changes and disconnects when switched off', () => {
    const { factory, created } = fakeFactory();
    const statuses: unknown[] = [];
    const connection = new RemoteConnection(async () => null, (status) => statuses.push(status), factory);
    connection.apply(enabledSettings());
    connection.apply(enabledSettings({ address: 'https://other.example.com' }));
    expect(created).toHaveLength(2);
    expect(created[0]!.client.close).toHaveBeenCalled();
    connection.apply(enabledSettings({ enabled: false }));
    expect(created[1]!.client.close).toHaveBeenCalled();
    expect(statuses.at(-1)).toBeUndefined();
    expect(connection.status).toBeUndefined();
  });

  it('passes status changes and update hooks through', async () => {
    const { factory, created } = fakeFactory();
    const statuses: Array<ConnectionStatus | undefined> = [];
    const connection = new RemoteConnection(async () => null, (status) => statuses.push(status), factory);
    await connection.whenIdle();
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
