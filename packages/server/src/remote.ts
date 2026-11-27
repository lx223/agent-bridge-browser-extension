import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import WebSocket, { WebSocketServer } from 'ws';
import {
  AGENT_TOKEN_ENV,
  BROWSER_TOKEN_ENV,
  newRemoteNonce,
  newRemoteToken,
  REMOTE_EXTENSION_PATH,
  REMOTE_FULL_CLOSE_CODE,
  REMOTE_MCP_PATH,
  REMOTE_UNAUTHORIZED_CLOSE_CODE,
  remoteAuthMessage,
  normalizeRelayHost,
  remoteProof,
  remoteTokenProblem,
  type AgentInfo,
  type RemoteChallengeMessage,
  type RemoteWelcomeMessage,
} from '@agent-browser-bridge/protocol';
import { ExtensionBridge, type BrowserBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

export interface RemoteServerOptions {
  port: number;
  host: string;
  version: string;
  agentToken: string;
  browserToken: string;
  extensionId?: string;
  publicHost?: string;
  log?: (msg: string) => void;
  authTimeoutMs?: number;
  sessionIdleMs?: number;
  sweepIntervalMs?: number;
  maxBrowsers?: number;
  maxSessions?: number;
  maxMessageBytes?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  failureDelayMs?: (failures: number) => number;
  maxDelayedFailures?: number;
}

interface Session {
  id: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  startedAt: number;
  lastSeen: number;
}

const AUTH_TIMEOUT_MS = 10_000;
const SESSION_IDLE_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const MAX_BROWSERS = 16;
const MAX_SESSIONS = 64;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_DELAYED_FAILURES = 100;
const FAILURE_WINDOW_MS = 10 * 60_000;
const EXTENSION_SCHEMES = ['chrome-extension://', 'safari-web-extension://'];

const JSON_RPC_UNAUTHORIZED = -32001;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_PARSE_ERROR = -32700;

const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const notConnectedRemotely = (browser: string) =>
  `No ${browser} browser is connected to this relay. Ask the user to open ${browser} and check that remote access is on in the Agent Browser Bridge extension settings, with this relay's address and browser token; it reconnects automatically within ~30 seconds.`;

export const defaultFailureDelayMs = (failures: number) => Math.min(250 * 2 ** Math.max(0, failures - 1), 10_000);

const digest = (value: string) => createHash('sha256').update(value).digest();

export const sameSecret = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = JSON_RPC_INVALID_REQUEST,
  ) {
    super(message);
  }
}

const bearerToken = (req: IncomingMessage) => /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(req.headers.authorization ?? '')?.[1];

const pathOf = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://relay').pathname.replace(/\/+$/, '') || '/';

const headerValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const clientOf = (req: IncomingMessage) => req.socket.remoteAddress ?? 'unknown';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON', JSON_RPC_PARSE_ERROR));
      }
    });
    req.on('error', reject);
  });
}

function sendError(res: ServerResponse, error: HttpError) {
  if (res.headersSent) return;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (error.status === 401) headers['www-authenticate'] = 'Bearer realm="agent-browser-bridge"';
  res.writeHead(error.status, headers).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: error.code, message: error.message } }));
}

class FailureGate {
  private readonly failures = new Map<string, { count: number; last: number }>();
  private readonly reported = new Map<string, { count: number; last: number }>();
  private delayed = 0;

  constructor(
    private readonly delayMs: (failures: number) => number,
    private readonly maxDelayed: number,
    private readonly log: (msg: string) => void,
  ) {}

  private bump(counts: Map<string, { count: number; last: number }>, key: string, now: number) {
    const previous = counts.get(key);
    const count = previous && now - previous.last < FAILURE_WINDOW_MS ? previous.count + 1 : 1;
    counts.set(key, { count, last: now });
    return count;
  }

  async failed(client: string, what: string): Promise<boolean> {
    const now = Date.now();
    const count = this.bump(this.failures, client, now);
    const kind = this.bump(this.reported, `${what} from ${client}`, now);
    if (kind === 1 || Number.isInteger(Math.log10(kind))) this.log(`Rejected ${what} from ${client} (${kind} time${kind === 1 ? '' : 's'} recently)`);
    if (this.delayed >= this.maxDelayed) return false;
    this.delayed++;
    try {
      await delay(this.delayMs(count));
    } finally {
      this.delayed--;
    }
    return true;
  }

  forgetOld(now = Date.now()) {
    for (const counts of [this.failures, this.reported]) {
      for (const [key, entry] of counts) if (now - entry.last >= FAILURE_WINDOW_MS) counts.delete(key);
    }
  }
}

