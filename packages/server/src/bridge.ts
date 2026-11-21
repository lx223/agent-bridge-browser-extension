import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
  browserApis,
  browserToolName,
  extensionToServer,
  hostToRelay,
  NAME_INSTANCE_TOOL,
  PROTOCOL_VERSION,
  REPLACED_CLOSE_CODE,
  relayToHost,
  SET_INSTANCE_NAME_METHOD,
  toolDefinitions,
  type AgentActivity,
  type AgentInfo,
  type AgentInstanceUse,
  type AgentSession,
  type Browser,
  type HelloMessage,
  type HostToRelay,
  type Method,
  type RelayToHost,
  type ResponseMessage,
  type ServerToExtension,
} from '@agent-browser-bridge/protocol';
import { describeInstance, identifyHint } from './instances.ts';
import { missingToolMessage } from './outdated.ts';
import { isNewerVersion } from './version.ts';

export interface BridgeOptions {
  port: number;
  host?: string;
  extensionId?: string;
  version?: string;
  requestTimeoutMs?: number;
  handoverWaitMs?: number;
  log?: (msg: string) => void;
  agentInfo?: () => AgentInfo;
}

export type BridgeRole = 'host' | 'relay';

export type BridgeStatus =
  | { state: 'listening' | 'connected'; role: BridgeRole; port: number; browsers: HelloMessage[] }
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
const HANDOVER_WAIT_MS = 5_000;
const REJOIN_AFTER_HANDOVER_MS = 500;
const HANDOVER_CLOSE_CODE = 4002;
const ACTIVITY_BROADCAST_MS = 250;
const MAX_INSTANCES_PER_AGENT = 8;
const RESPONSE_MARGIN_MS = 5_000;
const notConnected = (browser: string) =>
  `The Agent Browser Bridge extension is not connected in ${browser}. Make sure ${browser} is open with the extension installed and enabled; it reconnects automatically within ~30 seconds.`;
const EXTENSION_SCHEMES = ['chrome-extension://', 'safari-web-extension://'];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toolLabel = (browser: string, method: string) => {
  if (method === SET_INSTANCE_NAME_METHOD) return NAME_INSTANCE_TOOL;
  if (method in toolDefinitions && browser in browserApis) return browserToolName(browser as Browser, method as Method);
  return method;
};
const sameInstance = (a: AgentInstanceUse, b: AgentInstanceUse) => a.browser === b.browser && a.instanceId === b.instanceId;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const browserWaitOf = (params: unknown) => {
  const timeoutMs = (params as { timeoutMs?: unknown } | null | undefined)?.timeoutMs;
  return typeof timeoutMs === 'number' ? timeoutMs : undefined;
};

export class ExtensionBridge {
  private role?: BridgeRole;
  private boundPort?: number;
  private error?: string;
  private stopped = false;
  private retryTimer?: NodeJS.Timeout;
  private handingOver = false;

  private wss?: WebSocketServer;
  private extensions = new Map<WebSocket, HelloMessage | undefined>();
  private relays = new Map<WebSocket, AgentInfo | undefined>();
  private activity = new Map<string, AgentActivity>();
  private broadcastTimer?: NodeJS.Timeout;

  private upstream?: WebSocket;
  private upstreamBrowsers: HelloMessage[] = [];

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
    clearTimeout(this.broadcastTimer);
    this.failPending(new NotConnectedError('Bridge stopped'));
    this.upstream?.terminate();
    for (const client of [...(this.wss?.clients ?? []), ...this.extensions.keys(), ...this.relays.keys()]) client.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  status(): BridgeStatus {
    const port = this.boundPort ?? this.opts.port;
    if (!this.role) return { state: 'error', port, error: this.error ?? 'Starting up' };
    const browsers = this.role === 'host' ? this.connectedBrowsers().map(([, hello]) => hello) : this.upstreamBrowsers;
    return { state: browsers.length ? 'connected' : 'listening', role: this.role, port, browsers };
  }

