# Agent Browser Bridge

Let your AI agent organise the browser you actually use.

Ask Claude, Cursor or any MCP-capable agent to *"group my tabs by topic"* and it reads your open tabs,
proposes groups, and applies them in your everyday Chrome window: no separate automation profile, no
copy-pasting URLs. Changed your mind? Ask it to undo.

- **Works on your real browser.** Your windows, tabs and tab groups, not a fresh test profile.
- **Tab groups built in.** Create, rename, recolour, collapse and reorder groups, which page-automation tools can't reach.
- **Preview and undo.** The agent can show its plan before applying it, and restore your previous layout afterwards.
- **Stays on your machine.** The extension only talks to a server your agent runs locally.

## How to use

### 1. Install the extension

1. Download the latest zip from the [Releases page](https://github.com/lx223/agent-bridge-browser-extension/releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.

A setup page opens. You can reopen it any time from the extension's toolbar icon.

### 2. Connect your agent

The setup page has one-click buttons for **Cursor** and **VS Code**. For other agents:

**Claude Code**

```bash
claude mcp add agent-browser-bridge -- npx -y agent-browser-bridge-mcp
```

**Claude Desktop and other agents**: add this to the agent's MCP config, then restart it.

```json
{
  "mcpServers": {
    "agent-browser-bridge": { "command": "npx", "args": ["-y", "agent-browser-bridge-mcp"] }
  }
}
```

The status on the setup page turns green when your agent is connected.

### 3. Ask

> Organise my open tabs into groups by topic. Show me the plan first.

> Collapse every group except the one I'm working in.

> Undo that.

## License

MIT