const parseJson = (raw: WebSocket.RawData): unknown => {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
};

export class RemoteServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly bridge: ExtensionBridge;
  private readonly browsers = new Set<WebSocket>();
  private readonly sessions = new Map<string, Session>();
  private readonly gate: FailureGate;
  private readonly log: (msg: string) => void;
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly opts: RemoteServerOptions) {
    const agentProblem = remoteTokenProblem(opts.agentToken);
    const browserProblem = remoteTokenProblem(opts.browserToken);
    if (agentProblem) throw new Error(`The agent token ${agentProblem}.`);
    if (browserProblem) throw new Error(`The browser token ${browserProblem}.`);
    if (sameSecret(opts.agentToken, opts.browserToken)) throw new Error('The agent token and the browser token must be different.');
    this.log = opts.log ?? (() => {});
    this.gate = new FailureGate(opts.failureDelayMs ?? defaultFailureDelayMs, opts.maxDelayedFailures ?? MAX_DELAYED_FAILURES, this.log);
    this.bridge = new ExtensionBridge({
      port: 0,
      attached: true,
      version: opts.version,
      log: this.log,
      agents: () => [...this.sessions.values()].map((session) => this.agentOf(session)),
      notConnectedMessage: notConnectedRemotely,
      ...(opts.requestTimeoutMs !== undefined && { requestTimeoutMs: opts.requestTimeoutMs }),
    });
    this.http = createServer((req, res) => void this.handleHttp(req, res));
    this.http.headersTimeout = 20_000;
    this.http.requestTimeout = 60_000;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxMessageBytes ?? MAX_MESSAGE_BYTES });
    this.http.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  async start(): Promise<number> {
    await this.bridge.start();
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.opts.port, this.opts.host, () => {
        this.http.off('error', reject);
        resolve();
      });
    });
    this.sweeper = setInterval(() => this.sweep(), this.opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
    this.sweeper.unref();
    const address = this.http.address();
    const port = typeof address === 'object' && address ? address.port : this.opts.port;
    this.log(`Relay listening on http://${this.opts.host}:${port} (MCP at ${REMOTE_MCP_PATH}, browsers at ${REMOTE_EXTENSION_PATH})`);
    return port;
  }

  async stop(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.values()].map((session) => session.transport.close().catch(() => undefined)));
    await this.bridge.stop();
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  stats() {
    return { browsers: this.browsers.size, sessions: this.sessions.size };
  }

  private agentOf(session: Session): AgentInfo {
    const client = session.server.server.getClientVersion();
    return {
      serverVersion: this.opts.version,
      client: client ? { name: client.name, version: client.version } : null,
      sessionId: session.id,
      startedAt: session.startedAt,
    };
  }

  private allowedOrigin(origin: string | undefined) {
    if (!origin) return false;
    const { extensionId } = this.opts;
    if (extensionId) return EXTENSION_SCHEMES.some((scheme) => origin === `${scheme}${extensionId}`);
    return EXTENSION_SCHEMES.some((scheme) => origin.startsWith(scheme) && origin.length > scheme.length);
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const refuse = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (pathOf(req) !== REMOTE_EXTENSION_PATH) return refuse('404 Not Found');
    if (!this.allowedOrigin(headerValue(req.headers.origin))) {
      void this.gate.failed(clientOf(req), 'a browser connection from another origin').then(() => refuse('403 Forbidden'));
      return;
    }
    const relayHost = this.opts.publicHost ?? headerValue(req.headers.host);
    if (!relayHost) return refuse('400 Bad Request');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.acceptBrowser(ws, clientOf(req), normalizeRelayHost(relayHost)));
  }

  private acceptBrowser(ws: WebSocket, client: string, relayHost: string) {
    const relayNonce = newRemoteNonce();
    const early: WebSocket.RawData[] = [];
    const reject = (reason: string) => {
      void this.gate.failed(client, 'a browser').then(() => ws.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, reason));
    };
    const timer = setTimeout(() => ws.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, 'Authentication timed out'), this.opts.authTimeoutMs ?? AUTH_TIMEOUT_MS);
    ws.on('error', (err) => this.log(`Browser connection error: ${err.message}`));
    ws.on('close', () => clearTimeout(timer));
    const collect = (raw: WebSocket.RawData) => {
      early.push(raw);
      if (early.length > 1) {
        if (early.length > 16) ws.terminate();
        return;
      }
      const auth = remoteAuthMessage.safeParse(parseJson(raw));
      if (!auth.success || auth.data.nonce === relayNonce) {
        clearTimeout(timer);
        reject('Expected remoteAuth');
        return;
      }
      const proofInput = { relayHost, relayNonce, browserNonce: auth.data.nonce };
      void remoteProof(this.opts.browserToken, { role: 'browser', ...proofInput }).then(async (expected) => {
        clearTimeout(timer);
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!sameSecret(auth.data.proof, expected)) {
          reject('Wrong browser token');
          return;
        }
        ws.off('message', collect);
        const welcome: RemoteWelcomeMessage = { type: 'remoteWelcome', proof: await remoteProof(this.opts.browserToken, { role: 'relay', ...proofInput }) };
        ws.send(JSON.stringify(welcome));
        this.joinBrowser(ws, client, early.slice(1));
      });
    };
    ws.on('message', collect);
    const challenge: RemoteChallengeMessage = { type: 'remoteChallenge', nonce: relayNonce };
    ws.send(JSON.stringify(challenge));
  }

  private joinBrowser(ws: WebSocket, client: string, earlier: WebSocket.RawData[]) {
    if (this.browsers.size >= (this.opts.maxBrowsers ?? MAX_BROWSERS)) {
      ws.close(REMOTE_FULL_CLOSE_CODE, 'Too many browsers are connected');
      return;
    }
    this.browsers.add(ws);
    ws.on('close', () => {
      this.browsers.delete(ws);
      this.log(`Browser left (${this.browsers.size} connected)`);
    });
    this.bridge.attachExtension(ws, earlier);
    this.log(`Browser joined from ${client} (${this.browsers.size} connected)`);
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    try {
      const path = pathOf(req);
      if (path === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
        return;
      }
      if (path !== REMOTE_MCP_PATH) throw new HttpError(404, 'Not found');
      await this.handleMcp(req, res);
    } catch (err) {
      if (err instanceof HttpError) sendError(res, err);
      else {
        this.log(`Request failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        sendError(res, new HttpError(500, 'Internal error'));
      }
    }
  }

  private async authorize(req: IncomingMessage, res: ServerResponse) {
    const token = bearerToken(req);
    if (token && sameSecret(token, this.opts.agentToken)) return;
    if (!(await this.gate.failed(clientOf(req), 'an agent'))) {
      res.destroy();
      throw new HttpError(429, 'Too many failed attempts');
    }
    throw new HttpError(401, 'Missing or wrong agent token. Send the relay\'s agent token as "Authorization: Bearer <token>".', JSON_RPC_UNAUTHORIZED);
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse) {
    await this.authorize(req, res);
    const body = req.method === 'POST' ? await readBody(req, this.opts.maxBodyBytes ?? MAX_BODY_BYTES) : undefined;
    const sessionId = headerValue(req.headers['mcp-session-id']);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) throw new HttpError(404, 'Session not found');
      session.lastSeen = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) throw new HttpError(400, 'Send an initialize request first, without an mcp-session-id header');
    this.makeRoom();
    const transport = await this.openSession();
    await transport.handleRequest(req, res, body);
  }

  private makeRoom() {
    if (this.sessions.size < (this.opts.maxSessions ?? MAX_SESSIONS)) return;
    const oldest = [...this.sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (oldest) void oldest.transport.close().catch(() => undefined);
  }

  private async openSession(): Promise<StreamableHTTPServerTransport> {
    let session: Session | undefined;
    const view: BrowserBridge = {
      status: () => this.bridge.status(),
      ready: (browser) => this.bridge.ready(browser),
      request: (browser, method, params, agent, instance) =>
        this.bridge.request(browser, method, params, agent ?? (session ? this.agentOf(session) : null), instance),
    };
    const server = createMcpServer(view, this.opts.version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const now = Date.now();
        session = { id, transport, server, startedAt: now, lastSeen: now };
        this.sessions.set(id, session);
        this.log(`Agent session started (${this.sessions.size} open)`);
      },
    });
    transport.onclose = () => {
      if (!session) return;
      this.sessions.delete(session.id);
      this.bridge.forgetAgent(session.id);
      this.log(`Agent session ended (${this.sessions.size} open)`);
    };
    server.server.oninitialized = () => this.bridge.agentChanged();
    await server.connect(transport);
    return transport;
  }

  private sweep(now = Date.now()) {
    const idleMs = this.opts.sessionIdleMs ?? SESSION_IDLE_MS;
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen > idleMs) void session.transport.close().catch(() => undefined);
    }
    this.gate.forgetOld(now);
  }
}

const usage = `Usage: agent-browser-bridge-mcp [stdio]
       agent-browser-bridge-mcp http [--port <port>] [--host <address>]
                                     [--public-host <name>] [--extension-id <id>]
       agent-browser-bridge-mcp tokens

stdio (default)  Serve one agent over standard input and output, and connect to
                 the extension on this computer.
http             Run a relay that your browser connects to over the internet and
                 agents reach at /mcp. Needs two different secrets of at least
                 32 characters, from the environment or from files:
                   ${AGENT_TOKEN_ENV} (or ${AGENT_TOKEN_ENV}_FILE)
                     for agents: "Authorization: Bearer <token>"
                   ${BROWSER_TOKEN_ENV} (or ${BROWSER_TOKEN_ENV}_FILE)
                     entered in the extension's remote access settings
                 --port defaults to $PORT or 8080, --host to $HOST or 127.0.0.1.
                 --public-host (or $AGENT_BROWSER_BRIDGE_PUBLIC_HOST) is the host
                 name in the address browsers use, such as relay.example.com;
                 the browser and relay prove the token for that name, so a
                 look-alike relay cannot pass browsers on to this one.
                 --extension-id (or $AGENT_BROWSER_BRIDGE_EXTENSION_ID) only
                 accepts browsers running that extension id.
tokens           Print a new pair of random tokens to put in the environment.`;

export { usage as cliUsage };

export interface HttpArgs {
  port: number;
  host: string;
  extensionId?: string;
  publicHost?: string;
}

export function parseHttpArgs(args: string[], env: Record<string, string | undefined>): HttpArgs {
  let port = env.PORT ?? '8080';
  let host = env.HOST ?? '127.0.0.1';
  let extensionId = env.AGENT_BROWSER_BRIDGE_EXTENSION_ID || undefined;
  let publicHost = env.AGENT_BROWSER_BRIDGE_PUBLIC_HOST || undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined];
    const value = () => {
      const next = inline ?? args[++index];
      if (next === undefined) throw new Error(`${flag} needs a value\n\n${usage}`);
      return next;
    };
    if (flag === '--port') port = value();
    else if (flag === '--host') host = value();
    else if (flag === '--extension-id') extensionId = value();
    else if (flag === '--public-host') publicHost = value();
    else throw new Error(`Unknown option ${arg}\n\n${usage}`);
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new Error(`Invalid port ${port}\n\n${usage}`);
  if (publicHost !== undefined && !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(publicHost)) throw new Error(`Invalid public host ${publicHost}: give the host name browsers use, such as relay.example.com\n\n${usage}`);
  return { port: parsed, host, ...(extensionId && { extensionId }), ...(publicHost && { publicHost: publicHost.toLowerCase() }) };
}

export function readSecret(env: Record<string, string | undefined>, name: string, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')) {
  const file = env[`${name}_FILE`];
  if (file && env[name]) throw new Error(`Set either ${name} or ${name}_FILE, not both.`);
  if (!file) return env[name];
  try {
    return readFile(file).replace(/\r?\n$/, '');
  } catch (err) {
    throw new Error(`Could not read ${name}_FILE: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadTokens(env: Record<string, string | undefined>, readFile?: (path: string) => string) {
  const agentToken = readSecret(env, AGENT_TOKEN_ENV, readFile);
  const browserToken = readSecret(env, BROWSER_TOKEN_ENV, readFile);
  const agentProblem = remoteTokenProblem(agentToken);
  const browserProblem = remoteTokenProblem(browserToken);
  if (agentProblem) throw new Error(`${AGENT_TOKEN_ENV} ${agentProblem}. Run "agent-browser-bridge-mcp tokens" to create one.`);
  if (browserProblem) throw new Error(`${BROWSER_TOKEN_ENV} ${browserProblem}. Run "agent-browser-bridge-mcp tokens" to create one.`);
  if (sameSecret(agentToken!, browserToken!)) throw new Error(`${AGENT_TOKEN_ENV} and ${BROWSER_TOKEN_ENV} must be different.`);
  return { agentToken: agentToken!, browserToken: browserToken! };
}

export const tokensOutput = (agent = newRemoteToken(), browser = newRemoteToken()) => `${AGENT_TOKEN_ENV}=${agent}\n${BROWSER_TOKEN_ENV}=${browser}\n`;

export async function runRemoteServer(args: string[], version: string, env: Record<string, string | undefined> = process.env) {
  const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);
  const { port, host, extensionId, publicHost } = parseHttpArgs(args, env);
  const tokens = loadTokens(env);
  const server = new RemoteServer({ port, host, version, ...tokens, ...(extensionId && { extensionId }), ...(publicHost && { publicHost }), log });
  if (!publicHost) log('No --public-host set: browsers are checked against the Host header. Set it to the host name browsers use, such as relay.example.com.');
  await server.start();
  const shutdown = async () => {
    log('Shutting down');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
