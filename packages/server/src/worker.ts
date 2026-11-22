import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORT, type AgentProject } from '@agent-browser-bridge/protocol';
import { ExtensionBridge } from './bridge.ts';
import { createMcpServer } from './mcp.ts';
import { projectFromPath, sessionIdentity, trackProject } from './session.ts';
import pkg from '../package.json' with { type: 'json' };

const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);

const describe = (reason: unknown) => (reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));

function keepRunningOnErrors() {
  process.on('uncaughtException', (err) => log(`Unexpected error, still running: ${describe(err)}`));
  process.on('unhandledRejection', (reason) => log(`Unhandled rejection, still running: ${describe(reason)}`));
}

export async function runWorker() {
  keepRunningOnErrors();
  const port = Number(process.env.AGENT_BROWSER_BRIDGE_PORT ?? DEFAULT_PORT);
  const { sessionId, startedAt } = sessionIdentity(process.env);
  const home = homedir();
  let project: AgentProject | undefined = projectFromPath(process.cwd(), home);
  const bridge = new ExtensionBridge({
    port,
    extensionId: process.env.AGENT_BROWSER_BRIDGE_EXTENSION_ID || undefined,
    log,
    version: pkg.version,
    agentInfo: () => {
      const client = server.server.getClientVersion();
      return {
        serverVersion: pkg.version,
        client: client ? { name: client.name, version: client.version } : null,
        sessionId,
        startedAt,
        ...(project && { project }),
      };
    },
  });

  const server = createMcpServer(bridge, pkg.version);
  const refreshProject = trackProject(server.server, home, (found) => {
    project = found;
    bridge.agentChanged();
  });
  server.server.oninitialized = () => {
    bridge.agentChanged();
    void refreshProject();
  };

  try {
    await bridge.start();
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
  }

  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await bridge.stop();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
