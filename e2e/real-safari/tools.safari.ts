import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { DEFAULT_PORT, PROTOCOL_VERSION, STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { EXTENSION_DIST, EXTENSION_VERSION, requireFreeBridge, serveFixtures, startAgent, type Agent, type BridgeStatus, type Tab } from '../harness.ts';
import { startSafariSession, type SafariSession } from './webdriver.ts';

const CONNECT_TIMEOUT_MS = 60_000;
const IDLE_MS = 75_000;
const PROBE_MS = 20_000;

const EXTENSION_PAGE_PROBE = `
  const done = arguments[arguments.length - 1];
  const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('no answer after ' + ms + ' ms'), ms))]);
  const attempt = async (run) => {
    try {
      return await within(run(), 6000);
    } catch (error) {
      return 'threw ' + error;
    }
  };
  const socketResult = (url) =>
    new Promise((resolve) => {
      try {
        const socket = new WebSocket(url);
        socket.onopen = () => {
          resolve('open');
          socket.close();
        };
        socket.onerror = () => resolve('error');
        socket.onclose = (event) => resolve('closed with ' + event.code + ' ' + event.reason);
        setTimeout(() => resolve('no result after 5000 ms'), 5000);
      } catch (error) {
        resolve('threw ' + error);
      }
    });
  (async () => {
    const report = { href: location.href };
    report.backgroundLog = await attempt(() => chrome.runtime.sendMessage({ type: 'PROBE_LOG' }));
    report.backgroundStatus = await attempt(() => chrome.runtime.sendMessage({ type: 'GET_STATUS' }));
    report.permissions = await attempt(() => chrome.permissions.getAll());
    report.pageWebSocket = await socketResult('ws://127.0.0.1:${DEFAULT_PORT}');
    report.pageFetch = await attempt(() => fetch('http://127.0.0.1:${DEFAULT_PORT}/', { mode: 'no-cors' }).then((response) => 'answered ' + response.type));
    report.tabs = await attempt(() => chrome.tabs.query({}));
    done(report);
  })().catch((error) => done({ probeError: String(error) }));
`;

let agent: Agent;
let safari: SafariSession;
let fixtures: Server;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const fixture = (name: string) => `http://127.0.0.1:${(fixtures.address() as { port: number }).port}/${name}`;
const listTabs = (filter: Record<string, unknown> = {}) => agent.call<Tab[]>('safari_tabs_list', filter);
const openTab = (name: string) => agent.call<Tab>('safari_tabs_create', { url: fixture(name) });

function listenForBeacons(): Promise<{ port: number; received: string[]; close(): Promise<void> }> {
  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(decodeURIComponent(request.url ?? ''));
    response.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }).end('<title>beacon</title>');
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({
        port: (server.address() as { port: number }).port,
        received,
        close: () => new Promise((closed) => server.close(() => closed())),
      }),
    ),
  );
}

function instrumentedExtension(beaconPort: number) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-safari-probe-'));
  cpSync(EXTENSION_DIST, directory, { recursive: true });
  const background = join(directory, 'background.js');
  const prelude = `
    const probeLog = [];
    const note = (stage, detail) => probeLog.push([Date.now(), stage, detail === undefined ? null : detail]);
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message && message.type === 'PROBE_LOG') respond(probeLog);
      return false;
    });
    self.addEventListener('error', (event) => note('error-event', String(event.message)));
    self.addEventListener('unhandledrejection', (event) => note('unhandled-rejection', String(event.reason)));
    note('start', { url: chrome.runtime.getURL(''), context: typeof ServiceWorkerGlobalScope === 'undefined' ? 'page' : 'service worker' });
    chrome.tabs
      .create({ url: 'http://127.0.0.1:${beaconPort}/beacon?base=' + encodeURIComponent(chrome.runtime.getURL('')), active: false })
      .then(() => note('beacon-tab', 'opened'), (error) => note('beacon-tab', String(error)));
    fetch('http://127.0.0.1:${beaconPort}/beacon?via=fetch', { mode: 'no-cors' }).then(
      (response) => note('fetch', 'answered ' + response.type),
      (error) => note('fetch', String(error)),
    );
    try {
      const socket = new WebSocket('ws://127.0.0.1:${DEFAULT_PORT}');
      socket.onopen = () => note('websocket', 'open');
      socket.onerror = () => note('websocket', 'error');
      socket.onclose = (event) => note('websocket', 'closed with ' + event.code + ' ' + event.reason);
    } catch (error) {
      note('websocket', 'threw ' + error);
    }
    try {
  `;
  const epilogue = `
      note('end', 'the background script ran to its last line');
    } catch (error) {
      note('threw', { message: String(error), stack: String(error && error.stack) });
    }
  `;
  writeFileSync(background, `${prelude}\n${readFileSync(background, 'utf-8')}\n${epilogue}`);
  return directory;
}

