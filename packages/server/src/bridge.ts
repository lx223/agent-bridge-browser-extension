import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { extensionToServer, PROTOCOL_VERSION, type AgentInfo, type HelloMessage, type ServerToExtension } from '@agent-browser-bridge/protocol';

export interface BridgeOptions {
  port: number;
  host?: string;
  /** If set, only this extension id may connect; otherwise any chrome-extension:// origin is accepted. */
  extensionId?: string;
  requestTimeoutMs?: number;
  log?: (msg: string) => void;
  agentInfo?: () => AgentInfo;
}

export type BridgeStatus =
  | { state: 'listening'; port: number; extension: null }
  | { state: 'connected'; port: number; extension: HelloMessage }
  | { state: 'error'; port: number; error: string };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class NotConnectedError extends Error {}

/** Accepts the extension's WebSocket on localhost and forwards requests to it. */
export class ExtensionBridge {
  private wss?: WebSocketServer;
  private socket?: WebSocket;
  private hello?: HelloMessage;
  private startError?: string;
  private pending = new Map<string, Pending>();
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BridgeOptions) {
    this.log = opts.log ?? (() => {});
  }

  /** Resolves with the bound port once listening; rejects if the port is taken. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? '127.0.0.1',
        port: this.opts.port,
        verifyClient: ({ req }: { req: IncomingMessage }) => this.isAllowedOrigin(req.headers.origin),
      });
      this.wss = wss;
      wss.once('listening', () => {
        const addr = wss.address();
        resolve(typeof addr === 'object' && addr ? addr.port : this.opts.port);
      });
      wss.once('error', (err: NodeJS.ErrnoException) => {
        this.startError =
          err.code === 'EADDRINUSE'
            ? `Port ${this.opts.port} is already in use, probably by another agent-browser-bridge server (another agent session). Only one agent session can drive the browser at a time; close the other one.`
            : err.message;
        reject(new Error(this.startError));
      });
      wss.on('connection', (socket) => this.attach(socket));
    });
  }

  async stop(): Promise<void> {
    this.failAll(new NotConnectedError('Bridge stopped'));
    for (const client of this.wss?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  status(): BridgeStatus {
    if (this.startError) return { state: 'error', port: this.opts.port, error: this.startError };
    if (this.socket && this.hello) return { state: 'connected', port: this.opts.port, extension: this.hello };
    return { state: 'listening', port: this.opts.port, extension: null };
  }

  request(method: string, params: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || !this.hello) {
      return Promise.reject(
        new NotConnectedError(
          this.startError ??
            'The Agent Browser Bridge browser extension is not connected. Make sure Chrome is open with the extension installed and enabled; it reconnects automatically within ~30 seconds.',
        ),
      );
    }
    const id = randomUUID();
    const message: ServerToExtension = { type: 'request', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser did not answer ${method} within ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(message));
    });
  }

  announceAgent() {
    if (!this.socket || !this.hello || !this.opts.agentInfo) return;
    this.socket.send(JSON.stringify({ type: 'welcome', ...this.opts.agentInfo() } satisfies ServerToExtension));
  }

  private get timeoutMs() {
    return this.opts.requestTimeoutMs ?? 30_000;
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (this.opts.extensionId) return origin === `chrome-extension://${this.opts.extensionId}`;
    return origin.startsWith('chrome-extension://');
  }

  private attach(socket: WebSocket) {
    // Latest connection wins (e.g. extension reloaded while the old socket lingers).
    if (this.socket && this.socket !== socket) {
      this.socket.close(4000, 'Replaced by a newer connection');
      this.failAll(new NotConnectedError('Extension reconnected; please retry.'));
    }
    this.socket = socket;
    this.hello = undefined;

    socket.on('message', (raw) => {
      let parsed;
      try {
        parsed = extensionToServer.safeParse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const msg = parsed.data;
      switch (msg.type) {
        case 'hello':
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            this.log(`Extension speaks protocol v${msg.protocolVersion}, server expects v${PROTOCOL_VERSION}; update whichever is older.`);
            socket.close(4001, 'Protocol version mismatch');
            return;
          }
          this.hello = msg;
          this.log(`Extension ${msg.extensionVersion} connected`);
          this.announceAgent();
          return;
        case 'ping':
          socket.send(JSON.stringify({ type: 'pong' } satisfies ServerToExtension));
          return;
        case 'response': {
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          this.pending.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.ok) pending.resolve(msg.result);
          else pending.reject(new Error(msg.error));
        }
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.hello = undefined;
      this.failAll(new NotConnectedError('The browser extension disconnected.'));
      this.log('Extension disconnected');
    });
  }

  private failAll(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}
