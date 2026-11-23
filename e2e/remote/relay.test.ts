import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { startHarness, type BridgeStatus, type Harness, type Tab } from '../support/harness.ts';

const RELAY_ENTRY = resolve(import.meta.dirname, '../../packages/server/dist/index.js');

let harness: Harness;
let relay: ChildProcess;
let relayUrl: string;
let page: Page;
let firstToken: string;
const agents: Client[] = [];

function startRelay(): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [RELAY_ENTRY, 'http', '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((done, fail) => {
    let output = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Relay listening on (http:\/\/[\d.]+:\d+)/.exec(output);
      if (match) done({ process: child, url: match[1]! });
    });
    child.once('exit', (code) => fail(new Error(`Relay exited with ${code}: ${output}`)));
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

async function createToken(name: string) {
  await page.fill('#remote-token-name', name);
  await page.click('#remote-new-token button[type="submit"]');
  await page.waitForSelector('#remote-created:not([hidden])');
  const command = await page.textContent('#remote-claude-code');
  const token = /Bearer (abb_\S+)"/.exec(command ?? '')?.[1];
  if (!token) throw new Error(`No token in ${command}`);
  return { token, command: command! };
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
  it('connects the browser to the relay from the setup page', async () => {
    await page.check('#remote-enabled');
    await page.fill('#remote-address', relayUrl);
    await page.press('#remote-address', 'Tab');
    await page.waitForSelector('#remote-status[data-state="connected"]');
    expect(await page.textContent('#remote-status-text')).toBe('Connected to the relay');
    expect(await page.isVisible('#remote-privacy')).toBe(true);
    expect(await page.textContent('#remote-privacy')).toContain(new URL(relayUrl).host);
  });

  it('lets an agent with a new token use this browser', async () => {
    const { token, command } = await createToken('Cloud agent');
    firstToken = token;
    expect(command).toContain(`--transport http agent-browser-bridge-remote ${relayUrl}/mcp`);
    const opened = await harness.openFixture('second.html');

    const agent = await connectRemoteAgent(token);
    const status = await agent.call<BridgeStatus>(STATUS_TOOL);
    expect(status.browsers).toHaveLength(1);
    const tabs = await agent.call<Tab[]>('chrome_tabs_list');
    expect(tabs.map((tab) => tab.id)).toContain(opened.id);

    await page.waitForSelector('#remote-agents:not([hidden]) .session');
    expect(await page.textContent('#remote-agents')).toContain('e2e-remote');
    expect(await page.textContent('#remote-tokens')).toContain('Cloud agent');
  });

  it('cuts the agent off when its token is revoked', async () => {
    const { token } = await createToken('Short lived');
    const agent = await connectRemoteAgent(token);
    await agent.call(STATUS_TOOL);

    await page.click('#remote-tokens .token:has-text("Short lived") button');
    await expect.poll(() => page.textContent('#remote-tokens')).not.toContain('Short lived');
    await expect(agent.call('chrome_tabs_list')).rejects.toThrow();
    await expect(connectRemoteAgent(token)).rejects.toThrow();
  });

  it('disconnects from the relay when switched off', async () => {
    await page.uncheck('#remote-enabled');
    expect(await page.isHidden('#remote-body')).toBe(true);
    expect(await page.isHidden('#remote-privacy')).toBe(true);
    const agent = await connectRemoteAgent(firstToken);
    await expect.poll(async () => (await agent.call<BridgeStatus>(STATUS_TOOL)).browsers).toEqual([]);
  });
});
