import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import WebSocket, { WebSocketServer } from 'ws';
import {
  REMOTE_EXTENSION_PATH,
  REMOTE_FULL_CLOSE_CODE,
  REMOTE_MCP_PATH,
  REMOTE_UNAUTHORIZED_CLOSE_CODE,
  remoteAuthMessage,
  remoteSpaceId,
  remoteTokenHash,
  remoteTokensMessage,
  spaceOfToken,
  type AgentInfo,
} from '@agent-browser-bridge/protocol';
import { ExtensionBridge, type BrowserBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

export interface RemoteServerOptions {
  port: number;
  host: string;
  version: string;
  log?: (msg: string) => void;
  authTimeoutMs?: number;
  sessionIdleMs?: number;
  sweepIntervalMs?: number;
  maxBrowsersPerSpace?: number;
  maxSessionsPerSpace?: number;
  maxSessions?: number;
  maxMessageBytes?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
}

interface Session {
  id: string;
  tokenHash: string;
  space: Space;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  startedAt: number;
  lastSeen: number;
}

interface Space {
  id: string;
  bridge: ExtensionBridge;
  browsers: Map<WebSocket, Set<string>>;
  sessions: Map<string, Session>;
}

const AUTH_TIMEOUT_MS = 10_000;
const SESSION_IDLE_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const MAX_BROWSERS_PER_SPACE = 16;
const MAX_SESSIONS_PER_SPACE = 32;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_SESSIONS = 5_000;
const MAX_EARLY_MESSAGES = 16;

const notConnectedRemotely = (browser: string) =>
  `No ${browser} browser is connected to this relay for your token. Ask the user to open ${browser} and check that remote access is turned on in the Agent Browser Bridge extension settings; it reconnects automatically within ~30 seconds.`;

const JSON_RPC_UNAUTHORIZED = -32001;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_PARSE_ERROR = -32700;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = JSON_RPC_INVALID_REQUEST,
  ) {
    super(message);
  }
}

