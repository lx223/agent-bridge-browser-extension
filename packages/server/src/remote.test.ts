import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  newRemoteKey,
  newRemoteToken,
  PROTOCOL_VERSION,
  REMOTE_UNAUTHORIZED_CLOSE_CODE,
  remoteSpaceId,
  remoteTokenHash,
  STATUS_TOOL,
} from '@agent-browser-bridge/protocol';
import { parseHttpArgs, RemoteServer } from './remote.ts';

let relay: RemoteServer | undefined;
const cleanups: Array<() => Promise<unknown> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await relay?.stop();
  relay = undefined;
});

async function startRelay(opts: Partial<ConstructorParameters<typeof RemoteServer>[0]> = {}) {
  relay = new RemoteServer({ port: 0, host: '127.0.0.1', version: '9.9.9', ...opts });
  return relay.start();
}

interface FakeBrowser {
  ws: WebSocket;
  requests: Array<{ method: string; agent?: { client?: { name: string } | null } }>;
  agents: Array<Array<{ client: { name: string } | null }>>;
  setTokens(tokens: string[]): Promise<void>;
}

async function connectBrowser(port: number, key: string, tokens: string[], instanceId = 'profile-1'): Promise<FakeBrowser> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  cleanups.push(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const browser: FakeBrowser = {
    ws,
    requests: [],
    agents: [],
    setTokens: async (next) => {
      ws.send(JSON.stringify({ type: 'remoteTokens', tokens: await Promise.all(next.map(remoteTokenHash)) }));
    },
  };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'agents') browser.agents.push(msg.agents);
    if (msg.type !== 'request') return;
    browser.requests.push(msg);
    const result = msg.method === 'tabs.list' ? [{ id: 1, windowId: 1, title: 'Remote tab', url: 'https://example.com/' }] : null;
    ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result }));
  });
  ws.send(JSON.stringify({ type: 'remoteAuth', key, tokens: await Promise.all(tokens.map(remoteTokenHash)) }));
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.8.0', userAgent: 'test', browser: 'chrome', instanceId }));
  await expect.poll(() => relay!.stats().browsers).toBeGreaterThan(0);
  return browser;
}

async function connectAgent(port: number, token: string | undefined, name = 'remote-agent') {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
  });
  await client.connect(transport);
  cleanups.push(() => client.close().catch(() => undefined));
  return client;
}

const textOf = (result: unknown) => ((result as { content: Array<{ text?: string }> }).content[0]?.text ?? '');

async function space() {
  const key = newRemoteKey();
  const id = await remoteSpaceId(key);
  return { key, token: newRemoteToken(id) };
}

