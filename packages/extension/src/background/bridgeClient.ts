import { PROTOCOL_VERSION, serverToExtension, type ExtensionToServer } from '@agent-browser-bridge/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionStatus {
  state: ConnectionState;
  url: string;
  since: number;
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
  private _status: ConnectionStatus;

  constructor(
    private readonly url: string,
    private readonly dispatch: (method: string, params: unknown) => Promise<unknown>,
    private readonly onStatus: (status: ConnectionStatus) => void = () => {},
  ) {
    this._status = { state: 'disconnected', url, since: Date.now() };
  }

  get status() {
    return this._status;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.retry);
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        extensionVersion: chrome.runtime.getManifest().version,
        userAgent: navigator.userAgent,
      });
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

  private async handle(raw: unknown) {
    let msg;
    try {
      msg = serverToExtension.parse(JSON.parse(String(raw)));
    } catch {
      return;
    }
    if (msg.type !== 'request') return;
    try {
      const result = await this.dispatch(msg.method, msg.params);
      this.send({ type: 'response', id: msg.id, ok: true, result: result ?? null });
    } catch (err) {
      this.send({ type: 'response', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private send(msg: ExtensionToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setState(state: ConnectionState) {
    if (this._status.state === state) return;
    this._status = { state, url: this.url, since: Date.now() };
    this.onStatus(this._status);
  }
}
