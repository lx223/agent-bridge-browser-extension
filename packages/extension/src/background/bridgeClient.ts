import { PROTOCOL_VERSION, serverToExtension, type AgentInfo, type ExtensionToServer } from '@agent-browser-bridge/protocol';
import { browserLabel, detectBrowser, instanceId } from './browser.ts';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionStatus {
  state: ConnectionState;
  url: string;
  since: number;
  agents: AgentInfo[];
}

const KEEPALIVE_MS = 20_000; // < 30s idle limit for MV3 service workers
const MAX_BACKOFF_MS = 10_000;

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
  private _status: ConnectionStatus;

  constructor(
    private readonly url: string,
    private readonly dispatch: (method: string, params: unknown, agent: AgentInfo | null) => Promise<unknown>,
    private readonly onStatus: (status: ConnectionStatus) => void = () => {},
  ) {
    this._status = { state: 'disconnected', url, since: Date.now(), agents: [] };
  }

  get status() {
    return this._status;
  }

  whenIdle(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.retry);
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      void this.sendHello();
      this.keepalive = setInterval(() => this.send({ type: 'ping' }), KEEPALIVE_MS);
      this.setState('connected');
    };

    ws.onmessage = (event) => void this.handle(event.data);

    ws.onclose = () => {
      clearInterval(this.keepalive);
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.setState('disconnected');
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  private async sendHello() {
    const extensionUrl = chrome.runtime.getURL('');
    this.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      browser: detectBrowser(extensionUrl),
      instanceId: await instanceId(chrome.storage.local).catch(() => undefined),
      label: browserLabel(extensionUrl, navigator.userAgent, 'brave' in navigator),
    });
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
      this.onStatus(this._status);
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

  private send(msg: ExtensionToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: ConnectionState) {
    if (this._status.state === state) return;
    this._status = { state, url: this.url, since: Date.now(), agents: [] };
    this.onStatus(this._status);
  }
}
