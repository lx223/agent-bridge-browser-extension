import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  browserApis,
  browserLabels,
  browsers,
  browserToolName,
  SERVER_NAME,
  STATUS_TOOL,
  toolDefinitions,
  type ImageResult,
} from '@agent-browser-bridge/protocol';
import type { ExtensionBridge } from './bridge.ts';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: String(value) }] });
const image = (value: unknown) => {
  const { data, mimeType } = value as ImageResult;
  return { content: [{ type: 'image' as const, data, mimeType }] };
};
const formatters = { json, text, image };

const failure = (err: unknown) => ({
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

export function createMcpServer(bridge: ExtensionBridge, version: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    {
      instructions:
        `Controls the user's real browsers through the Agent Browser Bridge extension. Each browser has its own tools, named after it: chrome_* for Chrome and safari_* for Safari. Tab, window and group ids only mean something within their own browser, so never pass an id from one browser's tools to the other's. Call ${STATUS_TOOL} to see which browsers are connected; if a tool reports its browser is not connected, tell the user. Safari offers tabs and windows only; tab groups and page control exist only in Chrome. To organise Chrome tabs: call chrome_list_tabs and chrome_list_tab_groups, decide on groups, preview with chrome_apply_tab_plan {dryRun: true}, then apply. Ask before closing tabs. To work inside a page in Chrome: chrome_open_tab or chrome_navigate, then chrome_snapshot_page to get element refs, act with chrome_click, chrome_type_text, chrome_press_key, chrome_scroll or chrome_hover, and snapshot again to see the result; use chrome_screenshot when layout matters. These are the user's own signed-in browsers: confirm with the user before submitting forms, sending messages, purchasing, or deleting anything.`,
    },
  );

  server.registerTool(
    STATUS_TOOL,
    {
      description: 'Report which browsers have the extension connected to this MCP server.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(bridge.status()),
  );

  for (const browser of browsers) {
    for (const method of browserApis[browser]) {
      const def = toolDefinitions[method];
      server.registerTool(
        browserToolName(browser, method),
        {
          description: `${browserLabels[browser]}: ${def.description}`,
          inputSchema: def.params.shape,
          annotations: {
            readOnlyHint: def.readOnly,
            destructiveHint: 'destructive' in def ? def.destructive : false,
            openWorldHint: method.startsWith('page.') || method.startsWith('cdp.') || method === 'tabs.navigate' || method === 'tabs.create',
          },
        },
        async (args: unknown) => {
          const format = formatters['output' in def ? def.output : 'json'];
          try {
            return format(await bridge.request(browser, method, args));
          } catch (err) {
            return failure(err);
          }
        },
      );
    }
  }

  return server;
}
