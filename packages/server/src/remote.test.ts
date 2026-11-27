import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AGENT_TOKEN_ENV,
  BROWSER_TOKEN_ENV,
  newRemoteNonce,
  newRemoteToken,
  PROTOCOL_VERSION,
  REMOTE_FULL_CLOSE_CODE,
  REMOTE_UNAUTHORIZED_CLOSE_CODE,
  remoteProof,
  STATUS_TOOL,
} from '@agent-browser-bridge/protocol';
import { defaultFailureDelayMs, loadTokens, parseHttpArgs, readSecret, RemoteServer, sameSecret, tokensOutput } from './remote.ts';

const AGENT_TOKEN = newRemoteToken();
const BROWSER_TOKEN = newRemoteToken();
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

let relay: RemoteServer | undefined;
const cleanups: Array<() => Promise<unknown> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await relay?.stop();
  relay = undefined;
});

type Options = ConstructorParameters<typeof RemoteServer>[0];

async function startRelay(opts: Partial<Options> = {}) {
  relay = new RemoteServer({
    port: 0,
    host: '127.0.0.1',
    version: '9.9.9',
    agentToken: AGENT_TOKEN,
    browserToken: BROWSER_TOKEN,
    failureDelayMs: () => 0,
    ...opts,
  });
  return relay.start();
}

function openSocket(port: number, origin: string | null = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, origin ? { origin } : {});
  cleanups.push(() => ws.terminate());
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    waiters.splice(0).forEach((wake) => wake());
  });
  const next = async (type: string) => {
    for (;;) {
      const found = messages.find((message) => message.type === type);
      if (found) return found;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages, next, closed, opened };
}

interface FakeBrowser {
  ws: WebSocket;
  requests: Array<{ method: string; agent?: { client?: { name: string } | null } }>;
  agents: Array<Array<{ client: { name: string } | null }>>;
}

async function connectBrowser(port: number, token = BROWSER_TOKEN, instanceId = 'profile-1'): Promise<FakeBrowser> {
  const socket = openSocket(port);
  await socket.opened;
  const challenge = await socket.next('remoteChallenge');
  const nonce = newRemoteNonce();
  socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof: await remoteProof(token, { role: 'browser', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: nonce }) }));
  const welcome = await socket.next('remoteWelcome');
  expect(welcome.proof).toBe(await remoteProof(token, { role: 'relay', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: nonce }));
  const browser: FakeBrowser = { ws: socket.ws, requests: [], agents: [] };
  socket.ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'agents') browser.agents.push(msg.agents);
    if (msg.type !== 'request') return;
    browser.requests.push(msg);
    const result = msg.method === 'tabs.list' ? [{ id: 1, windowId: 1, title: 'Remote tab', url: 'https://example.com/' }] : null;
    socket.ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result }));
  });
  socket.ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.8.0', userAgent: 'test', browser: 'chrome', instanceId }));
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

const textOf = (result: unknown) => (result as { content: Array<{ text?: string }> }).content[0]?.text ?? '';

