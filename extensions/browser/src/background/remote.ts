import {
  AGENT_TOKEN_ENV,
  MAX_REMOTE_TOKEN_LENGTH,
  newRemoteNonce,
  remoteChallengeMessage,
  remoteProof,
  remoteTokenProblem,
  remoteUrls,
  remoteWelcomeMessage,
  sameProof,
  type AgentInfo,
} from '@agent-browser-bridge/protocol';
import { BridgeClient, UntrustedRelayError, type ConnectionStatus, type HandshakeIO } from './bridgeClient.ts';

export const REMOTE_SETTINGS_KEY = 'remoteAccess';

export interface RemoteSettings {
  enabled: boolean;
  address: string;
  browserToken: string;
}

export interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function readRemoteSettings(value: unknown, defaultAddress = ''): RemoteSettings {
  const stored = (value ?? {}) as Partial<RemoteSettings>;
  const token = typeof stored.browserToken === 'string' ? stored.browserToken : '';
  return {
    enabled: stored.enabled === true,
    address: typeof stored.address === 'string' ? stored.address : defaultAddress,
    browserToken: token.length <= MAX_REMOTE_TOKEN_LENGTH ? token : '',
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

export const isValidBrowserToken = (token: string) => remoteTokenProblem(token) === undefined;

export async function setRemoteEnabled(storage: Storage, enabled: boolean, defaultAddress = ''): Promise<RemoteSettings> {
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, enabled });
}

export async function setRemoteAddress(storage: Storage, address: string, defaultAddress = ''): Promise<RemoteSettings> {
  const trimmed = address.trim();
  if (trimmed && !isValidAddress(trimmed)) throw new Error('Invalid relay address');
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, address: trimmed && remoteUrls(trimmed).base });
}

export async function setBrowserToken(storage: Storage, token: string, defaultAddress = ''): Promise<RemoteSettings> {
  const trimmed = token.trim();
  if (trimmed && !isValidBrowserToken(trimmed)) throw new Error('Invalid browser token');
  const settings = await loadRemoteSettings(storage, defaultAddress);
  return save(storage, { ...settings, browserToken: trimmed });
}

export function remoteAgentConfig(mcpUrl: string, name: string) {
  const claudeCode = `claude mcp add --transport http ${name} ${mcpUrl} --header "Authorization: Bearer $${AGENT_TOKEN_ENV}"`;
  const bearer = `Bearer \${${AGENT_TOKEN_ENV}}`;
  const json = JSON.stringify({ mcpServers: { [name]: { type: 'http', url: mcpUrl, headers: { Authorization: bearer } } } }, null, 2);
  return { claudeCode, json };
}

export function relayHandshake(token: string, relayHost: string, nonce: () => string = newRemoteNonce) {
  return async (io: HandshakeIO) => {
    const challenge = remoteChallengeMessage.safeParse(await io.next());
    if (!challenge.success) throw new UntrustedRelayError('The relay did not send a challenge');
    const input = { relayHost, relayNonce: challenge.data.nonce, browserNonce: nonce() };
    if (input.browserNonce === input.relayNonce) throw new UntrustedRelayError('The relay repeated our nonce');
    io.send({ type: 'remoteAuth', nonce: input.browserNonce, proof: await remoteProof(token, { role: 'browser', ...input }) });
    const welcome = remoteWelcomeMessage.safeParse(await io.next());
    if (!welcome.success || !sameProof(welcome.data.proof, await remoteProof(token, { role: 'relay', ...input }))) {
      throw new UntrustedRelayError('The relay could not prove it knows the browser token');
    }
  };
}

type Dispatch = (method: string, params: unknown, agent: AgentInfo | null) => Promise<unknown>;

export type ClientFactory = (
  url: string,
  dispatch: Dispatch,
  onStatus: (status: ConnectionStatus) => void,
  handshake: (io: HandshakeIO) => Promise<void>,
) => Pick<BridgeClient, 'connect' | 'close' | 'status' | 'whenIdle' | 'announceReload' | 'reintroduce'>;

const defaultFactory: ClientFactory = (url, dispatch, onStatus, handshake) => new BridgeClient(url, dispatch, onStatus, { handshake });

const configOf = (settings: RemoteSettings) => {
  if (!settings.enabled || !isValidBrowserToken(settings.browserToken) || !isValidAddress(settings.address)) return undefined;
  return JSON.stringify([remoteUrls(settings.address).extension, settings.browserToken]);
};

export class RemoteConnection {
  private client?: ReturnType<ClientFactory>;
  private config?: string;

  constructor(
    private readonly dispatch: Dispatch,
    private readonly onStatus: (status: ConnectionStatus | undefined) => void,
    private readonly factory: ClientFactory = defaultFactory,
  ) {}

  get status(): ConnectionStatus | undefined {
    return this.client?.status;
  }

  apply(settings: RemoteSettings) {
    const config = configOf(settings);
    if (config === this.config) return;
    this.config = config;
    this.client?.close();
    this.client = undefined;
    if (config === undefined) {
      this.onStatus(undefined);
      return;
    }
    const urls = remoteUrls(settings.address);
    this.client = this.factory(urls.extension, this.dispatch, (status) => this.onStatus(status), relayHandshake(settings.browserToken, urls.host));
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
}
