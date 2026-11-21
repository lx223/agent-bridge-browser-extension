import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  browserApis,
  browserTool,
  browserLabels,
  browsers,
  browserToolName,
  CHAT_PROMPT,
  CHAT_RECEIVE_TOOL,
  CHAT_SEND_TOOL,
  IDENTIFY_INSTANCES_TOOL,
  NAME_INSTANCE_TOOL,
  NAME_INSTANCES_PROMPT,
  PROTOCOL_VERSION,
  SERVER_NAME,
  STATUS_TOOL,
  type HelloMessage,
} from '@agent-browser-bridge/protocol';
import type { BridgeStatus, ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';

const LISTENING: BridgeStatus = { state: 'listening', role: 'host', port: 17373, browsers: [] };
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

type Request = (browser: string, method: string, params: unknown, agent: unknown, instance?: string) => Promise<unknown>;

async function connect(request: Request = async () => null, status: () => BridgeStatus = () => LISTENING) {
  const bridge = { status, request: vi.fn(request) };
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
    expect(client.getInstructions()).toContain('chrome_page_snapshot');
  });

  it('registers the status tool plus one tool per browser method', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const expected = [
      STATUS_TOOL,
      IDENTIFY_INSTANCES_TOOL,
      NAME_INSTANCE_TOOL,
      CHAT_SEND_TOOL,
      CHAT_RECEIVE_TOOL,
      ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method))),
    ];
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('publishes each description and its params plus the instance selector', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const browser of browsers) {
      for (const method of browserApis[browser]) {
        const def = browserTool(browser, method);
        const tool = tools.find((t) => t.name === browserToolName(browser, method))!;
        expect(tool.description).toBe(`${browserLabels[browser]}: ${def.description}`);
        expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual([...Object.keys(def.params), 'instance'].sort());
      }
    }
    expect(tools.find((t) => t.name === 'chrome_page_click')!.inputSchema.required).toEqual(['tabId']);
  });

  it('leaves out the params Safari does not support and names Safari tools in its descriptions', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    expect(tool('chrome_tabs_update').inputSchema.properties).toHaveProperty('autoDiscardable');
    expect(tool('safari_tabs_update').inputSchema.properties).not.toHaveProperty('autoDiscardable');
    expect(tool('safari_windows_update').inputSchema.properties).not.toHaveProperty('drawAttention');
    expect(tool('safari_tabs_list').inputSchema.properties).not.toHaveProperty('groupId');
    for (const name of tools.map((t) => t.name).filter((name) => name.startsWith('safari_'))) {
      expect(tool(name).description).not.toMatch(/chrome_/);
    }
  });

  it('marks read-only, destructive and open-world tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const annotations = (name: string) => tools.find((t) => t.name === name)!.annotations;
    expect(annotations(STATUS_TOOL)).toMatchObject({ readOnlyHint: true });
    expect(annotations('chrome_tabs_list')).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(annotations('chrome_tabs_close')).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(annotations('chrome_tabs_group')).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(annotations('chrome_tabs_create')).toMatchObject({ openWorldHint: true });
    expect(annotations('chrome_tabs_navigate')).toMatchObject({ openWorldHint: true });
    expect(annotations('chrome_sessions_restore')).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(annotations('chrome_history_search')).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(annotations('chrome_downloads_download')).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(annotations('chrome_bookmarks_remove_tree')).toMatchObject({ destructiveHint: true, openWorldHint: false });
    expect(annotations('chrome_top_sites_get')).toMatchObject({ readOnlyHint: true });
    expect(annotations('chrome_windows_remove')).toMatchObject({ destructiveHint: true, openWorldHint: false });
    expect(annotations('chrome_page_snapshot')).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(annotations('chrome_cdp_send')).toMatchObject({ destructiveHint: true, openWorldHint: true });
  });

  it('reports the bridge status as JSON', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: STATUS_TOOL, arguments: {} });
    expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual(LISTENING);
  });

  it('forwards calls to the bridge with defaults applied and returns JSON', async () => {
    const { client, bridge } = await connect(async () => [{ id: 7, title: 'Docs' }]);
    const result = await client.callTool({ name: 'chrome_plan_apply', arguments: { groups: [{ title: 'Docs', tabIds: [7] }] } });
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
    await client.callTool({ name: 'safari_tabs_list', arguments: { windowId: 2, instance: 'work' } });
    expect(bridge.request).toHaveBeenCalledWith('safari', 'tabs.list', { windowId: 2 }, undefined, 'work');
  });

  it('returns snapshots as plain text', async () => {
    const { client } = await connect(async () => 'Page: Docs\n- button "Go" [ref=e1]');
    const result = await client.callTool({ name: 'chrome_page_snapshot', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'text', text: 'Page: Docs\n- button "Go" [ref=e1]' }]);
  });

  it('returns screenshots as image content', async () => {
    const { client } = await connect(async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }));
    const result = await client.callTool({ name: 'chrome_page_screenshot', arguments: { tabId: 1 } });
    expect(contentOf(result)).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }]);
  });

  it('turns bridge failures into error results', async () => {
    const { client } = await connect(async () => {
      throw new Error('extension is not connected');
    });
    const result = await client.callTool({ name: 'chrome_tabs_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(contentOf(result)[0]!.text).toBe('extension is not connected');
  });

  it('rejects invalid arguments without reaching the bridge', async () => {
    const { client, bridge } = await connect();
    const outcome = await client.callTool({ name: 'chrome_tabs_close', arguments: { tabIds: [] } }).then(
      (result) => ({ failed: result.isError === true, message: contentOf(result)[0]?.text ?? '' }),
      (error: Error) => ({ failed: true, message: error.message }),
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.message).toMatch(/tabIds/);
    expect(bridge.request).not.toHaveBeenCalled();
  });

  describe('with named browser instances', () => {
    const hello = (instanceId: string, extra: Partial<HelloMessage> = {}): HelloMessage => ({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: '1.0.0',
      userAgent: 'test',
      browser: 'chrome',
      instanceId,
      label: 'Chrome',
      ...extra,
    });

    async function connectTo(initial: HelloMessage[], request: Request = async () => []) {
      let connected = initial;
      const status = (): BridgeStatus => ({ state: connected.length ? 'connected' : 'listening', role: 'host', port: 17373, browsers: connected });
      return { ...(await connect(request, status)), setConnected: (next: HelloMessage[]) => (connected = next) };
    }

    const tabsOf = (instance?: string) => [
      { id: 1, windowId: 1, title: `${instance} inbox`, url: `https://mail.${instance}.example/`, active: false, lastAccessed: 5 },
      { id: 2, windowId: 1, title: 'New Tab', url: 'chrome://newtab/', active: true, lastAccessed: 9 },
      { id: 3, windowId: 2, title: `${instance} docs`, url: `https://docs.${instance}.example/a`, active: true, lastAccessed: 1 },
    ];

    it('tags each result with the instance that answered and stays on it', async () => {
      const { client, bridge, setConnected } = await connectTo([hello('aaaa1111', { name: 'Work' })]);
      const first = await client.callTool({ name: 'chrome_tabs_list', arguments: {} });
      expect(contentOf(first).at(-1)).toEqual({ type: 'text', text: 'Browser instance: "Work" (Chrome, aaaa1111)' });
      expect(bridge.request).toHaveBeenLastCalledWith('chrome', 'tabs.list', {}, undefined, 'aaaa1111');

      setConnected([hello('bbbb2222')]);
      const second = await client.callTool({ name: 'chrome_tabs_close', arguments: { tabIds: [1] } });
      expect(second.isError).toBe(true);
      expect(contentOf(second)[0]!.text).toMatch(/this session was using, "Work" \(Chrome, aaaa1111\), is not connected/);
      expect(bridge.request).toHaveBeenCalledTimes(1);
    });

    it('accepts an instance name', async () => {
      const { client, bridge } = await connectTo([hello('aaaa1111', { name: 'Work' }), hello('bbbb2222', { name: 'Personal' })]);
      await client.callTool({ name: 'chrome_tabs_list', arguments: { instance: 'personal' } });
      expect(bridge.request).toHaveBeenLastCalledWith('chrome', 'tabs.list', {}, undefined, 'bbbb2222');
    });

    it('identifies each instance by a few of its tabs without pinning', async () => {
      const { client, bridge } = await connectTo(
        [hello('aaaa1111', { name: 'Work' }), hello('bbbb2222'), hello('cccc3333', { browser: 'safari', label: 'Safari' })],
        async (_browser, method, _params, _agent, instance) => {
          if (instance === 'bbbb2222') throw new Error('Browser did not answer tabs.list within 30s');
          return method === 'tabs.list' ? tabsOf(instance) : null;
        },
      );
      const result = await client.callTool({ name: IDENTIFY_INSTANCES_TOOL, arguments: { browser: 'chrome', sampleSize: 2 } });
      expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual({
        instances: [
          {
            browser: 'chrome',
            label: 'Chrome',
            instanceId: 'aaaa1111',
            name: 'Work',
            windows: 2,
            tabs: 3,
            sampleTabs: [
              { title: 'aaaa1111 docs', site: 'docs.aaaa1111.example' },
              { title: 'aaaa1111 inbox', site: 'mail.aaaa1111.example' },
            ],
          },
          { browser: 'chrome', label: 'Chrome', instanceId: 'bbbb2222', name: null, error: 'Browser did not answer tabs.list within 30s' },
        ],
      });
      expect(bridge.request).toHaveBeenCalledWith('chrome', 'tabs.list', {}, undefined, 'aaaa1111');
      await client.callTool({ name: 'chrome_windows_list', arguments: {} });
      expect(bridge.request).toHaveBeenLastCalledWith('chrome', 'windows.list', {}, undefined, undefined);
    });

    it('explains how to proceed when nothing is connected', async () => {
      const { client } = await connectTo([]);
      const result = await client.callTool({ name: IDENTIFY_INSTANCES_TOOL, arguments: {} });
      expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual({
        instances: [],
        note: `No browser is connected. Call ${STATUS_TOOL} and ask the user to open their browser.`,
      });
    });

    it('marks an extension without an instance id as needing an update', async () => {
      const legacy = { ...hello('x'), instanceId: undefined };
      const { client, bridge } = await connectTo([legacy]);
      const result = await client.callTool({ name: IDENTIFY_INSTANCES_TOOL, arguments: {} });
      expect(JSON.parse(contentOf(result)[0]!.text!).instances[0]).toMatchObject({ instanceId: null, error: expect.stringMatching(/older extension/) });
      expect(bridge.request).not.toHaveBeenCalled();
    });

    it('names an instance and waits until the bridge reports the new name', async () => {
      let reconnect: (next: HelloMessage[]) => void = () => {};
      const { client, bridge, setConnected } = await connectTo([hello('aaaa1111')], async (_browser, method, params) => {
        if (method !== 'instance.setName') return [];
        const { name } = params as { name: string };
        setTimeout(() => reconnect([hello('aaaa1111', { name })]), 20);
        return { instanceId: 'aaaa1111', name };
      });
      reconnect = setConnected;
      const result = await client.callTool({ name: NAME_INSTANCE_TOOL, arguments: { browser: 'chrome', instance: 'aaaa1111', name: 'Work' } });
      expect(bridge.request).toHaveBeenCalledWith('chrome', 'instance.setName', { name: 'Work' }, undefined, 'aaaa1111');
      expect(JSON.parse(contentOf(result)[0]!.text!)).toEqual({ browser: 'chrome', instanceId: 'aaaa1111', name: 'Work' });
      const listed = await client.callTool({ name: 'chrome_tabs_list', arguments: { instance: 'work' } });
      expect(listed.isError).toBeFalsy();
    });

    it('renames an instance addressed by its current name', async () => {
      const { client, bridge } = await connectTo([hello('aaaa1111', { name: 'Work' })], async () => ({ instanceId: 'aaaa1111', name: null }));
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
      try {
        const call = client.callTool({ name: NAME_INSTANCE_TOOL, arguments: { browser: 'chrome', instance: 'Work', name: '' } });
        await vi.advanceTimersByTimeAsync(3_100);
        const result = await call;
        expect(bridge.request).toHaveBeenCalledWith('chrome', 'instance.setName', { name: '' }, undefined, 'aaaa1111');
        expect(JSON.parse(contentOf(result)[0]!.text!)).toMatchObject({ instanceId: 'aaaa1111', name: null, note: expect.stringMatching(/few seconds/) });
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks for an extension update when the browser cannot be named by an agent', async () => {
      const { client } = await connectTo([hello('aaaa1111')], async () => {
        throw new Error('Unknown method: instance.setName');
      });
      const result = await client.callTool({ name: NAME_INSTANCE_TOOL, arguments: { browser: 'chrome', instance: 'aaaa1111', name: 'Work' } });
      expect(result.isError).toBe(true);
      expect(contentOf(result)[0]!.text).toMatch(/older Agent Browser Bridge extension/);
    });

    it('reports other naming failures as they are', async () => {
      const { client } = await connectTo([hello('aaaa1111')], async () => {
        throw new Error('The browser extension in chrome disconnected.');
      });
      const result = await client.callTool({ name: NAME_INSTANCE_TOOL, arguments: { browser: 'chrome', instance: 'aaaa1111', name: 'Work' } });
      expect(contentOf(result)[0]!.text).toBe('The browser extension in chrome disconnected.');
    });

    it('offers a prompt that walks through naming profiles', async () => {
      const { client } = await connectTo([]);
      const { prompts } = await client.listPrompts();
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual([NAME_INSTANCES_PROMPT, CHAT_PROMPT].sort());
      const plain = await client.getPrompt({ name: NAME_INSTANCES_PROMPT, arguments: {} });
      const text = (plain.messages[0]!.content as { text: string }).text;
      expect(text).toContain(IDENTIFY_INSTANCES_TOOL);
      expect(text).toContain(NAME_INSTANCE_TOOL);
      expect(text).not.toContain('looking for');
      const focused = await client.getPrompt({ name: NAME_INSTANCES_PROMPT, arguments: { looking_for: 'work' } });
      expect((focused.messages[0]!.content as { text: string }).text).toContain(`I'm looking for the one I call "work".`);
    });
  });
});
