import {
  PROTOCOL_VERSION,
  REPLACED_CLOSE_CODE,
  serverToExtension,
  type AgentInfo,
  type AgentSession,
  type ExtensionToRemote,
  type ExtensionToServer,
} from '@agent-browser-bridge/protocol';
import { browserLabel, detectBrowser, instanceId, instanceName, newInstanceId, storeInstanceId } from './browser.ts';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionStatus {
  state: ConnectionState;
  url: string;
  since: number;
  agents: AgentSession[];
  instanceId?: string;
}

const KEEPALIVE_MS = 20_000; // < 30s idle limit for MV3 service workers
const MAX_BACKOFF_MS = 10_000;
const RELOAD_ANNOUNCE_WAIT_MS = 500;

export interface BridgeClientOptions {
  authenticate?: () => Promise<ExtensionToRemote>;
}

/**
 * Keeps a WebSocket open to the local MCP server. The server only exists while
 * an agent session is running, so failures are normal and retried quietly.
 */
export class BridgeClient {
  private ws?: WebSocket;
  private keepalive?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private backoff = 1000;
  private inFlight = 0;
  private idleWaiters: (() => void)[] = [];
  private instance?: string;
  private closed = false;
  private _status: ConnectionStatus;

  constructor(
    private readonly url: string,
    private readonly dispatch: (method: string, params: unknown, agent: AgentInfo | null) => Promise<unknown>,
    private readonly onStatus: (status: ConnectionStatus) => void = () => {},
    private readonly options: BridgeClientOptions = {},
  ) {
    this._status = { state: 'disconnected', url, since: Date.now(), agents: [] };
  }

  get status(): ConnectionStatus {
    return this.instance === undefined ? this._status : { ...this._status, instanceId: this.instance };
  }

  whenIdle(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async announceReload(): Promise<void> {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'reloading' });
    const deadline = Date.now() + RELOAD_ANNOUNCE_WAIT_MS;
    while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  connect() {
    if (this.closed) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.retry);
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      void this.introduce();
      this.keepalive = setInterval(() => this.send({ type: 'ping' }), KEEPALIVE_MS);
      this.setState('connected');
    };

    ws.onmessage = (event) => void this.handle(event.data);

    ws.onclose = (event) => {
      clearInterval(this.keepalive);
      if (this.ws !== ws) return;
      if (event.code === REPLACED_CLOSE_CODE) this.takeNewInstanceId();
      this.ws = undefined;
      this.setState('disconnected');
      if (this.closed) return;
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  reintroduce() {
    if (this.ws?.readyState === WebSocket.OPEN) void this.sendHello();
  }

  sendTokens(tokens: string[]) {
    this.send({ type: 'remoteTokens', tokens });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.keepalive);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.setState('disconnected');
  }

  private async introduce() {
    if (this.options.authenticate) {
      try {
        this.send(await this.options.authenticate());
      } catch {
        this.ws?.close();
        return;
      }
    }
    await this.sendHello();
  }

  private async sendHello() {
    const extensionUrl = chrome.runtime.getURL('');
    this.instance ??= await instanceId(chrome.storage.local).catch(() => newInstanceId());
    this.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      browser: detectBrowser(extensionUrl),
      instanceId: this.instance,
      label: browserLabel(extensionUrl, navigator.userAgent, 'brave' in navigator),
      name: await instanceName(chrome.storage.local).catch(() => undefined),
    });
  }

  private takeNewInstanceId() {
    this.instance = newInstanceId();
    void storeInstanceId(chrome.storage.local, this.instance).catch(() => undefined);
  }

  private async handle(raw: unknown) {
    let msg;
    try {
      msg = serverToExtension.parse(JSON.parse(String(raw)));
    } catch {
      return;
    }
    if (msg.type === 'agents') {
      this._status = { ...this._status, agents: msg.agents };
      this.onStatus(this.status);
      return;
    }
    if (msg.type !== 'request') return;
    this.inFlight++;
    try {
      const result = await this.dispatch(msg.method, msg.params, msg.agent ?? null);
      this.send({ type: 'response', id: msg.id, ok: true, result: result ?? null });
    } catch (err) {
      this.send({ type: 'response', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.inFlight--;
      if (this.inFlight === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  private send(msg: ExtensionToServer | ExtensionToRemote) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: ConnectionState) {
    if (this._status.state === state) return;
    this._status = { state, url: this.url, since: Date.now(), agents: [] };
    this.onStatus(this.status);
  }
}
