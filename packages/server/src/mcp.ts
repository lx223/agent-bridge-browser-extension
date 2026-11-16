import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { methods, SERVER_NAME, toolDefinitions } from '@agent-browser-bridge/protocol';
import type { ExtensionBridge } from './bridge.ts';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown) => ({
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

export function createMcpServer(bridge: ExtensionBridge, version: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    {
      instructions:
        'Controls the user\'s real Chrome browser through the Agent Browser Bridge extension. To organise tabs: call list_tabs and list_tab_groups, decide on groups, preview with apply_tab_plan {dryRun: true}, then apply. Ask before closing tabs. If tools report the extension is not connected, call get_bridge_status and tell the user.',
    },
  );

  server.registerTool(
    'get_bridge_status',
    {
      description: 'Report whether the browser extension is connected to this MCP server.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(bridge.status()),
  );

  for (const method of methods) {
    const def = toolDefinitions[method];
    server.registerTool(
      def.tool,
      {
        description: def.description,
        inputSchema: def.params.shape,
        annotations: {
          readOnlyHint: def.readOnly,
          destructiveHint: 'destructive' in def ? def.destructive : false,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          return json(await bridge.request(method, args));
        } catch (err) {
          return failure(err);
        }
      },
    );
  }

  return server;
}
