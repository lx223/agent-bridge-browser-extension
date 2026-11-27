import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, type BrowserContext } from 'playwright';
import { build } from 'vite';
import { DEFAULT_PORT, STATUS_TOOL } from '@agent-browser-bridge/protocol';

const ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_ROOT = join(ROOT, 'extensions/browser');
export const EXTENSION_DIST = join(EXTENSION_ROOT, 'dist');
const SERVER_ENTRY = resolve(ROOT, process.env.E2E_SERVER_ENTRY ?? 'packages/server/dist/index.js');
export const SERVER_RUNS_LAUNCHER = process.env.E2E_SERVER_ENTRY === undefined;
const FIXTURES = join(import.meta.dirname, 'fixtures');
const CONNECT_TIMEOUT_MS = 30_000;
export const LOCAL_ONLY = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1';

export const EXTENSION_VERSION: string = JSON.parse(readFileSync(join(ROOT, 'extensions/browser/package.json'), 'utf-8')).version;

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
  serverPid(): number | null;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

function requireBuild() {
  for (const path of [join(EXTENSION_DIST, 'manifest.json'), SERVER_ENTRY]) {
    if (!existsSync(path)) throw new Error(`Missing ${path}. Run "npm run build" first, or use "npm run test:e2e".`);
  }
}

export interface TestBridge {
  port: number;
  extensionDir: string;
}

const BRIDGE_PORT_ENV = 'E2E_BRIDGE_PORT';
const EXTENSION_DIR_ENV = 'E2E_EXTENSION_DIR';

function requireOnlyTestPort({ port, extensionDir }: TestBridge) {
  const background = readFileSync(join(extensionDir, 'background.js'), 'utf-8');
  if (port === DEFAULT_PORT || !background.includes(String(port)) || background.includes(String(DEFAULT_PORT))) {
    throw new Error(`The test extension in ${extensionDir} does not connect only to port ${port}.`);
  }
}

export async function createTestBridge(): Promise<TestBridge> {
  requireBuild();
  let port = await freePort();
  while (port === DEFAULT_PORT) port = await freePort();
  const extensionDir = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-e2e-extension-'));
  const bridge = { port, extensionDir };
  try {
    cpSync(EXTENSION_DIST, extensionDir, { recursive: true });
    await build({
      configFile: join(EXTENSION_ROOT, 'vite.background.config.ts'),
      root: EXTENSION_ROOT,
      logLevel: 'error',
      build: { outDir: extensionDir },
      define: { 'import.meta.env.VITE_BRIDGE_PORT': JSON.stringify(String(port)) },
    });
    requireOnlyTestPort(bridge);
    return bridge;
  } catch (error) {
    removeTestBridge(bridge);
    throw error;
  }
}

export function removeTestBridge({ extensionDir }: TestBridge) {
  rmSync(extensionDir, { recursive: true, force: true });
}

export function shareTestBridge({ port, extensionDir }: TestBridge) {
  process.env[BRIDGE_PORT_ENV] = String(port);
  process.env[EXTENSION_DIR_ENV] = extensionDir;
}

function sharedTestBridge(): TestBridge | undefined {
  const port = Number(process.env[BRIDGE_PORT_ENV]);
  const extensionDir = process.env[EXTENSION_DIR_ENV];
  return port && extensionDir ? { port, extensionDir } : undefined;
}

async function ownTestBridge(): Promise<TestBridge> {
  const bridge = await createTestBridge();
  process.once('exit', () => removeTestBridge(bridge));
  return bridge;
}

async function resolveTestBridge(): Promise<TestBridge> {
  const shared = sharedTestBridge();
  if (!shared) return ownTestBridge();
  requireOnlyTestPort(shared);
  return shared;
}

let testBridgePromise: Promise<TestBridge> | undefined;

export function testBridge(): Promise<TestBridge> {
  testBridgePromise ??= resolveTestBridge();
  return testBridgePromise;
}

export async function startAgent(name = 'e2e', version = '0.0.0'): Promise<Agent> {
  const { port } = await testBridge();
  const client = new Client({ name, version });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: { ...getDefaultEnvironment(), AGENT_BROWSER_BRIDGE_PORT: String(port) },
    stderr: 'ignore',
  });
  await client.connect(transport);

  const raw = async (tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const result = await client.callTool({ name: tool, arguments: args });
    const content = result.content as ToolContent[];
    return { isError: result.isError === true, content, text: content.map((c) => c.text ?? '').join('') };
  };
  const text = async (tool: string, args?: Record<string, unknown>) => {
    const result = await raw(tool, args);
    if (result.isError) throw new Error(`${tool} failed: ${result.text}`);
    return result.content[0]?.text ?? '';
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

  return { client, raw, call, text, waitUntilConnected, serverPid: () => transport.pid, close: () => client.close() };
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

export interface BrowserProfile {
  context: BrowserContext;
  close(): Promise<void>;
}

export interface Harness {
  agent: Agent;
  context: BrowserContext;
  extensionId: string;
  fixture(name: string): string;
  openFixture(name: string): Promise<Tab>;
  restartAgent(): Promise<Agent>;
  openAnotherProfile(): Promise<BrowserProfile>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  locale?: string;
  deviceScaleFactor?: number;
  colorScheme?: 'light' | 'dark';
  agentName?: string;
  agentVersion?: string;
}

const removeProfile = (profile: string) => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

async function launchProfile(extensionDir: string, options: HarnessOptions): Promise<BrowserProfile> {
  const profile = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-e2e-'));
  try {
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      locale: options.locale,
      deviceScaleFactor: options.deviceScaleFactor,
      colorScheme: options.colorScheme,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        LOCAL_ONLY,
        '--enable-features=WebMCP',
        ...(options.locale ? [`--lang=${options.locale}`] : []),
      ],
    });
    return {
      context,
      async close() {
        await context.close().catch(() => {});
        removeProfile(profile);
      },
    };
  } catch (error) {
    removeProfile(profile);
    throw error;
  }
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const { extensionDir } = await testBridge();

  const fixtures = await serveFixtures();
  const fixturePort = (fixtures.address() as { port: number }).port;
  let agent: Agent | undefined;
  let main: BrowserProfile | undefined;
  const extra: BrowserProfile[] = [];
  const close = async () => {
    await agent?.close().catch(() => {});
    for (const profile of [...extra, ...(main ? [main] : [])]) await profile.close();
    await new Promise((done) => fixtures.close(done));
  };

  try {
    const launchAgent = () => startAgent(options.agentName, options.agentVersion);
    agent = await launchAgent();
    main = await launchProfile(extensionDir, options);
    const { context } = main;
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
      openFixture: (name) => current.call<Tab>('chrome_tabs_create', { url: fixture(name) }),
      async restartAgent() {
        await current.close();
        current = await launchAgent();
        return current;
      },
      async openAnotherProfile() {
        const profile = await launchProfile(extensionDir, options);
        extra.push(profile);
        return profile;
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
