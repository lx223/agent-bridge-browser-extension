import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { methods, SERVER_NAME, toolDefinitions } from '@agent-browser-bridge/protocol';
import type { BridgeStatus, ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

const LISTENING: BridgeStatus = { state: 'listening', role: 'host', port: 17373, extension: null };
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect(request: (method: string, params: unknown) => Promise<unknown> = async () => null) {
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
    expect(client.getInstructions()).toContain('snapshot_page');
  });

  it('registers the status tool plus one tool per protocol method', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_bridge_status', ...methods.map((m) => toolDefinitions[m].tool)].sort());
  });

  it('publishes each description and its required params', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const method of methods) {
      const def = toolDefinitions[method];
      const tool = tools.find((t) => t.name === def.tool)!;
      expect(tool.description).toBe(def.description);
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(Object.keys(def.params.shape).sort());
    }
    expect(tools.find((t) => t.name === 'click')!.inputSchema.required).toEqual(['tabId']);
  });

  it('marks read-only, destructive and open-world tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const annotations = (name: string) => tools.find((t) => t.name === name)!.annotations;
    expect(annotations('get_bridge_status')).toMatchObject({ readOnlyHint: true });
    expect(annotations('list_tabs')).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(annotations('close_tabs')).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(annotations('group_tabs')).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(annotations('open_tab')).toMatchObject({ openWorldHint: true });
    expect(annotations('navigate')).toMatchObject({ openWorldHint: true });
    expect(annotations('snapshot_page')).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(annotations('cdp_send')).toMatchObject({ destructiveHint: true, openWorldHint: true });
  });

  it('reports the bridge status as JSON', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'get_bridge_status', arguments: {} });
    expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual(LISTENING);
  });

  it('forwards calls to the bridge with defaults applied and returns JSON', async () => {
    const { client, bridge } = await connect(async () => [{ id: 7, title: 'Docs' }]);
    const result = await client.callTool({ name: 'apply_tab_plan', arguments: { groups: [{ title: 'Docs', tabIds: [7] }] } });
    expect(bridge.request).toHaveBeenCalledWith('plan.apply', {
      groups: [{ title: 'Docs', tabIds: [7] }],
      ungroupTabIds: [],
      dryRun: false,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual([{ id: 7, title: 'Docs' }]);
  });

  it('returns snapshots as plain text', async () => {
    const { client } = await connect(async () => 'Page: Docs\n- button "Go" [ref=e1]');
    const result = await client.callTool({ name: 'snapshot_page', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'text', text: 'Page: Docs\n- button "Go" [ref=e1]' }]);
  });

  it('returns screenshots as image content', async () => {
    const { client } = await connect(async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }));
    const result = await client.callTool({ name: 'screenshot', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
  });

  it('turns bridge failures into error results', async () => {
    const { client } = await connect(async () => {
      throw new Error('extension is not connected');
    });
    const result = await client.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(contentOf(result)[0]!.text).toBe('extension is not connected');
  });

  it('rejects invalid arguments without reaching the bridge', async () => {
    const { client, bridge } = await connect();
    const outcome = await client.callTool({ name: 'close_tabs', arguments: { tabIds: [] } }).then(
      (result) => ({ failed: result.isError === true, message: contentOf(result)[0]?.text ?? '' }),
      (error: Error) => ({ failed: true, message: error.message }),
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.message).toMatch(/tabIds/);
    expect(bridge.request).not.toHaveBeenCalled();
  });
});