  request(
    browser: string,
    method: string,
    params: unknown,
    agent: AgentInfo | null = this.opts.agentInfo?.() ?? null,
    instance?: string,
  ): Promise<unknown> {
    if (this.role === 'relay' && this.upstream) return this.send(this.upstream, method, params, agent, { browser, instance });
    if (this.role !== 'host') return Promise.reject(new NotConnectedError(this.error ?? notConnected(browser)));
    try {
      const socket = this.pick(browser, instance);
      const hello = this.extensions.get(socket);
      this.recordActivity(agent, browser, method, hello);
      return this.send(socket, method, params, agent).catch((err: unknown) => {
        throw hello && method in toolDefinitions && errorMessage(err) === `Unknown method: ${method}` ? new Error(missingToolMessage(hello, toolLabel(browser, method), this.opts.version)) : err;
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private pick(browser: string, instance?: string): WebSocket {
    const candidates = this.connectedBrowsers().filter(([, hello]) => hello.browser === browser);
    if (!candidates.length) throw new NotConnectedError(this.error ?? notConnected(browser));
    const listed = candidates.map(([, hello]) => describeInstance(hello)).join(', ');
    if (instance !== undefined) {
      const target = candidates.find(([, hello]) => hello.instanceId === instance);
      if (!target) throw new NotConnectedError(`No ${browser} instance "${instance}" is connected. Connected instances: ${listed}.`);
      return target[0];
    }
    if (candidates.length > 1) {
      throw new Error(`Several ${browser} instances are connected: ${listed}. Pass instance to choose one. ${identifyHint}`);
    }
    return candidates[0][0];
  }

  agentChanged() {
    if (this.role === 'host') this.broadcastAgents();
    else if (this.role === 'relay' && this.upstream) this.announceAgent(this.upstream);
  }

  agents(): AgentSession[] {
    const own = this.opts.agentInfo?.();
    const relayed = [...this.relays.values()].filter((agent): agent is AgentInfo => agent !== undefined);
    const all = own ? [own, ...relayed] : relayed;
    const latest = all.filter((agent, index) => agent.sessionId === undefined || !all.slice(index + 1).some((later) => later.sessionId === agent.sessionId));
    return latest.map((agent) => {
      const activity = agent.sessionId === undefined ? undefined : this.activity.get(agent.sessionId);
      return activity ? { ...agent, activity } : agent;
    });
  }

  private sessionStillPresent(sessionId: string) {
    return this.opts.agentInfo?.()?.sessionId === sessionId || [...this.relays.values()].some((agent) => agent?.sessionId === sessionId);
  }

  private recordActivity(agent: AgentInfo | null, browser: string, method: string, hello: HelloMessage | undefined) {
    if (agent?.sessionId === undefined) return;
    const previous = this.activity.get(agent.sessionId);
    const use: AgentInstanceUse = {
      browser,
      ...(hello?.instanceId !== undefined && { instanceId: hello.instanceId }),
      ...(hello?.label !== undefined && { label: hello.label }),
      ...(hello?.name !== undefined && { name: hello.name }),
    };
    this.activity.set(agent.sessionId, {
      lastUsedAt: Date.now(),
      lastTool: toolLabel(browser, method),
      calls: (previous?.calls ?? 0) + 1,
      instances: [use, ...(previous?.instances ?? []).filter((other) => !sameInstance(other, use))].slice(0, MAX_INSTANCES_PER_AGENT),
    });
    this.scheduleAgentsBroadcast();
  }

  private scheduleAgentsBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined;
      if (this.role === 'host') this.broadcastAgents();
    }, ACTIVITY_BROADCAST_MS);
  }

  private broadcastAgents() {
    const message: ServerToExtension = { type: 'agents', agents: this.agents() };
    for (const [socket] of this.connectedBrowsers()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }
  }

  private announceAgent(upstream: WebSocket) {
    const agent = this.opts.agentInfo?.();
    if (!agent || upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(JSON.stringify({ type: 'agent', agent } satisfies RelayToHost));
  }

  private connectedBrowsers(): [WebSocket, HelloMessage][] {
    return [...this.extensions].filter((entry): entry is [WebSocket, HelloMessage] => entry[1] !== undefined);
  }

  private get timeoutMs() {
    return this.opts.requestTimeoutMs ?? 30_000;
  }

  private get port() {
    return this.boundPort ?? this.opts.port;
  }

  private get hostname() {
    return this.opts.host ?? '127.0.0.1';
  }

  private send(
    socket: WebSocket,
    method: string,
    params: unknown,
    agent: AgentInfo | null,
    target?: { browser: string; instance?: string },
  ): Promise<unknown> {
    const id = randomUUID();
    const message: ServerToExtension = {
      type: 'request',
      id,
      method,
      params,
      ...(agent && { agent }),
      ...(target && { browser: target.browser }),
      ...(target?.instance !== undefined && { instance: target.instance }),
    };
    const browserWait = browserWaitOf(params);
    const limitMs = browserWait === undefined ? this.timeoutMs : Math.max(this.timeoutMs, browserWait + RESPONSE_MARGIN_MS);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser did not answer ${method} within ${limitMs / 1000}s`));
      }, limitMs);
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
        port: this.port,
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
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.port;
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
    const { extensionId } = this.opts;
    if (extensionId) return EXTENSION_SCHEMES.some((scheme) => origin === `${scheme}${extensionId}`);
    return EXTENSION_SCHEMES.some((scheme) => origin.startsWith(scheme));
  }

  private connectUpstream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.hostname}:${this.port}${RELAY_PATH}`);
      let opened = false;
      ws.on('error', (err) => {
        if (!opened) reject(err);
      });
      ws.once('open', () => {
        opened = true;
        this.upstream = ws;
        this.upstreamBrowsers = [];
        this.role = 'relay';
        this.error = undefined;
        this.boundPort = this.port;
        this.log(`Another agent session hosts the bridge; relaying through it on port ${this.port}`);
        this.announceAgent(ws);
        resolve();
      });
      ws.on('message', (raw) => {
        const msg = this.parse(raw, hostToRelay);
        if (!msg) return;
        this.handleHostMessage(ws, msg);
      });
      ws.on('close', () => {
        if (this.upstream !== ws) return;
        this.upstream = undefined;
        this.upstreamBrowsers = [];
        this.role = undefined;
        this.error = 'The agent session hosting the bridge exited; taking over.';
        this.failPending(new NotConnectedError('The agent session hosting the bridge exited; please retry.'), ws);
        this.log('Bridge host went away; re-establishing');
        this.scheduleEstablish(Math.random() * 300);
      });
    });
  }

  private handleHostMessage(upstream: WebSocket, msg: HostToRelay) {
    if (msg.type === 'status') this.upstreamBrowsers = msg.extensions ?? (msg.extension ? [msg.extension] : []);
    else if (msg.type === 'handover') void this.takeOver(upstream);
    else this.settle(msg);
  }

  private async takeOver(upstream: WebSocket) {
    if (this.upstream !== upstream) return;
    if (!(await this.listenForTakeOver())) return;
    this.log('Took over hosting the bridge from an older agent-browser-bridge server');
    this.upstream = undefined;
    this.upstreamBrowsers = [];
    await this.whenSettled(this.timeoutMs, upstream);
    upstream.close(HANDOVER_CLOSE_CODE, 'Took over the bridge');
  }

  private async listenForTakeOver(): Promise<boolean> {
    for (let attempt = 0; attempt < ESTABLISH_ATTEMPTS && !this.stopped && this.upstream; attempt++) {
      try {
        await this.listen();
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
        await delay(100);
      }
    }
    return false;
  }

  private considerHandover(successor: WebSocket, agent: AgentInfo) {
    const own = this.opts.version;
    if (this.handingOver || this.role !== 'host' || !own || !isNewerVersion(agent.serverVersion, own)) return;
    void this.handOver(successor, agent.serverVersion);
  }

  private async handOver(successor: WebSocket, version: string) {
    this.handingOver = true;
    this.log(`An agent session with server ${version} joined; handing the bridge over to it`);
    const successorLeft = new Promise<void>((resolve) => {
      if (successor.readyState >= WebSocket.CLOSING) resolve();
      else successor.once('close', () => resolve());
    });
    this.wss?.close();
    this.wss = undefined;
    this.reply(successor, { type: 'handover' });
    await Promise.race([successorLeft, delay(this.opts.handoverWaitMs ?? HANDOVER_WAIT_MS)]);
    await this.whenSettled(this.timeoutMs);
    this.role = undefined;
    this.error = 'Handing the bridge over to a newer agent-browser-bridge server; please retry.';
    for (const socket of [...this.extensions.keys(), ...this.relays.keys()]) {
      socket.close(HANDOVER_CLOSE_CODE, 'Bridge handed over to a newer server');
    }
    this.handingOver = false;
    this.scheduleEstablish(REJOIN_AFTER_HANDOVER_MS);
  }

  private async whenSettled(limitMs: number, socket?: WebSocket) {
    const deadline = Date.now() + limitMs;
    const busy = () => [...this.pending.values()].some((p) => !socket || p.socket === socket);
    while (busy() && Date.now() < deadline && !this.stopped) await delay(50);
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
    this.relays.set(socket, undefined);
    this.log(`Agent session joined (${this.relays.size} relayed)`);
    this.sendStatus(socket);
    socket.on('message', (raw) => {
      const msg = this.parse(raw, relayToHost);
      if (!msg) return;
      if (msg.type === 'agent') {
        this.relays.set(socket, msg.agent);
        this.broadcastAgents();
        this.considerHandover(socket, msg.agent);
        return;
      }
      this.request(msg.browser ?? 'chrome', msg.method, msg.params, msg.agent ?? null, msg.instance).then(
        (result) => this.reply(socket, { type: 'response', id: msg.id, ok: true, result }),
        (err) => this.reply(socket, { type: 'response', id: msg.id, ok: false, error: errorMessage(err) }),
      );
    });
    socket.on('close', () => {
      const sessionId = this.relays.get(socket)?.sessionId;
      this.relays.delete(socket);
      if (sessionId !== undefined && !this.sessionStillPresent(sessionId)) this.activity.delete(sessionId);
      this.log(`Agent session left (${this.relays.size} relayed)`);
      this.broadcastAgents();
    });
  }

  private reply(socket: WebSocket, msg: HostToRelay) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  private sendStatus(socket: WebSocket) {
    const browsers = this.connectedBrowsers().map(([, hello]) => hello);
    this.reply(socket, { type: 'status', extension: browsers[0] ?? null, extensions: browsers });
  }

  private broadcastStatus() {
    for (const relay of this.relays.keys()) this.sendStatus(relay);
  }

  private attachExtension(socket: WebSocket) {
    this.extensions.set(socket, undefined);

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
          this.replaceSameInstance(socket, msg);
          this.extensions.set(socket, msg);
          this.log(`Extension ${msg.extensionVersion} connected from ${describeInstance(msg)}`);
          socket.send(JSON.stringify({ type: 'agents', agents: this.agents() } satisfies ServerToExtension));
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
      const hello = this.extensions.get(socket);
      if (!this.extensions.delete(socket)) return;
      this.failPending(new NotConnectedError(`The browser extension in ${hello?.browser ?? 'the browser'} disconnected.`), socket);
      if (!hello) return;
      this.broadcastStatus();
      this.log(`Extension disconnected from ${hello.browser}`);
    });
  }

  private replaceSameInstance(socket: WebSocket, incoming: HelloMessage) {
    for (const [previous, hello] of this.connectedBrowsers()) {
      if (previous === socket || hello.browser !== incoming.browser || hello.instanceId !== incoming.instanceId) continue;
      this.extensions.delete(previous);
      previous.close(REPLACED_CLOSE_CODE, 'Replaced by a newer connection');
      this.failPending(new NotConnectedError('Extension reconnected; please retry.'), previous);
    }
  }
}
