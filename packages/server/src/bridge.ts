import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
  extensionToServer,
  hostToRelay,
  PROTOCOL_VERSION,
  relayToHost,
  type HelloMessage,
  type HostToRelay,
  type ResponseMessage,
  type ServerToExtension,
} from '@agent-browser-bridge/protocol';

export interface BridgeOptions {
  port: number;
  host?: string;
  /** If set, only this extension id may connect; otherwise any chrome-extension:// origin is accepted. */
  extensionId?: string;
  requestTimeoutMs?: number;
  log?: (msg: string) => void;
}

export type BridgeRole = 'host' | 'relay';

export type BridgeStatus =
  | { state: 'listening'; role: BridgeRole; port: number; extension: null }
  | { state: 'connected'; role: BridgeRole; port: number; extension: HelloMessage }
  | { state: 'error'; port: number; error: string };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  socket: WebSocket;
}

export class NotConnectedError extends Error {}

export const RELAY_PATH = '/relay';

const ESTABLISH_ATTEMPTS = 5;
const RETRY_MS = 2_000;
const NOT_CONNECTED =
  'The Agent Browser Bridge browser extension is not connected. Make sure Chrome is open with the extension installed and enabled; it reconnects automatically within ~30 seconds.';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ExtensionBridge {
  private role?: BridgeRole;
  private boundPort?: number;
  private error?: string;
  private stopped = false;
  private retryTimer?: NodeJS.Timeout;

  private wss?: WebSocketServer;
  private extension?: WebSocket;
  private hello?: HelloMessage;
  private relays = new Set<WebSocket>();

  private upstream?: WebSocket;
  private upstreamExtension: HelloMessage | null = null;

  private pending = new Map<string, Pending>();
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BridgeOptions) {
    this.log = opts.log ?? (() => {});
  }

  async start(): Promise<number> {
    try {
      return await this.establish();
    } catch (err) {
      this.error = errorMessage(err);
      this.scheduleEstablish(RETRY_MS);
      throw new Error(this.error);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.failPending(new NotConnectedError('Bridge stopped'));
    this.upstream?.terminate();
    for (const client of this.wss?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  status(): BridgeStatus {
    const port = this.boundPort ?? this.opts.port;
    const extension = this.role === 'host' ? (this.extension && this.hello) || null : this.upstreamExtension;
    if (!this.role) return { state: 'error', port, error: this.error ?? 'Starting up' };
    if (extension) return { state: 'connected', role: this.role, port, extension };
    return { state: 'listening', role: this.role, port, extension: null };
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.role === 'relay' && this.upstream) return this.send(this.upstream, method, params);
    if (this.role === 'host' && this.extension && this.hello) return this.send(this.extension, method, params);
    return Promise.reject(new NotConnectedError(this.error ?? NOT_CONNECTED));
  }

  private get timeoutMs() {
    return this.opts.requestTimeoutMs ?? 30_000;
  }

  private get hostname() {
    return this.opts.host ?? '127.0.0.1';
  }

  private send(socket: WebSocket, method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    const message: ServerToExtension = { type: 'request', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser did not answer ${method} within ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, socket });
      socket.send(JSON.stringify(message));
    });
  }

  private settle(msg: ResponseMessage) {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error));
  }

  private failPending(err: Error, socket?: WebSocket) {
    for (const [id, p] of this.pending) {
      if (socket && p.socket !== socket) continue;
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private async establish(): Promise<number> {
    let lastError: unknown;
    for (let attempt = 0; attempt < ESTABLISH_ATTEMPTS && !this.stopped; attempt++) {
      try {
        return await this.listen();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      }
      try {
        await this.connectUpstream();
        return this.opts.port;
      } catch (err) {
        lastError = err;
      }
      await delay(50 + Math.random() * 200);
    }
    if (this.stopped) throw new NotConnectedError('Bridge stopped');
    throw new Error(
      `Port ${this.opts.port} is already in use by a program that is not a compatible agent-browser-bridge server (${errorMessage(lastError)}). If it is an older agent-browser-bridge version, update it or close that agent session.`,
    );
  }

  private scheduleEstablish(ms: number) {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.establish().catch((err) => {
        this.error = errorMessage(err);
        this.scheduleEstablish(RETRY_MS);
      });
    }, ms);
  }

  private listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.hostname,
        port: this.opts.port,
        verifyClient: ({ req }: { req: IncomingMessage }) => this.isAllowedClient(req),
      });
      wss.once('error', (err) => {
        wss.close();
        reject(err);
      });
      wss.once('listening', () => {
        const addr = wss.address();
        this.wss = wss;
        this.role = 'host';
        this.error = undefined;
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        this.log(`Hosting the bridge on ws://${this.hostname}:${this.boundPort}`);
        resolve(this.boundPort);
      });
      wss.on('connection', (socket, req) => {
        if (req.url === RELAY_PATH) this.attachRelay(socket);
        else this.attachExtension(socket);
      });
    });
  }

  private isAllowedClient(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (req.url === RELAY_PATH) return origin === undefined;
    if (!origin) return false;
    if (this.opts.extensionId) return origin === `chrome-extension://${this.opts.extensionId}`;
    return origin.startsWith('chrome-extension://');
  }

  private connectUpstream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.hostname}:${this.opts.port}${RELAY_PATH}`);
      let opened = false;
      ws.on('error', (err) => {
        if (!opened) reject(err);
      });
      ws.once('open', () => {
        opened = true;
        this.upstream = ws;
        this.upstreamExtension = null;
        this.role = 'relay';
        this.error = undefined;
        this.boundPort = this.opts.port;
        this.log(`Another agent session hosts the bridge; relaying through it on port ${this.opts.port}`);
        resolve();
      });
      ws.on('message', (raw) => {
        const msg = this.parse(raw, hostToRelay);
        if (!msg) return;
        this.handleHostMessage(msg);
      });
      ws.on('close', () => {
        if (this.upstream !== ws) return;
        this.upstream = undefined;
        this.upstreamExtension = null;
        this.role = undefined;
        this.error = 'The agent session hosting the bridge exited; taking over.';
        this.failPending(new NotConnectedError('The agent session hosting the bridge exited; please retry.'), ws);
        this.log('Bridge host went away; re-establishing');
        this.scheduleEstablish(Math.random() * 300);
      });
    });
  }

  private handleHostMessage(msg: HostToRelay) {
    if (msg.type === 'status') this.upstreamExtension = msg.extension;
    else this.settle(msg);
  }

  private parse<T>(raw: WebSocket.RawData, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): T | undefined {
    try {
      const parsed = schema.safeParse(JSON.parse(raw.toString()));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private attachRelay(socket: WebSocket) {
    this.relays.add(socket);
    this.log(`Agent session joined (${this.relays.size} relayed)`);
    this.sendStatus(socket);
    socket.on('message', (raw) => {
      const msg = this.parse(raw, relayToHost);
      if (!msg) return;
      this.request(msg.method, msg.params).then(
        (result) => this.reply(socket, { type: 'response', id: msg.id, ok: true, result }),
        (err) => this.reply(socket, { type: 'response', id: msg.id, ok: false, error: errorMessage(err) }),
      );
    });
    socket.on('close', () => {
      this.relays.delete(socket);
      this.log(`Agent session left (${this.relays.size} relayed)`);
    });
  }

  private reply(socket: WebSocket, msg: HostToRelay) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  private sendStatus(socket: WebSocket) {
    this.reply(socket, { type: 'status', extension: (this.extension && this.hello) || null });
  }

  private broadcastStatus() {
    for (const relay of this.relays) this.sendStatus(relay);
  }

  private attachExtension(socket: WebSocket) {
    if (this.extension && this.extension !== socket) {
      const previous = this.extension;
      previous.close(4000, 'Replaced by a newer connection');
      this.failPending(new NotConnectedError('Extension reconnected; please retry.'), previous);
    }
    this.extension = socket;
    this.hello = undefined;
    this.broadcastStatus();

    socket.on('message', (raw) => {
      const msg = this.parse(raw, extensionToServer);
      if (!msg) return;
      switch (msg.type) {
        case 'hello':
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            this.log(`Extension speaks protocol v${msg.protocolVersion}, server expects v${PROTOCOL_VERSION}; update whichever is older.`);
            socket.close(4001, 'Protocol version mismatch');
            return;
          }
          this.hello = msg;
          this.log(`Extension ${msg.extensionVersion} connected`);
          this.broadcastStatus();
          return;
        case 'ping':
          socket.send(JSON.stringify({ type: 'pong' } satisfies ServerToExtension));
          return;
        case 'response':
          this.settle(msg);
      }
    });

    socket.on('close', () => {
      if (this.extension !== socket) return;
      this.extension = undefined;
      this.hello = undefined;
      this.failPending(new NotConnectedError('The browser extension disconnected.'), socket);
      this.broadcastStatus();
      this.log('Extension disconnected');
    });
  }
}
