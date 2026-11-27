# Agent Browser Bridge

**Control your own browser with any AI agent you like.**

## Why use it

Connect your MCP-compatible agent to the browser you already use, with your existing tabs and signed-in sessions.

- **Organise your real browser.** Find tabs across windows, group, pin, mute, duplicate or unload them, open, focus and close windows, preview an organisation plan and undo the last applied plan.
- **Pick up earlier work in Chrome.** Search browsing history, list recently closed tabs and the tabs open on your other signed-in devices, and reopen them with their back and forward history.
- **Use what Chrome keeps for you.** Search, create and organise bookmarks and the Reading List, find, start and show downloads, see your most visited sites, search with your default search engine, and get a desktop notification when an agent finishes.
- **Act on Chrome pages.** Inspect page structure, take screenshots, click, type, scroll, navigate and call page-provided WebMCP tools.
- **Chat with your agent from Chrome's side panel.** Ask your agent to continue in the browser and keep talking to it there, instead of switching back to its window between steps. See [docs/chat.md](docs/chat.md).
- **Confirm in the page you're looking at.** Before the agent submits, sends, buys or deletes something, it can ask you in a small popover in the tab, and your click goes straight back to it. Works in Chrome and Safari; see [docs/asking.md](docs/asking.md).
- **Share one browser across agents.** Multiple agent processes connect through a shared local bridge, with automatic host failover. The extension lists each agent session with its project, last activity and the browser profiles it used; see [docs/sessions.md](docs/sessions.md).
- **Connect multiple browsers and profiles.** Chrome and Safari can connect together; Chromium profiles and instances are addressed separately. Ask your agent to tell your profiles apart and it shows you a few tabs from each, then names them, so "my Work Chrome" just works. Safari supports tabs and windows; Chrome also supports tab groups, history, sessions, bookmarks, the Reading List, downloads, search, notifications and page control. See [docs/profiles.md](docs/profiles.md).
- **In your language.** The extension's pages follow your browser's language, in every language the Chrome Web Store supports. See [docs/localisation.md](docs/localisation.md).
- **Reach your browser from anywhere.** Turn on remote access to let agents on another computer or in the cloud use your browser through a relay server you run, secured with separate agent and browser tokens. See [docs/remote.md](docs/remote.md).
- **Choose your agent.** Use Cursor, VS Code, Claude Code or another MCP client. The bridge runs locally. Your chosen agent can receive browser data and act in signed-in pages, so connect only agents you trust. Optional usage analytics can be disabled in extension settings; see the [privacy policy](PRIVACY.md).

## Install

Node.js 20 or later is required for the MCP server.

### 1. Install the Chrome extension

Add [Agent Browser Bridge from the Chrome Web Store](https://chromewebstore.google.com/detail/agent-browser-bridge/kmhcfgambmbglmgdjmdlkhcfkfpkddgb). Edge, Brave and other Chromium browsers install it from the same listing; Edge first asks you to allow extensions from other stores.

The setup page opens automatically. To reopen it, click the toolbar icon to open the side panel, then click the gear button.

To try a release before it reaches the store, download the extension ZIP from [GitHub Releases](https://github.com/lx223/agent-bridge-browser-extension/releases) and unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the unzipped folder. An unpacked copy does not update itself, so remove it when you switch to the store version.

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

The Safari extension is being prepared for the Mac App Store; see [docs/safari-app-store.md](docs/safari-app-store.md). Until it is published, build the macOS app from source with Xcode installed:

```bash
git clone https://github.com/lx223/agent-bridge-browser-extension.git
cd agent-bridge-browser-extension
npm ci
npm run build:safari -w agent-browser-bridge-extension
```

Open the generated project in `extensions/browser/safari/` with Xcode, select the macOS scheme and run it. In Safari, enable **Settings > Advanced > Show features for web developers**, choose **Develop > Allow Unsigned Extensions**, and enable Agent Browser Bridge under **Settings > Extensions**. Allow website access so Safari can read tab titles and URLs, then connect your agent as above.
