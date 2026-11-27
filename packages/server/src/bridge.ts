import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
  browserApis,
  browserToolName,
  CHAT_PEEK_METHOD,
  CHAT_RECEIVE_METHOD,
  chatToolNames,
  CHROME_WEB_STORE_URL,
  extensionToServer,
  isChatMethod,
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
  type ReconnectingInstance,
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
  reconnectGraceMs?: number;
  reloadGraceMs?: number;
  hostChangeGraceMs?: number;
  startupGraceMs?: number;
  log?: (msg: string) => void;
  agentInfo?: () => AgentInfo;
  attached?: boolean;
  agents?: () => AgentInfo[];
  notConnectedMessage?: (browser: string) => string;
}

export type BrowserBridge = Pick<ExtensionBridge, 'status' | 'request' | 'ready'>;

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

interface ExpectedInstance {
  browser: string;
  instanceId?: string;
  until: number;
}

export class NotConnectedError extends Error {}
export class ConnectionLostError extends NotConnectedError {}

export const RELAY_PATH = '/relay';

const ESTABLISH_ATTEMPTS = 5;
const RETRY_MS = 2_000;
const HANDOVER_WAIT_MS = 5_000;
const REJOIN_AFTER_HANDOVER_MS = 500;
const HANDOVER_CLOSE_CODE = 4002;
const ACTIVITY_BROADCAST_MS = 250;
const MAX_INSTANCES_PER_AGENT = 8;
const RESPONSE_MARGIN_MS = 5_000;
const RECONNECT_GRACE_MS = 5_000;
const RELOAD_GRACE_MS = 20_000;
const HOST_CHANGE_GRACE_MS = 10_000;
const MAX_ATTEMPTS = 3;
const PROTOCOL_MISMATCH_CLOSE_CODE = 4001;
const installHint = (browser: string) =>
  browser === 'chrome' ? ` If the user has not installed it, they can add it from the Chrome Web Store: ${CHROME_WEB_STORE_URL}` : '';
const notConnected = (browser: string) =>
  `The Agent Browser Bridge extension is not connected in ${browser}. Make sure ${browser} is open with the extension installed and enabled; it reconnects automatically within ~30 seconds.${installHint(browser)}`;