const bearerToken = (req: IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')?.[1];

const pathOf = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://relay').pathname.replace(/\/+$/, '') || '/';

const headerValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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

const parseMessage = <T>(raw: WebSocket.RawData, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }) => {
  try {
    const parsed = schema.safeParse(JSON.parse(raw.toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export class RemoteServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly spaces = new Map<string, Space>();
  private readonly sessions = new Map<string, Session>();
  private readonly log: (msg: string) => void;
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly opts: RemoteServerOptions) {
    this.log = opts.log ?? (() => {});
    this.http = createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxMessageBytes ?? MAX_MESSAGE_BYTES });
    this.http.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  async start(): Promise<number> {
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
    this.log(`Relay listening on http://${this.opts.host}:${port} (MCP at ${REMOTE_MCP_PATH}, extensions at ${REMOTE_EXTENSION_PATH})`);
    return port;
  }

  async stop(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.values()].map((session) => session.transport.close().catch(() => undefined)));
    await Promise.all([...this.spaces.values()].map((space) => space.bridge.stop()));
    this.spaces.clear();
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  stats() {
    let browsers = 0;
    for (const space of this.spaces.values()) browsers += space.browsers.size;
    return { spaces: this.spaces.size, browsers, sessions: this.sessions.size };
  }

  private spaceFor(id: string): Space {
    const existing = this.spaces.get(id);
    if (existing) return existing;
    const space: Space = {
      id,
      browsers: new Map(),
      sessions: new Map(),
      bridge: new ExtensionBridge({
        port: 0,
        attached: true,
        version: this.opts.version,
        log: (msg) => this.log(`[${id.slice(0, 6)}] ${msg}`),
        agents: () => [...space.sessions.values()].map((session) => this.agentOf(session)),
        notConnectedMessage: notConnectedRemotely,
        ...(this.opts.requestTimeoutMs !== undefined && { requestTimeoutMs: this.opts.requestTimeoutMs }),
      }),
    };
    void space.bridge.start();
    this.spaces.set(id, space);
    return space;
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

  private accepts(space: Space, tokenHash: string) {
    if (!space.browsers.size) return true;
    for (const tokens of space.browsers.values()) if (tokens.has(tokenHash)) return true;
    return false;
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (pathOf(req) !== REMOTE_EXTENSION_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.acceptBrowser(ws));
  }

  private acceptBrowser(ws: WebSocket) {
    const early: WebSocket.RawData[] = [];
    const timer = setTimeout(() => ws.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, 'Expected remoteAuth'), this.opts.authTimeoutMs ?? AUTH_TIMEOUT_MS);
    ws.on('error', (err) => this.log(`Browser connection error: ${err.message}`));
    ws.on('close', () => clearTimeout(timer));
    const collect = (raw: WebSocket.RawData) => {
      early.push(raw);
      if (early.length > MAX_EARLY_MESSAGES) ws.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, 'Expected remoteAuth');
      if (early.length > 1) return;
      const auth = parseMessage(raw, remoteAuthMessage);
      if (!auth) {
        ws.close(REMOTE_UNAUTHORIZED_CLOSE_CODE, 'Expected remoteAuth');
        return;
      }
      void remoteSpaceId(auth.key).then((spaceId) => {
        clearTimeout(timer);
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.off('message', collect);
        this.joinSpace(ws, spaceId, new Set(auth.tokens), early.slice(1));
      });
    };
    ws.on('message', collect);
  }

  private joinSpace(ws: WebSocket, spaceId: string, tokens: Set<string>, earlier: WebSocket.RawData[]) {
    const space = this.spaceFor(spaceId);
    if (space.browsers.size >= (this.opts.maxBrowsersPerSpace ?? MAX_BROWSERS_PER_SPACE)) {
      ws.close(REMOTE_FULL_CLOSE_CODE, 'Too many browsers share this key');
      return;
    }
    space.browsers.set(ws, tokens);
    this.closeRevokedSessions(space);
    ws.on('message', (raw) => {
      const update = parseMessage(raw, remoteTokensMessage);
      if (!update) return;
      space.browsers.set(ws, new Set(update.tokens));
      this.closeRevokedSessions(space);
    });
    ws.on('close', () => {
      space.browsers.delete(ws);
      this.log(`[${spaceId.slice(0, 6)}] Browser left (${space.browsers.size} connected)`);
    });
    space.bridge.attachExtension(ws, earlier);
    this.log(`[${spaceId.slice(0, 6)}] Browser joined (${space.browsers.size} connected)`);
  }

  private closeRevokedSessions(space: Space) {
    for (const session of space.sessions.values()) {
      if (this.accepts(space, session.tokenHash)) continue;
      this.log(`[${space.id.slice(0, 6)}] Closing an agent session whose token was revoked`);
      void session.transport.close();
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    try {
      const path = pathOf(req);
      if (path === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version: this.opts.version }));
        return;
      }
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`Agent Browser Bridge relay ${this.opts.version}\n`);
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

  private async authorize(req: IncomingMessage): Promise<{ spaceId: string; tokenHash: string }> {
    const token = bearerToken(req);
    const spaceId = token && spaceOfToken(token);
    if (!token || !spaceId) {
      throw new HttpError(401, 'Missing or malformed access token. Create one in the Agent Browser Bridge extension under Remote access.', JSON_RPC_UNAUTHORIZED);
    }
    const tokenHash = await remoteTokenHash(token);
    const space = this.spaces.get(spaceId);
    if (space && !this.accepts(space, tokenHash)) {
      throw new HttpError(401, 'This access token was revoked in the browser it was created in.', JSON_RPC_UNAUTHORIZED);
    }
    return { spaceId, tokenHash };
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse) {
    const { spaceId, tokenHash } = await this.authorize(req);
    const body = req.method === 'POST' ? await readBody(req, this.opts.maxBodyBytes ?? MAX_BODY_BYTES) : undefined;
    const sessionId = headerValue(req.headers['mcp-session-id']);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session || session.tokenHash !== tokenHash) throw new HttpError(404, 'Session not found');
      session.lastSeen = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) throw new HttpError(400, 'Send an initialize request first, without an mcp-session-id header');
    if (this.sessions.size >= (this.opts.maxSessions ?? MAX_SESSIONS)) throw new HttpError(503, 'The relay is busy; try again later');
    const space = this.spaceFor(spaceId);
    this.makeRoom(space);
    const transport = await this.openSession(space, tokenHash);
    await transport.handleRequest(req, res, body);
  }

  private makeRoom(space: Space) {
    const limit = this.opts.maxSessionsPerSpace ?? MAX_SESSIONS_PER_SPACE;
    if (space.sessions.size < limit) return;
    const oldest = [...space.sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (oldest) void this.closeSession(oldest);
  }

  private async openSession(space: Space, tokenHash: string): Promise<StreamableHTTPServerTransport> {
    let session: Session | undefined;
    const view: BrowserBridge = {
      status: () => space.bridge.status(),
      ready: (browser) => space.bridge.ready(browser),
      request: (browser, method, params, agent, instance) => {
        if (!this.accepts(space, tokenHash)) return Promise.reject(new Error('This access token was revoked.'));
        return space.bridge.request(browser, method, params, agent ?? (session ? this.agentOf(session) : null), instance);
      },
    };
    const server = createMcpServer(view, this.opts.version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const now = Date.now();
        session = { id, tokenHash, space, transport, server, startedAt: now, lastSeen: now };
        this.sessions.set(id, session);
        space.sessions.set(id, session);
        this.log(`[${space.id.slice(0, 6)}] Agent session started (${space.sessions.size} open)`);
      },
    });
    transport.onclose = () => {
      if (!session) return;
      this.sessions.delete(session.id);
      space.sessions.delete(session.id);
      space.bridge.forgetAgent(session.id);
      this.log(`[${space.id.slice(0, 6)}] Agent session ended (${space.sessions.size} open)`);
    };
    server.server.oninitialized = () => space.bridge.agentChanged();
    await server.connect(transport);
    return transport;
  }

  private async closeSession(session: Session) {
    await session.transport.close().catch(() => undefined);
  }

  private sweep(now = Date.now()) {
    const idleMs = this.opts.sessionIdleMs ?? SESSION_IDLE_MS;
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen > idleMs) void this.closeSession(session);
    }
    for (const [id, space] of this.spaces) {
      if (space.browsers.size || space.sessions.size) continue;
      this.spaces.delete(id);
      void space.bridge.stop();
    }
  }
}

const usage = `Usage: agent-browser-bridge-mcp [stdio]
       agent-browser-bridge-mcp http [--port <port>] [--host <address>]

stdio (default)  Serve one agent over standard input and output, and connect to
                 the extension on this computer.
http             Run a relay that browsers connect to over the internet and
                 agents reach at /mcp with an access token from the extension.
                 --port defaults to $PORT or 8080, --host to $HOST or 127.0.0.1.`;

export interface HttpArgs {
  port: number;
  host: string;
}

export function parseHttpArgs(args: string[], env: Record<string, string | undefined>): HttpArgs {
  let port = env.PORT ?? '8080';
  let host = env.HOST ?? '127.0.0.1';
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
    else throw new Error(`Unknown option ${arg}\n\n${usage}`);
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new Error(`Invalid port ${port}\n\n${usage}`);
  return { port: parsed, host };
}

export { usage as cliUsage };

export async function runRemoteServer(args: string[], version: string) {
  const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);
  const { port, host } = parseHttpArgs(args, process.env);
  const server = new RemoteServer({ port, host, version, log });
  await server.start();
  const shutdown = async () => {
    log('Shutting down');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
