import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { browserApis, browserLabels, browsers, browserToolName, SERVER_NAME, STATUS_TOOL, toolDefinitions } from '@agent-browser-bridge/protocol';
import type { BridgeStatus, ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

const LISTENING: BridgeStatus = { state: 'listening', role: 'host', port: 17373, browsers: [] };
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect(request: (browser: string, method: string, params: unknown) => Promise<unknown> = async () => null) {
  const bridge = { status: () => LISTENING, request: vi.fn(request) };
  const server = createMcpServer(bridge as unknown as ExtensionBridge, '1.2.3');
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(() => client.close());
  return { client, bridge };
}

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
const contentOf = (result: unknown) => (result as { content: Content }).content;

describe('createMcpServer', () => {
  it('identifies itself and explains how to use the browser', async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: '1.2.3' });
    expect(client.getInstructions()).toContain('chrome_snapshot_page');
  });

  it('registers the status tool plus one tool per browser method', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const expected = [STATUS_TOOL, ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method)))];
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('publishes each description and its params plus the instance selector', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const browser of browsers) {
      for (const method of browserApis[browser]) {
        const def = toolDefinitions[method];
        const tool = tools.find((t) => t.name === browserToolName(browser, method))!;
        expect(tool.description).toBe(`${browserLabels[browser]}: ${def.description}`);
        expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual([...Object.keys(def.params.shape), 'instance'].sort());
      }
    }
    expect(tools.find((t) => t.name === 'chrome_click')!.inputSchema.required).toEqual(['tabId']);
  });

  it('marks read-only, destructive and open-world tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const annotations = (name: string) => tools.find((t) => t.name === name)!.annotations;
    expect(annotations(STATUS_TOOL)).toMatchObject({ readOnlyHint: true });
    expect(annotations('chrome_list_tabs')).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(annotations('chrome_close_tabs')).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(annotations('chrome_group_tabs')).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(annotations('chrome_open_tab')).toMatchObject({ openWorldHint: true });
    expect(annotations('chrome_navigate')).toMatchObject({ openWorldHint: true });
    expect(annotations('chrome_restore_session')).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(annotations('chrome_search_history')).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(annotations('chrome_close_window')).toMatchObject({ destructiveHint: true, openWorldHint: false });
    expect(annotations('chrome_snapshot_page')).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(annotations('chrome_cdp_send')).toMatchObject({ destructiveHint: true, openWorldHint: true });
  });

  it('reports the bridge status as JSON', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: STATUS_TOOL, arguments: {} });
    expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual(LISTENING);
  });

  it('forwards calls to the bridge with defaults applied and returns JSON', async () => {
    const { client, bridge } = await connect(async () => [{ id: 7, title: 'Docs' }]);
    const result = await client.callTool({ name: 'chrome_apply_tab_plan', arguments: { groups: [{ title: 'Docs', tabIds: [7] }] } });
    expect(bridge.request).toHaveBeenCalledWith(
      'chrome',
      'plan.apply',
      { groups: [{ title: 'Docs', tabIds: [7] }], ungroupTabIds: [], dryRun: false },
      undefined,
      undefined,
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual([{ id: 7, title: 'Docs' }]);
  });

  it('routes each call to its browser and chosen instance', async () => {
    const { client, bridge } = await connect(async () => []);
    await client.callTool({ name: 'safari_list_tabs', arguments: { windowId: 2, instance: 'work' } });
    expect(bridge.request).toHaveBeenCalledWith('safari', 'tabs.list', { windowId: 2 }, undefined, 'work');
  });

  it('returns snapshots as plain text', async () => {
    const { client } = await connect(async () => 'Page: Docs\n- button "Go" [ref=e1]');
    const result = await client.callTool({ name: 'chrome_snapshot_page', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'text', text: 'Page: Docs\n- button "Go" [ref=e1]' }]);
  });

  it('returns screenshots as image content', async () => {
    const { client } = await connect(async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }));
    const result = await client.callTool({ name: 'chrome_screenshot', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
  });

  it('turns bridge failures into error results', async () => {
    const { client } = await connect(async () => {
      throw new Error('extension is not connected');
    });
    const result = await client.callTool({ name: 'chrome_list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(contentOf(result)[0]!.text).toBe('extension is not connected');
  });

  it('rejects invalid arguments without reaching the bridge', async () => {
    const { client, bridge } = await connect();
    const outcome = await client.callTool({ name: 'chrome_close_tabs', arguments: { tabIds: [] } }).then(
      (result) => ({ failed: result.isError === true, message: contentOf(result)[0]?.text ?? '' }),
      (error: Error) => ({ failed: true, message: error.message }),
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.message).toMatch(/tabIds/);
    expect(bridge.request).not.toHaveBeenCalled();
  });
});