function listenForConnectionAttempts(ms: number) {
  const attempts: Array<{ origin: string; userAgent: string | undefined; messages: string[] }> = [];
  const server = new WebSocketServer({ port: DEFAULT_PORT, host: '127.0.0.1' });
  server.on('connection', (socket, request) => {
    const attempt = { origin: String(request.headers.origin), userAgent: request.headers['user-agent'], messages: [] as string[] };
    attempts.push(attempt);
    socket.on('message', (data) => attempt.messages.push(String(data)));
  });
  return new Promise<typeof attempts>((done) => {
    setTimeout(() => {
      for (const client of server.clients) client.terminate();
      server.close(() => done(attempts));
    }, ms);
  });
}

async function describeSafari(beacons: string[]) {
  const base = beacons.map((beacon) => /[?&]base=([^&]+)/.exec(beacon)?.[1]).find((found) => found !== undefined);
  if (!base) {
    console.log(`The background script did not report its address. Safari pages: ${JSON.stringify(await safari.pages())}`);
    return;
  }
  console.log(`Opening ${base}src/welcome/index.html: ${await safari.open(`${base}src/welcome/index.html`)}`);
  const pages = await safari.pages();
  console.log(`Safari pages: ${JSON.stringify(pages)}`);
  for (const page of pages.filter((candidate) => candidate.url.startsWith('safari-web-extension://'))) {
    const report = await safari.runInPage(page.handle, EXTENSION_PAGE_PROBE).catch((error: unknown) => `probe failed: ${String(error)}`);
    console.log(`Extension page probe: ${JSON.stringify(report, null, 1)}`);
  }
}

