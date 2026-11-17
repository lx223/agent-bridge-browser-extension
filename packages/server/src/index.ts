import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORT } from '@agent-browser-bridge/protocol';
import { ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';
import pkg from '../package.json' with { type: 'json' };

// stdout carries MCP traffic; all logging goes to stderr.
const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);

const port = Number(process.env.AGENT_BROWSER_BRIDGE_PORT ?? DEFAULT_PORT);
const bridge = new ExtensionBridge({
  port,
  extensionId: process.env.AGENT_BROWSER_BRIDGE_EXTENSION_ID || undefined,
  log,
  agentInfo: () => {
    const client = server.server.getClientVersion();
    return { serverVersion: pkg.version, client: client ? { name: client.name, version: client.version } : null };
  },
});

try {
  await bridge.start();
} catch (err) {
  // Keep serving MCP so the agent can surface the problem via get_bridge_status.
  log(err instanceof Error ? err.message : String(err));
}

const server = createMcpServer(bridge, pkg.version);
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await bridge.stop();
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
