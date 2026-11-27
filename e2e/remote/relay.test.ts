import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_TOKEN_ENV, BROWSER_TOKEN_ENV, newRemoteToken, STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { startHarness, type BridgeStatus, type Harness, type Tab } from '../support/harness.ts';

const RELAY_ENTRY = resolve(import.meta.dirname, '../../packages/server/dist/index.js');
const AGENT_TOKEN = newRemoteToken();
const BROWSER_TOKEN = newRemoteToken();

let harness: Harness;
let relay: ChildProcess;
let relayUrl: string;
let relayLog = '';
let page: Page;
const agents: Client[] = [];

function startRelay(): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [RELAY_ENTRY, 'http', '--port', '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, [AGENT_TOKEN_ENV]: AGENT_TOKEN, [BROWSER_TOKEN_ENV]: BROWSER_TOKEN },
  });
  return new Promise((done, fail) => {
    child.stderr!.on('data', (chunk: Buffer) => {
      relayLog += chunk.toString();
      const match = /Relay listening on (http:\/\/[\d.]+:\d+)/.exec(relayLog);
      if (match) done({ process: child, url: match[1]! });
    });
    child.once('exit', (code) => fail(new Error(`Relay exited with ${code}: ${relayLog}`)));
  });
}

async function connectRemoteAgent(token: string) {
  const client = new Client({ name: 'e2e-remote', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${relayUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  agents.push(client);
  const call = async <T>(name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    if (result.isError) throw new Error(`${name} failed: ${text}`);
    return JSON.parse(text) as T;
  };
  return { client, call };
}

async function enterToken(token: string) {
  await page.fill('#remote-browser-token', token);
  await page.press('#remote-browser-token', 'Tab');
}

beforeAll(async () => {
  const started = await startRelay();
  relay = started.process;
  relayUrl = started.url;
  harness = await startHarness();
  page = await harness.context.newPage();
  await page.goto(`chrome-extension://${harness.extensionId}/src/welcome/index.html`);
});

afterAll(async () => {
  await Promise.all(agents.map((agent) => agent.close().catch(() => {})));
  await harness?.close();
  relay?.kill();
});

describe('remote access through a relay', () => {
  it('refuses to start the relay without two strong, different tokens', async () => {
    const child = spawn(process.execPath, [RELAY_ENTRY, 'http', '--port', '0'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, [AGENT_TOKEN_ENV]: AGENT_TOKEN, [BROWSER_TOKEN_ENV]: AGENT_TOKEN },
    });
    let output = '';
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise((done) => child.once('exit', done));
    expect(code).toBe(2);
    expect(output).toContain('must be different');
  });

  it('shows that the relay rejects a wrong browser token', async () => {
    await page.check('#remote-enabled');
    await page.fill('#remote-address', relayUrl);
    await page.press('#remote-address', 'Tab');
    expect(await page.textContent('#remote-status-text')).toBe('Enter the browser token to connect.');
    await enterToken(newRemoteToken());
    await page.waitForSelector('#remote-status[data-state="problem"]');
    expect(await page.textContent('#remote-status-text')).toMatch(/didn't accept this browser token/);
  });

  it('connects with the right browser token without sending it', async () => {
    await enterToken(BROWSER_TOKEN);
    await page.waitForSelector('#remote-status[data-state="connected"]');
    expect(await page.textContent('#remote-status-text')).toBe('Connected to the relay');
    expect(await page.getAttribute('#remote-browser-token', 'type')).toBe('password');
    expect(await page.isVisible('#remote-privacy')).toBe(true);
    expect(await page.textContent('#remote-privacy')).toContain(new URL(relayUrl).host);
    expect(relayLog).not.toContain(BROWSER_TOKEN);
  });

  it('shows how to add the relay to an agent without either token', async () => {
    const command = await page.textContent('#remote-claude-code');
    expect(command).toContain(`--transport http agent-browser-bridge-remote ${relayUrl}/mcp`);
    expect(command).toContain('$AGENT_BROWSER_BRIDGE_AGENT_TOKEN');
    expect(await page.content()).not.toContain(AGENT_TOKEN);
  });

  it('lets an agent with the agent token use this browser', async () => {
    const opened = await harness.openFixture('second.html');
    const agent = await connectRemoteAgent(AGENT_TOKEN);
    const status = await agent.call<BridgeStatus>(STATUS_TOOL);
    expect(status.browsers).toHaveLength(1);
    const tabs = await agent.call<Tab[]>('chrome_tabs_list');
    expect(tabs.map((tab) => tab.id)).toContain(opened.id);

    await page.waitForSelector('#remote-agents:not([hidden]) .session');
    expect(await page.textContent('#remote-agents')).toContain('e2e-remote');
  });

  it('turns away agents with the browser token or a wrong token', async () => {
    await expect(connectRemoteAgent(BROWSER_TOKEN)).rejects.toThrow();
    await expect(connectRemoteAgent(newRemoteToken())).rejects.toThrow();
    expect(relayLog).toMatch(/Rejected an agent/);
    expect(relayLog).not.toContain(AGENT_TOKEN);
  });

  it('disconnects from the relay when switched off', async () => {
    await page.uncheck('#remote-enabled');
    expect(await page.isHidden('#remote-body')).toBe(true);
    expect(await page.isHidden('#remote-privacy')).toBe(true);
    const agent = await connectRemoteAgent(AGENT_TOKEN);
    await expect.poll(async () => (await agent.call<BridgeStatus>(STATUS_TOOL)).browsers).toEqual([]);
  });
});