async function safariConnected(timeoutMs: number): Promise<BridgeStatus> {
  const started = Date.now();
  for (;;) {
    const status = await agent.call<BridgeStatus>(STATUS_TOOL);
    if (status.browsers.some((browser) => browser.browser === 'safari')) {
      console.log(`Safari connected after ${Date.now() - started} ms`);
      return status;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Safari did not connect within ${timeoutMs} ms: ${JSON.stringify(status)}\nsafaridriver output: ${safari?.driverOutput()}`);
    }
    await sleep(500);
  }
}

beforeAll(async () => {
  await requireFreeBridge();
  fixtures = await serveFixtures();
  safari = await startSafariSession();
  console.log(`Safari session capabilities: ${JSON.stringify(safari.capabilities)}`);
  const beacons = await listenForBeacons();
  const probeExtension = instrumentedExtension(beacons.port);
  const listening = listenForConnectionAttempts(PROBE_MS);
  console.log(`Loaded the instrumented extension: ${JSON.stringify(await safari.loadExtension(probeExtension))}`);
  console.log(`Connection attempts in the first ${PROBE_MS} ms: ${JSON.stringify(await listening)}`);
  console.log(`Beacons from the background script:\n${beacons.received.join('\n') || 'none'}`);
  await describeSafari(beacons.received).catch((error: unknown) => console.log(`Could not describe Safari: ${String(error)}`));
  await beacons.close();
  rmSync(probeExtension, { recursive: true, force: true });
  agent = await startAgent();
  await safariConnected(CONNECT_TIMEOUT_MS);
});

afterAll(async () => {
  await safari?.close();
  await agent?.close();
  await new Promise((done) => (fixtures ? fixtures.close(done) : done(undefined)));
});

describe('the built extension in real Safari', () => {
  it('connects to the packaged server as Safari', async () => {
    const status = await agent.call<BridgeStatus>(STATUS_TOOL);
    console.log(`Bridge status: ${JSON.stringify(status)}`);
    expect(status.browsers).toMatchObject([
      { browser: 'safari', label: 'Safari', extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION },
    ]);
    expect(status.browsers[0]!.userAgent).toMatch(/Version\/[\d.]+ Safari\//);
  });

  it('lists windows and tabs', async () => {
    const windows = await agent.call<Array<{ id: number; tabCount: number }>>('safari_windows_list');
    console.log(`Windows: ${JSON.stringify(windows)}`);
    expect(windows.length).toBeGreaterThan(0);
    const tabs = await listTabs();
    console.log(`Tabs: ${JSON.stringify(tabs)}`);
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('opens a tab, waits for it to load, and reads its title and URL', async () => {
    const opened = await openTab('second.html');
    console.log(`Opened: ${JSON.stringify(opened)}`);
    expect(opened).toMatchObject({ url: fixture('second.html'), loaded: true });
    const listed = (await listTabs()).find((tab) => tab.id === opened.id);
    expect(listed).toMatchObject({ url: fixture('second.html'), title: 'Second page' });
    await agent.call('safari_tabs_close', { tabIds: [opened.id] });
  });

  it('navigates, reloads and steps through history', async () => {
    const { id: tabId } = await openTab('second.html');
    const navigate = (to: string) => agent.call<Tab>('safari_tabs_navigate', { tabId, to });

    expect(await navigate(fixture('form.html'))).toMatchObject({ url: fixture('form.html'), loaded: true });
    expect(await navigate('back')).toMatchObject({ url: fixture('second.html'), loaded: true });
    expect(await navigate('forward')).toMatchObject({ url: fixture('form.html'), loaded: true });
    expect(await navigate('reload')).toMatchObject({ url: fixture('form.html'), loaded: true });

    await agent.call('safari_tabs_close', { tabIds: [tabId] });
  });

  it('moves and closes tabs', async () => {
    const first = await openTab('second.html');
    const second = await openTab('form.html');

    const moved = await agent.call<Tab[]>('safari_tabs_move', { tabIds: [second.id], index: 0 });
    console.log(`Moved: ${JSON.stringify(moved)}`);
    expect(moved).toMatchObject([{ id: second.id, index: 0 }]);

    expect(await agent.call('safari_tabs_close', { tabIds: [first.id, second.id] })).toEqual({ closed: [first.id, second.id] });
    const remaining = (await listTabs()).map((tab) => tab.id);
    expect(remaining).not.toContain(first.id);
    expect(remaining).not.toContain(second.id);
  });

  it('still answers after Safari has sat idle', { timeout: IDLE_MS + CONNECT_TIMEOUT_MS + 30_000 }, async () => {
    await sleep(IDLE_MS);
    const status = await agent.call<BridgeStatus>(STATUS_TOOL);
    console.log(`After ${IDLE_MS} ms idle: ${JSON.stringify(status)}`);
    await safariConnected(CONNECT_TIMEOUT_MS);
    expect((await listTabs()).length).toBeGreaterThan(0);
  });

  it('reconnects to a new agent session', { timeout: CONNECT_TIMEOUT_MS + 30_000 }, async () => {
    await agent.close();
    agent = await startAgent();
    await safariConnected(CONNECT_TIMEOUT_MS);
    expect((await listTabs()).length).toBeGreaterThan(0);
  });
});