const EXTENSION_SCHEMES = ['chrome-extension://', 'safari-web-extension://'];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toolLabel = (browser: string, method: string) => {
  if (method === SET_INSTANCE_NAME_METHOD) return NAME_INSTANCE_TOOL;
  if (isChatMethod(method)) return chatToolNames[method];
  if (method in toolDefinitions && browser in browserApis) return browserToolName(browser as Browser, method as Method);
  return method;
};
const sameInstance = (a: AgentInstanceUse, b: AgentInstanceUse) => a.browser === b.browser && a.instanceId === b.instanceId;
const instanceKey = (instance: { browser: string; instanceId?: string }) => `${instance.browser}:${instance.instanceId ?? ''}`;
const isRetryable = (method: string) =>
  method === CHAT_RECEIVE_METHOD || method === CHAT_PEEK_METHOD || (method in toolDefinitions && toolDefinitions[method as Method].readOnly);
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
  private expected = new Map<string, ExpectedInstance>();
  private reloading = new WeakSet<WebSocket>();
  private changeListeners = new Set<() => void>();
  private startupUntil: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BridgeOptions) {
    this.log = opts.log ?? (() => {});
    this.startupUntil = opts.startupGraceMs ? Date.now() + opts.startupGraceMs : 0;
  }

  async start(): Promise<number> {
    if (this.opts.attached) {
      this.role = 'host';
      this.notifyChange();
      return this.port;
    }
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
    this.expected.clear();
    this.startupUntil = 0;
    this.notifyChange();
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

  async request(
    browser: string,
    method: string,
    params: unknown,
    agent: AgentInfo | null = this.opts.agentInfo?.() ?? null,
    instance?: string,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      await this.ready(browser);
      try {
        return await this.attempt(browser, method, params, agent, instance, attempt === 1);
      } catch (err) {
        if (!(err instanceof ConnectionLostError) || this.stopped) throw err;
        if (!isRetryable(method)) {
          throw new ConnectionLostError(
            `${err.message} It was running ${toolLabel(browser, method)}, which may or may not have taken effect; check before trying again.`,
          );
        }
        if (attempt >= MAX_ATTEMPTS) throw err;
        this.log(`Retrying ${method} after the connection to ${browser} was lost`);
      }
    }
  }

  async ready(browser: string): Promise<void> {
    for (let deadline = this.reconnectDeadline(browser); deadline !== undefined; deadline = this.reconnectDeadline(browser)) {
      await this.nextChange(deadline - Date.now());
    }
  }

  private async attempt(browser: string, method: string, params: unknown, agent: AgentInfo | null, instance: string | undefined, record: boolean) {
    if (this.role === 'relay' && this.upstream) return this.send(this.upstream, method, params, agent, { browser, instance });
    if (this.role !== 'host') throw new NotConnectedError(this.error ?? this.notConnected(browser));
    const socket = this.pick(browser, instance);
    const hello = this.extensions.get(socket);
    if (record) this.recordActivity(agent, browser, method, hello);
    try {
      return await this.send(socket, method, params, agent);
    } catch (err) {
      throw hello && method in toolDefinitions && errorMessage(err) === `Unknown method: ${method}` ? new Error(missingToolMessage(hello, toolLabel(browser, method), this.opts.version)) : err;
    }
  }

  private currentBrowsers(): HelloMessage[] {
    if (this.role === 'host') return this.connectedBrowsers().map(([, hello]) => hello);
    if (this.role === 'relay') return this.upstreamBrowsers;
    return [];
  }

  private reconnectDeadline(browser: string): number | undefined {
    const now = Date.now();
    const current = this.currentBrowsers();
    let deadline: number | undefined;
    for (const [key, entry] of this.expected) {
      if (entry.until <= now || current.some((hello) => instanceKey(hello) === key)) {
        this.expected.delete(key);
        continue;
      }
      if (entry.browser === browser) deadline = Math.max(deadline ?? 0, entry.until);
    }
    if (this.startupUntil > now && !current.some((hello) => hello.browser === browser)) deadline = Math.max(deadline ?? 0, this.startupUntil);
    return deadline;
  }

  private expect(instance: { browser: string; instanceId?: string }, waitMs: number) {
    if (this.stopped || waitMs <= 0) return;
    const until = Date.now() + waitMs;
    const key = instanceKey(instance);
    const previous = this.expected.get(key);
    if (previous && previous.until >= until) return;
    this.expected.set(key, { browser: instance.browser, ...(instance.instanceId !== undefined && { instanceId: instance.instanceId }), until });
  }

  private reconnecting(): ReconnectingInstance[] {
    const now = Date.now();
    return [...this.expected.values()]
      .filter((entry) => entry.until > now)
      .map((entry) => ({
        browser: entry.browser,
        ...(entry.instanceId !== undefined && { instanceId: entry.instanceId }),
        waitMs: entry.until - now,
      }));
  }

  private nextChange(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.changeListeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.changeListeners.add(done);
    });
  }

  private notifyChange() {
    for (const listener of [...this.changeListeners]) listener();
  }

  private pick(browser: string, instance?: string): WebSocket {
    const candidates = this.connectedBrowsers().filter(([, hello]) => hello.browser === browser);
    if (!candidates.length) throw new NotConnectedError(this.error ?? this.notConnected(browser));
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

  private notConnected(browser: string) {
    return this.opts.notConnectedMessage?.(browser) ?? notConnected(browser);
  }

  agentChanged() {
    if (this.role === 'host') this.broadcastAgents();
    else if (this.role === 'relay' && this.upstream) this.announceAgent(this.upstream);
  }

  forgetAgent(sessionId: string) {
    this.activity.delete(sessionId);
    this.agentChanged();
  }

  agents(): AgentSession[] {
    const own = this.opts.agentInfo?.();
    const relayed = [...this.relays.values()].filter((agent): agent is AgentInfo => agent !== undefined);
    const all = this.opts.agents?.() ?? (own ? [own, ...relayed] : relayed);
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
    if (agent?.sessionId === undefined || method === CHAT_PEEK_METHOD) return;
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
    for (const [socket] of this.connectedBrowsers()) this.toExtension(socket, message);
  }

  private toExtension(socket: WebSocket, message: ServerToExtension) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new ConnectionLostError('The connection to the browser closed.'));
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
        wss.removeAllListeners('error');
        wss.on('error', (err) => this.log(`Bridge server error: ${errorMessage(err)}`));
        this.log(`Hosting the bridge on ws://${this.hostname}:${this.boundPort}`);
        this.notifyChange();
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
        this.notifyChange();
        resolve();
      });
      ws.on('message', (raw) => {
        const msg = this.parse(raw, hostToRelay);
        if (!msg) return;
        this.handleHostMessage(ws, msg);
      });
      ws.on('close', () => {
        if (this.upstream !== ws) return;
        for (const hello of this.upstreamBrowsers) this.expect(hello, this.opts.hostChangeGraceMs ?? HOST_CHANGE_GRACE_MS);
        this.upstream = undefined;
        this.upstreamBrowsers = [];
        this.role = undefined;
        this.error = 'The agent session hosting the bridge exited; taking over.';
        this.failPending(new ConnectionLostError('The agent session hosting the bridge exited.'), ws);
        this.log('Bridge host went away; re-establishing');
        this.notifyChange();
        this.scheduleEstablish(Math.random() * 300);
      });
    });
  }

  private handleHostMessage(upstream: WebSocket, msg: HostToRelay) {
    if (msg.type === 'status') {
      this.upstreamBrowsers = msg.extensions ?? (msg.extension ? [msg.extension] : []);
      for (const entry of msg.reconnecting ?? []) this.expect(entry, entry.waitMs);
      this.notifyChange();
    } else if (msg.type === 'handover') void this.takeOver(upstream);
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
    socket.on('error', (err) => this.log(`Relay connection error: ${errorMessage(err)}`));
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
    this.reply(socket, { type: 'status', extension: browsers[0] ?? null, extensions: browsers, reconnecting: this.reconnecting() });
  }

  private broadcastStatus() {
    for (const relay of this.relays.keys()) this.sendStatus(relay);
  }

  attachExtension(socket: WebSocket, earlier: WebSocket.RawData[] = []) {
    this.extensions.set(socket, undefined);
    socket.on('error', (err) => this.log(`Extension connection error: ${errorMessage(err)}`));

    const receive = (raw: WebSocket.RawData) => {
      const msg = this.parse(raw, extensionToServer);
      if (!msg) return;
      switch (msg.type) {
        case 'hello':
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            this.log(`Extension speaks protocol v${msg.protocolVersion}, server expects v${PROTOCOL_VERSION}; update whichever is older.`);
            socket.close(PROTOCOL_MISMATCH_CLOSE_CODE, 'Protocol version mismatch');
            return;
          }
          this.replaceSameInstance(socket, msg);
          this.extensions.set(socket, msg);
          this.expected.delete(instanceKey(msg));
          this.log(`Extension ${msg.extensionVersion} connected from ${describeInstance(msg)}`);
          this.toExtension(socket, { type: 'agents', agents: this.agents() });
          this.broadcastStatus();
          this.notifyChange();
          return;
        case 'ping':
          this.toExtension(socket, { type: 'pong' });
          return;
        case 'reloading':
          this.reloading.add(socket);
          this.log('Extension is reloading to install an update');
          return;
        case 'response':
          this.settle(msg);
      }
    };
    socket.on('message', receive);
    for (const raw of earlier) receive(raw);

    socket.on('close', () => {
      const hello = this.extensions.get(socket);
      if (!this.extensions.delete(socket)) return;
      const reloading = this.reloading.has(socket);
      if (hello) this.expect(hello, this.graceAfterClose(reloading));
      const reason = reloading ? 'reloaded to install an update' : 'disconnected';
      this.failPending(new ConnectionLostError(`The browser extension in ${hello?.browser ?? 'the browser'} ${reason}.`), socket);
      if (!hello) return;
      this.broadcastStatus();
      this.notifyChange();
      this.log(`Extension ${reason} from ${hello.browser}`);
    });
  }

  private graceAfterClose(reloading: boolean) {
    if (reloading) return this.opts.reloadGraceMs ?? RELOAD_GRACE_MS;
    if (this.role === undefined) return this.opts.hostChangeGraceMs ?? HOST_CHANGE_GRACE_MS;
    return this.opts.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  }

  private replaceSameInstance(socket: WebSocket, incoming: HelloMessage) {
    for (const [previous, hello] of this.connectedBrowsers()) {
      if (previous === socket || hello.browser !== incoming.browser || hello.instanceId !== incoming.instanceId) continue;
      this.extensions.delete(previous);
      previous.close(REPLACED_CLOSE_CODE, 'Replaced by a newer connection');
      this.failPending(new ConnectionLostError('The extension reconnected.'), previous);
    }
  }
}