describe('RemoteServer', () => {
  it('lets an agent with a token use the browser that issued it', async () => {
    const port = await startRelay();
    const { key, token } = await space();
    const browser = await connectBrowser(port, key, [token]);
    const agent = await connectAgent(port, token);

    const result = await agent.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(textOf(result)).toContain('Remote tab');
    expect(browser.requests.at(-1)).toMatchObject({ method: 'tabs.list', agent: { client: { name: 'remote-agent' } } });
  });

  it('shows the agent session to the browser', async () => {
    const port = await startRelay();
    const { key, token } = await space();
    const browser = await connectBrowser(port, key, [token]);
    await connectAgent(port, token, 'cloud-agent');
    await expect.poll(() => browser.agents.at(-1)?.map((agent) => agent.client?.name)).toEqual(['cloud-agent']);
  });

  it('keeps spaces apart', async () => {
    const port = await startRelay();
    const first = await space();
    const second = await space();
    await connectBrowser(port, first.key, [first.token]);
    const agent = await connectAgent(port, second.token);

    const status = JSON.parse(textOf(await agent.callTool({ name: STATUS_TOOL, arguments: {} })));
    expect(status.browsers).toEqual([]);
    const result = await agent.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/remote access/);
  });

  it('rejects agents without a well-formed token', async () => {
    const port = await startRelay();
    await expect(connectAgent(port, undefined)).rejects.toThrow();
    await expect(connectAgent(port, 'abb_not_a_token')).rejects.toThrow();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('rejects tokens the connected browser does not list', async () => {
    const port = await startRelay();
    const { key, token } = await space();
    const other = newRemoteToken(await remoteSpaceId(key));
    await connectBrowser(port, key, [token]);
    await expect(connectAgent(port, other)).rejects.toThrow();
  });

  it('ends sessions when their token is revoked', async () => {
    const port = await startRelay();
    const { key, token } = await space();
    const browser = await connectBrowser(port, key, [token]);
    const agent = await connectAgent(port, token);
    await expect.poll(() => relay!.stats().sessions).toBe(1);

    await browser.setTokens([]);
    await expect.poll(() => relay!.stats().sessions).toBe(0);
    await expect(agent.callTool({ name: 'chrome_tabs_list', arguments: {} })).rejects.toThrow();
  });

  it('accepts agents while the browser is offline and reports it as not connected', async () => {
    const port = await startRelay();
    const { token } = await space();
    const agent = await connectAgent(port, token);
    const result = await agent.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No chrome browser is connected to this relay/);
  });

  it('closes browser connections that do not authenticate first', async () => {
    const port = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
    cleanups.push(() => ws.terminate());
    await new Promise((resolve) => ws.once('open', resolve));
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.8.0', userAgent: 'test' }));
    expect(await closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
  });

  it('closes browser connections that stay silent', async () => {
    const port = await startRelay({ authTimeoutMs: 20 });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
    cleanups.push(() => ws.terminate());
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    expect(await closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
  });

  it('refuses sockets on other paths and answers health checks', async () => {
    const port = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/elsewhere`);
    await expect(new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))).rejects.toThrow(/404/);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await health.json()).toEqual({ ok: true, version: '9.9.9' });
    expect((await fetch(`http://127.0.0.1:${port}/nowhere`)).status).toBe(404);
  });

  it('routes several profiles sharing a key', async () => {
    const port = await startRelay();
    const { key, token } = await space();
    await connectBrowser(port, key, [token], 'work');
    await connectBrowser(port, key, [], 'personal');
    const agent = await connectAgent(port, token);
    const status = JSON.parse(textOf(await agent.callTool({ name: STATUS_TOOL, arguments: {} })));
    expect(status.browsers.map((hello: { instanceId: string }) => hello.instanceId).sort()).toEqual(['personal', 'work']);
  });

  it('limits browsers per key', async () => {
    const port = await startRelay({ maxBrowsersPerSpace: 1 });
    const { key, token } = await space();
    await connectBrowser(port, key, [token], 'one');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
    cleanups.push(() => ws.terminate());
    await new Promise((resolve) => ws.once('open', resolve));
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ type: 'remoteAuth', key, tokens: [] }));
    expect(await closed).toBe(4004);
  });

  it('ends idle sessions and forgets empty spaces', async () => {
    const port = await startRelay({ sessionIdleMs: 0, sweepIntervalMs: 20 });
    const { token } = await space();
    await connectAgent(port, token);
    await expect.poll(() => relay!.stats()).toEqual({ spaces: 0, browsers: 0, sessions: 0 });
  });
});

describe('parseHttpArgs', () => {
  it('reads defaults from the environment', () => {
    expect(parseHttpArgs([], {})).toEqual({ port: 8080, host: '127.0.0.1' });
    expect(parseHttpArgs([], { PORT: '9000', HOST: '0.0.0.0' })).toEqual({ port: 9000, host: '0.0.0.0' });
  });

  it('reads flags in both forms', () => {
    expect(parseHttpArgs(['--port', '1234', '--host=::'], {})).toEqual({ port: 1234, host: '::' });
  });

  it('rejects bad input', () => {
    expect(() => parseHttpArgs(['--port', 'abc'], {})).toThrow(/Invalid port/);
    expect(() => parseHttpArgs(['--verbose'], {})).toThrow(/Unknown option/);
    expect(() => parseHttpArgs(['--port'], {})).toThrow(/needs a value/);
  });
});
