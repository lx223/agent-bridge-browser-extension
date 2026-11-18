import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, type BrowserContext } from 'playwright';
import { DEFAULT_PORT, STATUS_TOOL } from '@agent-browser-bridge/protocol';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_DIST = join(ROOT, 'packages/extension/dist');
const SERVER_ENTRY = resolve(ROOT, process.env.E2E_SERVER_ENTRY ?? 'packages/server/dist/index.js');
const FIXTURES = join(ROOT, 'e2e/fixtures');
const CONNECT_TIMEOUT_MS = 30_000;

export const EXTENSION_VERSION: string = JSON.parse(readFileSync(join(ROOT, 'packages/extension/package.json'), 'utf-8')).version;

interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  isError: boolean;
  content: ToolContent[];
  text: string;
}

export interface Tab {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  groupId: number | null;
  pinned: boolean;
  active: boolean;
  loaded?: boolean;
}

export interface TabGroup {
  id: number;
  windowId: number;
  title: string;
  color: string;
  collapsed: boolean;
  tabIds: number[];
}

export interface BridgeStatus {
  state: string;
  role: string;
  port: number;
  browsers: Array<{ browser: string; label?: string; instanceId?: string; extensionVersion: string; protocolVersion: number; userAgent: string }>;
}

export interface Agent {
  client: Client;
  raw(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  text(name: string, args?: Record<string, unknown>): Promise<string>;
  waitUntilConnected(): Promise<BridgeStatus>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function portInUse(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

function requireBuild() {
  for (const path of [join(EXTENSION_DIST, 'manifest.json'), SERVER_ENTRY]) {
    if (!existsSync(path)) throw new Error(`Missing ${path}. Run "npm run build" first, or use "npm run test:e2e".`);
  }
}

export async function startAgent(name = 'e2e'): Promise<Agent> {
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], stderr: 'ignore' }));

  const raw = async (tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const result = await client.callTool({ name: tool, arguments: args });
    const content = result.content as ToolContent[];
    return { isError: result.isError === true, content, text: content.map((c) => c.text ?? '').join('') };
  };
  const text = async (tool: string, args?: Record<string, unknown>) => {
    const result = await raw(tool, args);
    if (result.isError) throw new Error(`${tool} failed: ${result.text}`);
    return result.text;
  };
  const call = async <T>(tool: string, args?: Record<string, unknown>) => JSON.parse(await text(tool, args)) as T;
  const waitUntilConnected = async () => {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    for (;;) {
      const status = await call<BridgeStatus>(STATUS_TOOL);
      if (status.state === 'connected') return status;
      if (Date.now() > deadline) throw new Error(`Extension did not connect: ${JSON.stringify(status)}`);
      await sleep(100);
    }
  };

  return { client, raw, call, text, waitUntilConnected, close: () => client.close() };
}

function serveFixtures(): Promise<Server> {
  const server = createServer((request, response) => {
    const name = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '');
    const path = join(FIXTURES, name);
    if (!/^[\w-]+\.html$/.test(name) || !existsSync(path)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(path));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

export interface Harness {
  agent: Agent;
  context: BrowserContext;
  extensionId: string;
  fixture(name: string): string;
  openFixture(name: string): Promise<Tab>;
  restartAgent(): Promise<Agent>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  requireBuild();
  if (await portInUse(DEFAULT_PORT)) {
    throw new Error(
      `Port ${DEFAULT_PORT} is already in use, probably by a running agent session. Close it before running the end-to-end tests so they cannot reach your own browser.`,
    );
  }

  const fixtures = await serveFixtures();
  const fixturePort = (fixtures.address() as { port: number }).port;
  const profile = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-e2e-'));
  let agent: Agent | undefined;
  let context: BrowserContext | undefined;
  const close = async () => {
    await agent?.close().catch(() => {});
    await context?.close().catch(() => {});
    await new Promise((done) => fixtures.close(done));
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    agent = await startAgent();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION_DIST}`,
        `--load-extension=${EXTENSION_DIST}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--enable-features=WebMCP',
      ],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    await agent.waitUntilConnected();

    const fixture = (name: string) => `http://127.0.0.1:${fixturePort}/${name}`;
    let current = agent;
    agent = undefined;
    const browser = context;

    return {
      get agent() {
        return current;
      },
      context: browser,
      extensionId,
      fixture,
      openFixture: (name) => current.call<Tab>('chrome_open_tab', { url: fixture(name) }),
      async restartAgent() {
        await current.close();
        current = await startAgent();
        return current;
      },
      async close() {
        await current.close().catch(() => {});
        await close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export function refOf(snapshot: string, pattern: RegExp): string {
  const line = snapshot.split('\n').find((candidate) => pattern.test(candidate));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No element matching ${pattern} in snapshot:\n${snapshot}`);
  return ref;
}
