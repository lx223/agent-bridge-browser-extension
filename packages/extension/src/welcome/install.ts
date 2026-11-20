import { SERVER_NAME, SERVER_PACKAGE } from '@agent-browser-bridge/protocol';

export const LAUNCH_SPEC = `${SERVER_PACKAGE}@latest`;

/** How every agent launches the server: `npx -y agent-browser-bridge-mcp@latest`. */
export const launch = { command: 'npx', args: ['-y', LAUNCH_SPEC] } as const;

export const claudeCodeCommand = `claude mcp add ${SERVER_NAME} -- ${launch.command} ${launch.args.join(' ')}`;

export const mcpJsonConfig = JSON.stringify({ mcpServers: { [SERVER_NAME]: { ...launch, args: [...launch.args] } } }, null, 2);

/** https://docs.cursor.com/tools/developers#generate-install-link */
export const cursorInstallUrl = (): string => {
  const config = btoa(JSON.stringify({ ...launch, args: [...launch.args] }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(SERVER_NAME)}&config=${encodeURIComponent(config)}`;
};

/** https://code.visualstudio.com/docs/copilot/customization/mcp-servers#_url-handler */
export const vscodeInstallUrl = (): string =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, ...launch, args: [...launch.args] }))}`;

export const claudeDesktopExtensionUrl =
  'https://github.com/lx223/agent-bridge-browser-extension/releases/latest/download/agent-browser-bridge.mcpb';

export const MIN_NODE_VERSION = 20;

export const agentSetupPrompt = [
  `Add the "${SERVER_NAME}" MCP server to your own configuration so you can use my Chrome browser.`,
  `It runs locally with \`${launch.command} ${launch.args.join(' ')}\`, so it needs Node.js ${MIN_NODE_VERSION} or later.`,
  `First run \`node --version\`. If Node.js is missing or older than ${MIN_NODE_VERSION}, help me install the current LTS release (for example from https://nodejs.org or with my package manager) and check that \`npx\` works before continuing.`,
  `If you are Claude Code, run: ${claudeCodeCommand}`,
  'Otherwise, add this entry to your MCP configuration file:',
  mcpJsonConfig,
  'Then tell me whether I need to restart you before the new tools are available.',
].join('\n\n');
