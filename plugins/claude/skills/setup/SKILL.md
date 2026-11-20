---
name: setup
description: Connect Claude to the user's browser through Agent Browser Bridge. Use when the user asks to set up or troubleshoot Agent Browser Bridge, or when a chrome_*, safari_* or browser_* tool reports that no browser or extension is connected.
---

# Set up Agent Browser Bridge

This plugin starts the Agent Browser Bridge MCP server. The server only reaches a browser that has the Agent Browser Bridge extension installed and enabled, and the plugin cannot install that extension. Walk the user through whichever step is missing.

## 1. Check what is connected

Call `browser_status`.

- If it lists a browser, setup is complete. Tell the user which browsers are connected and stop.
- If no `browser_status` tool is available, the MCP server did not start. Go to step 3.
- If it lists no browser, go to step 2.

## 2. Install the browser extension

Ask the user which browser they want to connect.

### Chrome and other Chromium browsers

1. Download the latest extension ZIP from https://github.com/lx223/agent-bridge-browser-extension/releases/latest and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

The extension's setup page opens and turns green once it reaches the server. This takes up to 30 seconds. Call `browser_status` again to confirm.

### Safari

Safari needs a macOS app built from source with Xcode. Point the user to the Safari section of https://github.com/lx223/agent-bridge-browser-extension#safari and offer to run the build commands for them.

## 3. Check the server

The server is the `agent-browser-bridge-mcp` npm package, started with `npx`. It needs Node.js 20 or later.

1. Run `node --version`. If Node.js is missing or older than 20, help the user install the current LTS release and check that `npx` works.
2. Ask the user to run `/mcp` and check the state of the `agent-browser-bridge` server, then reconnect it or run `/reload-plugins`.

## 4. Extension installed but still not connected

- The browser must be open with the extension enabled. It reconnects on its own within about 30 seconds.
- Each browser profile needs its own copy of the extension.
- If the user also added the server by hand with `claude mcp add agent-browser-bridge`, both copies work and share one bridge. They can remove the manual one with `claude mcp remove agent-browser-bridge`.

## After setup

Suggest a first request, such as listing the open tabs. These are the user's own signed-in browsers, so confirm before submitting forms, sending messages, purchasing or deleting anything.
