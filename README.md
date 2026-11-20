# Agent Browser Bridge

**Control your own browser with any AI agent you like.**

## Why use it

Connect your MCP-compatible agent to the browser you already use, with your existing tabs and signed-in sessions.

- **Organise your real browser.** Find tabs across windows, group, pin, mute, duplicate or unload them, open, focus and close windows, preview an organisation plan and undo the last applied plan.
- **Pick up earlier work in Chrome.** Search browsing history, list recently closed tabs and the tabs open on your other signed-in devices, and reopen them with their back and forward history.
- **Act on Chrome pages.** Inspect page structure, take screenshots, click, type, scroll, navigate and call page-provided WebMCP tools.
- **Share one browser across agents.** Multiple agent processes connect through a shared local bridge, with automatic host failover.
- **Connect multiple browsers and profiles.** Chrome and Safari can connect together; Chromium profiles and instances are addressed separately. Safari supports tabs and windows; Chrome also supports tab groups, history, recently closed sessions and page control.
- **Choose your agent.** Use Cursor, VS Code, Claude Code or another MCP client. The bridge runs locally. Your chosen agent can receive browser data and act in signed-in pages, so connect only agents you trust. Optional usage analytics can be disabled in extension settings; see the [privacy policy](PRIVACY.md).

## Install

Node.js 20 or later is required for the MCP server.

### 1. Install the Chrome extension

1. Download the latest extension ZIP from [GitHub Releases](https://github.com/lx223/agent-bridge-browser-extension/releases) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

The setup page opens automatically. Click the toolbar icon to reopen it.

### 2. Connect your agent

Use the setup page's install buttons for **Cursor** or **VS Code**.

Or copy the setup page's **agent setup prompt** and paste it into your agent. It checks for Node.js and then adds the MCP server to the agent's own configuration.

For **Claude Code**, run:

```bash
claude mcp add agent-browser-bridge -- npx -y agent-browser-bridge-mcp@latest
```

For **Claude Desktop**, download [`agent-browser-bridge.mcpb`](https://github.com/lx223/agent-bridge-browser-extension/releases/latest/download/agent-browser-bridge.mcpb) from the latest release and open it. Claude Desktop installs it as an extension and runs it with its built-in Node.js, so you do not need Node.js installed.

For **another MCP client**, add this to its MCP configuration and restart the client:

```json
{
  "mcpServers": {
    "agent-browser-bridge": {
      "command": "npx",
      "args": ["-y", "agent-browser-bridge-mcp@latest"]
    }
  }
}
```

The setup page and toolbar indicator turn green when an agent connects. Try asking it to list your Chrome tabs.

The extension and the server update themselves while running, so you don't need to restart your browser or agent after a release. See [docs/updates.md](docs/updates.md).

### Safari

Safari requires building a macOS app from source with Xcode installed:

```bash
git clone https://github.com/lx223/agent-bridge-browser-extension.git
cd agent-bridge-browser-extension
npm ci
npm run build:safari -w agent-browser-bridge-extension
```

Open the generated project in `packages/extension/safari/` with Xcode, select the macOS scheme and run it. In Safari, enable **Settings > Advanced > Show features for web developers**, choose **Develop > Allow Unsigned Extensions**, and enable Agent Browser Bridge under **Settings > Extensions**. Allow website access so Safari can read tab titles and URLs, then connect your agent as above.
