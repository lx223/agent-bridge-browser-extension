# Agent Browser Bridge

## Installation

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
