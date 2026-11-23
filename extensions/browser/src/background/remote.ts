import {
  MAX_REMOTE_TOKENS,
  newRemoteKey,
  newRemoteToken,
  remoteKey,
  remoteSpaceId,
  remoteTokenHash,
  remoteUrls,
  type AgentInfo,
  type ExtensionToRemote,
} from '@agent-browser-bridge/protocol';
import { BridgeClient, type ConnectionStatus } from './bridgeClient.ts';

export const REMOTE_SETTINGS_KEY = 'remoteAccess';
export const MAX_TOKEN_NAME_LENGTH = 40;

export interface RemoteToken {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
}

export interface RemoteSettings {
  enabled: boolean;
  address: string;
  key: string;
  tokens: RemoteToken[];
}

export interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const isToken = (value: unknown): value is RemoteToken => {
  const token = value as Partial<RemoteToken> | null;
  return (
    typeof token?.id === 'string' &&
    typeof token.name === 'string' &&
    typeof token.hash === 'string' &&
    /^[0-9a-f]{64}$/.test(token.hash) &&
    typeof token.createdAt === 'number'
  );
};

export function readRemoteSettings(value: unknown, defaultAddress = ''): RemoteSettings {
  const stored = (value ?? {}) as Partial<RemoteSettings>;
  return {
    enabled: stored.enabled === true,
    address: typeof stored.address === 'string' ? stored.address : defaultAddress,
    key: typeof stored.key === 'string' && remoteKey.safeParse(stored.key).success ? stored.key : '',
    tokens: Array.isArray(stored.tokens) ? stored.tokens.filter(isToken).slice(0, MAX_REMOTE_TOKENS) : [],
  };
}

export async function loadRemoteSettings(storage: Storage, defaultAddress = ''): Promise<RemoteSettings> {
  const stored = await storage.get(REMOTE_SETTINGS_KEY);
  return readRemoteSettings(stored[REMOTE_SETTINGS_KEY], defaultAddress);
}

const save = async (storage: Storage, settings: RemoteSettings) => {
  await storage.set({ [REMOTE_SETTINGS_KEY]: settings });
  return settings;
};

export const isValidAddress = (address: string) => {
  try {
    remoteUrls(address);
    return true;
  } catch {
    return false;
  }
};

export async function setRemoteEnabled(storage: Storage, enabled: boolean, defaultAddress = ''): Promise<RemoteSettings> {
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, enabled, key: settings.key || newRemoteKey() });
}

export async function setRemoteAddress(storage: Storage, address: string, defaultAddress = ''): Promise<RemoteSettings> {
  const trimmed = address.trim();
  if (trimmed && !isValidAddress(trimmed)) throw new Error('Invalid relay address');
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, address: trimmed && remoteUrls(trimmed).base });
}

export interface CreatedToken {
  token: string;
  settings: RemoteSettings;
}

export async function createRemoteToken(storage: Storage, name: string, now = Date.now(), defaultAddress = ''): Promise<CreatedToken> {
  const settings = await loadRemoteSettings(storage, defaultAddress);
  if (settings.tokens.length >= MAX_REMOTE_TOKENS) throw new Error('Too many tokens');
  const key = settings.key || newRemoteKey();
  const token = newRemoteToken(await remoteSpaceId(key));
  const entry: RemoteToken = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, MAX_TOKEN_NAME_LENGTH),
    hash: await remoteTokenHash(token),
    createdAt: now,
  };
  return { token, settings: await save(storage, { ...settings, key, tokens: [...settings.tokens, entry] }) };
}

export async function revokeRemoteToken(storage: Storage, id: string, defaultAddress = ''): Promise<RemoteSettings> {
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, tokens: settings.tokens.filter((token) => token.id !== id) });
}

export function remoteAgentConfig(mcpUrl: string, token: string, name: string) {
  const claudeCode = `claude mcp add --transport http ${name} ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify({ mcpServers: { [name]: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  return { claudeCode, json };
}

type Dispatch = (method: string, params: unknown, agent: AgentInfo | null) => Promise<unknown>;

export type ClientFactory = (
  url: string,
  dispatch: Dispatch,
  onStatus: (status: ConnectionStatus) => void,
  authenticate: () => Promise<ExtensionToRemote>,
) => Pick<BridgeClient, 'connect' | 'close' | 'sendTokens' | 'status' | 'whenIdle' | 'announceReload' | 'reintroduce'>;

const defaultFactory: ClientFactory = (url, dispatch, onStatus, authenticate) => new BridgeClient(url, dispatch, onStatus, { authenticate });

const configOf = (settings: RemoteSettings) => {
  if (!settings.enabled || !settings.key || !isValidAddress(settings.address)) return undefined;
  return `${remoteUrls(settings.address).extension} ${settings.key}`;
};

export class RemoteConnection {
  private client?: ReturnType<ClientFactory>;
  private config?: string;
  private settings?: RemoteSettings;

  constructor(
    private readonly dispatch: Dispatch,
    private readonly onStatus: (status: ConnectionStatus | undefined) => void,
    private readonly factory: ClientFactory = defaultFactory,
  ) {}

  get status(): ConnectionStatus | undefined {
    return this.client?.status;
  }

  apply(settings: RemoteSettings) {
    this.settings = settings;
    const config = configOf(settings);
    if (config === this.config) {
      this.client?.sendTokens(this.tokenHashes());
      return;
    }
    this.config = config;
    this.client?.close();
    this.client = undefined;
    if (config === undefined) {
      this.onStatus(undefined);
      return;
    }
    const authenticate = async (): Promise<ExtensionToRemote> => ({ type: 'remoteAuth', key: settings.key, tokens: this.tokenHashes() });
    this.client = this.factory(remoteUrls(settings.address).extension, this.dispatch, (status) => this.onStatus(status), authenticate);
    this.client.connect();
  }

  connect() {
    this.client?.connect();
  }

  reintroduce() {
    this.client?.reintroduce();
  }

  whenIdle(): Promise<void> {
    return this.client?.whenIdle() ?? Promise.resolve();
  }

  announceReload(): Promise<void> {
    return this.client?.announceReload() ?? Promise.resolve();
  }

  private tokenHashes() {
    return (this.settings?.tokens ?? []).map((token) => token.hash);
  }
}
