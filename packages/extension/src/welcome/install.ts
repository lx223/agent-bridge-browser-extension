import { SERVER_NAME, SERVER_PACKAGE } from '@agent-browser-bridge/protocol';

/** How every agent launches the server: `npx -y @lx223/agent-browser-bridge-mcp`. */
export const launch = { command: 'npx', args: ['-y', SERVER_PACKAGE] } as const;

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