describe('RemoteServer', () => {
  it('refuses to start with weak or shared tokens', () => {
    const base = { port: 0, host: '127.0.0.1', version: '1' };
    expect(() => new RemoteServer({ ...base, agentToken: 'short', browserToken: BROWSER_TOKEN })).toThrow(/agent token is shorter/);
    expect(() => new RemoteServer({ ...base, agentToken: AGENT_TOKEN, browserToken: '' })).toThrow(/browser token is not set/);
    expect(() => new RemoteServer({ ...base, agentToken: AGENT_TOKEN, browserToken: AGENT_TOKEN })).toThrow(/must be different/);
  });

  it('lets an agent with the agent token use the browser', async () => {
    const port = await startRelay();
    const browser = await connectBrowser(port);
    const agent = await connectAgent(port, AGENT_TOKEN);

    const result = await agent.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(textOf(result)).toContain('Remote tab');
    expect(browser.requests.at(-1)).toMatchObject({ method: 'tabs.list', agent: { client: { name: 'remote-agent' } } });
  });

  it('shows agent sessions to the browser', async () => {
    const port = await startRelay();
    const browser = await connectBrowser(port);
    await connectAgent(port, AGENT_TOKEN, 'cloud-agent');
    await expect.poll(() => browser.agents.at(-1)?.map((agent) => agent.client?.name)).toEqual(['cloud-agent']);
  });

  it('rejects agents without the agent token', async () => {
    const port = await startRelay();
    await expect(connectAgent(port, undefined)).rejects.toThrow();
    await expect(connectAgent(port, BROWSER_TOKEN)).rejects.toThrow();
    await expect(connectAgent(port, `${AGENT_TOKEN}x`)).rejects.toThrow();
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain(AGENT_TOKEN);
  });

  it('checks the agent token on every request, not only the first', async () => {
    const port = await startRelay();
    await connectAgent(port, AGENT_TOKEN);
    const sessionId = (await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
    })).headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    const hijack = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'mcp-session-id': sessionId!, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(hijack.status).toBe(401);
  });

  it('slows down repeated failures', async () => {
    const delays: number[] = [];
    const port = await startRelay({ failureDelayMs: (failures) => (delays.push(failures), 0) });
    for (let i = 0; i < 3; i++) await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    expect(delays).toEqual([1, 2, 3]);
    expect(defaultFailureDelayMs(1)).toBe(250);
    expect(defaultFailureDelayMs(3)).toBe(1_000);
    expect(defaultFailureDelayMs(100)).toBe(10_000);
  });

  it('drops failures beyond the number it is already delaying', async () => {
    const port = await startRelay({ failureDelayMs: () => 200, maxDelayedFailures: 1 });
    const first = fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' })).rejects.toThrow();
    expect((await first).status).toBe(401);
  });

  it('reports the browser as not connected until it joins', async () => {
    const port = await startRelay();
    const agent = await connectAgent(port, AGENT_TOKEN);
    const result = await agent.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No chrome browser is connected to this relay/);
  });

  it('never sends the browser token over the socket', async () => {
    const port = await startRelay();
    const socket = openSocket(port);
    await socket.opened;
    const challenge = await socket.next('remoteChallenge');
    expect(JSON.stringify(challenge)).not.toContain(BROWSER_TOKEN);
    const nonce = newRemoteNonce();
    socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof: await remoteProof(BROWSER_TOKEN, { role: 'browser', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: nonce }) }));
    await socket.next('remoteWelcome');
    expect(JSON.stringify(socket.messages)).not.toContain(BROWSER_TOKEN);
  });

  it('closes browsers that prove the wrong token', async () => {
    const port = await startRelay();
    const socket = openSocket(port);
    await socket.opened;
    const challenge = await socket.next('remoteChallenge');
    const nonce = newRemoteNonce();
    socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof: await remoteProof(AGENT_TOKEN, { role: 'browser', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: nonce }) }));
    expect(await socket.closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
    expect(socket.messages.map((message) => message.type)).toEqual(['remoteChallenge']);
    expect(relay!.stats().browsers).toBe(0);
  });

  it('rejects proofs made for another relay host, so a look-alike relay cannot pass a browser on', async () => {
    const port = await startRelay();
    const socket = openSocket(port);
    await socket.opened;
    const challenge = await socket.next('remoteChallenge');
    const nonce = newRemoteNonce();
    const proof = await remoteProof(BROWSER_TOKEN, { role: 'browser', relayHost: 'relay.lookalike.example', relayNonce: challenge.nonce as string, browserNonce: nonce });
    socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof }));
    expect(await socket.closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
  });

  it('proves the configured public host instead of the Host header', async () => {
    const port = await startRelay({ publicHost: 'relay.example.com' });
    const socket = openSocket(port);
    await socket.opened;
    const challenge = await socket.next('remoteChallenge');
    const nonce = newRemoteNonce();
    const input = { relayHost: 'relay.example.com', relayNonce: challenge.nonce as string, browserNonce: nonce };
    socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof: await remoteProof(BROWSER_TOKEN, { role: 'browser', ...input }) }));
    expect((await socket.next('remoteWelcome')).proof).toBe(await remoteProof(BROWSER_TOKEN, { role: 'relay', ...input }));
  });

  it('closes browsers that echo the challenge or skip authentication', async () => {
    const port = await startRelay();
    const echo = openSocket(port);
    await echo.opened;
    const challenge = await echo.next('remoteChallenge');
    echo.ws.send(JSON.stringify({ type: 'remoteAuth', nonce: challenge.nonce, proof: await remoteProof(BROWSER_TOKEN, { role: 'browser', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: challenge.nonce as string }) }));
    expect(await echo.closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);

    const skip = openSocket(port);
    await skip.opened;
    skip.ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, extensionVersion: '0.8.0', userAgent: 'test' }));
    expect(await skip.closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
  });

  it('closes browsers that stay silent', async () => {
    const port = await startRelay({ authTimeoutMs: 20 });
    const socket = openSocket(port);
    expect(await socket.closed).toBe(REMOTE_UNAUTHORIZED_CLOSE_CODE);
  });

  it('only accepts browser sockets from extension origins', async () => {
    const port = await startRelay();
    await expect(openSocket(port, 'https://evil.example').opened).rejects.toThrow(/403/);
    await expect(openSocket(port, null).opened).rejects.toThrow(/403/);
    await expect(openSocket(port, 'chrome-extension://').opened).rejects.toThrow(/403/);
    await openSocket(port, 'safari-web-extension://0A1B2C3D').opened;
  });

  it('pins the extension id when configured', async () => {
    const port = await startRelay({ extensionId: 'expected' });
    await expect(openSocket(port, ORIGIN).opened).rejects.toThrow(/403/);
    await openSocket(port, 'chrome-extension://expected').opened;
  });

  it('routes several browser profiles', async () => {
    const port = await startRelay();
    await connectBrowser(port, BROWSER_TOKEN, 'work');
    await connectBrowser(port, BROWSER_TOKEN, 'personal');
    const agent = await connectAgent(port, AGENT_TOKEN);
    const status = JSON.parse(textOf(await agent.callTool({ name: STATUS_TOOL, arguments: {} })));
    expect(status.browsers.map((hello: { instanceId: string }) => hello.instanceId).sort()).toEqual(['personal', 'work']);
  });

  it('limits connected browsers', async () => {
    const port = await startRelay({ maxBrowsers: 1 });
    await connectBrowser(port, BROWSER_TOKEN, 'one');
    const socket = openSocket(port);
    await socket.opened;
    const challenge = await socket.next('remoteChallenge');
    const nonce = newRemoteNonce();
    socket.ws.send(JSON.stringify({ type: 'remoteAuth', nonce, proof: await remoteProof(BROWSER_TOKEN, { role: 'browser', relayHost: `127.0.0.1:${port}`, relayNonce: challenge.nonce as string, browserNonce: nonce }) }));
    expect(await socket.closed).toBe(REMOTE_FULL_CLOSE_CODE);
  });

  it('ends idle sessions and makes room for new ones', async () => {
    const port = await startRelay({ sessionIdleMs: 0, sweepIntervalMs: 20 });
    await connectAgent(port, AGENT_TOKEN);
    await expect.poll(() => relay!.stats().sessions).toBe(0);
    await relay!.stop();
    const limited = await startRelay({ maxSessions: 1 });
    await connectAgent(limited, AGENT_TOKEN, 'first');
    await connectAgent(limited, AGENT_TOKEN, 'second');
    await expect.poll(() => relay!.stats().sessions).toBe(1);
  });

  it('answers health checks without details and refuses other paths', async () => {
    const port = await startRelay();
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await health.json()).toEqual({ ok: true });
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/elsewhere`, { origin: ORIGIN });
    await expect(new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))).rejects.toThrow(/404/);
  });
});

describe('secrets', () => {
  it('compares secrets of any length', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
  });

  it('reads tokens from the environment or from files', () => {
    const files: Record<string, string> = { '/run/secrets/agent': `${AGENT_TOKEN}\n` };
    const read = (path: string) => {
      if (!(path in files)) throw new Error('missing');
      return files[path]!;
    };
    expect(loadTokens({ [`${AGENT_TOKEN_ENV}_FILE`]: '/run/secrets/agent', [BROWSER_TOKEN_ENV]: BROWSER_TOKEN }, read)).toEqual({
      agentToken: AGENT_TOKEN,
      browserToken: BROWSER_TOKEN,
    });
    expect(() => readSecret({ X: 'a', X_FILE: 'b' }, 'X', read)).toThrow(/not both/);
    expect(() => readSecret({ X_FILE: '/nowhere' }, 'X', read)).toThrow(/Could not read X_FILE/);
  });

  it('explains missing, weak and shared tokens', () => {
    expect(() => loadTokens({})).toThrow(new RegExp(`${AGENT_TOKEN_ENV} is not set`));
    expect(() => loadTokens({ [AGENT_TOKEN_ENV]: AGENT_TOKEN, [BROWSER_TOKEN_ENV]: 'short' })).toThrow(/shorter than 32/);
    expect(() => loadTokens({ [AGENT_TOKEN_ENV]: AGENT_TOKEN, [BROWSER_TOKEN_ENV]: AGENT_TOKEN })).toThrow(/must be different/);
  });

  it('prints new tokens ready for the environment', () => {
    const output = tokensOutput();
    const env = Object.fromEntries(output.trim().split('\n').map((line) => line.split('=', 2) as [string, string]));
    expect(loadTokens(env)).toEqual({ agentToken: env[AGENT_TOKEN_ENV], browserToken: env[BROWSER_TOKEN_ENV] });
  });
});

describe('parseHttpArgs', () => {
  it('reads defaults from the environment', () => {
    expect(parseHttpArgs([], {})).toEqual({ port: 8080, host: '127.0.0.1' });
    expect(parseHttpArgs([], { PORT: '9000', HOST: '0.0.0.0', AGENT_BROWSER_BRIDGE_EXTENSION_ID: 'abc' })).toEqual({ port: 9000, host: '0.0.0.0', extensionId: 'abc' });
  });

  it('reads flags in both forms', () => {
    expect(parseHttpArgs(['--port', '1234', '--host=::', '--extension-id', 'xyz'], {})).toEqual({ port: 1234, host: '::', extensionId: 'xyz' });
    expect(parseHttpArgs(['--public-host', 'Relay.Example.com'], {})).toEqual({ port: 8080, host: '127.0.0.1', publicHost: 'relay.example.com' });
    expect(parseHttpArgs([], { AGENT_BROWSER_BRIDGE_PUBLIC_HOST: 'relay.example.com:8443' }).publicHost).toBe('relay.example.com:8443');
  });

  it('rejects bad input', () => {
    expect(() => parseHttpArgs(['--port', 'abc'], {})).toThrow(/Invalid port/);
    expect(() => parseHttpArgs(['--verbose'], {})).toThrow(/Unknown option/);
    expect(() => parseHttpArgs(['--port'], {})).toThrow(/needs a value/);
    expect(() => parseHttpArgs(['--public-host', 'https://relay.example.com'], {})).toThrow(/Invalid public host/);
  });
});
