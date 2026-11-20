# Agent Browser Bridge for Claude

Let Claude organise your browser tabs and operate web pages in the browser you already use, with your existing tabs and signed-in sessions.

Claude can find, group, pin and close tabs across windows, search your history, bookmarks and Reading List, reopen recently closed tabs, and inspect, click and type in pages. Chrome supports all of this; Safari supports tabs and windows.

## Install

In Claude, open **Customize > Plugins > Discover**, select Agent Browser Bridge and choose **Add**. Claude Code loads the plugin for the same account the next time it starts.

## Requirements

- The Agent Browser Bridge extension in Chrome or Safari. The plugin cannot install it for you. Follow the [install steps](https://github.com/lx223/agent-bridge-browser-extension#install), or run `/agent-browser-bridge:setup` and Claude walks you through it.
- Node.js 20 or later.

## What the plugin contains

- An MCP server, `agent-browser-bridge`, that gives Claude the browser tools.
- A skill, `/agent-browser-bridge:setup`, that checks whether a browser is connected and helps with the missing step.

## What it runs, sends and fetches

- It starts the MCP server with `npx`, which downloads the open-source [`agent-browser-bridge-mcp`](https://www.npmjs.com/package/agent-browser-bridge-mcp) package from the npm registry at the version named in `.mcp.json`.
- The server listens on `127.0.0.1` only. The browser extension connects to it there, and browser data travels over that local connection to Claude.
- The server asks the npm registry for its latest version a minute after it starts and then every hour. When a newer version is published, it downloads that version with `npx` and switches to it without a restart. It makes no other outbound requests.
- The server sends no analytics. The browser extension has optional usage analytics that you can turn off in its settings; see the [privacy policy](https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md).

Claude receives tab titles, URLs and page contents and can act in pages where you are signed in. It is instructed to confirm with you before submitting forms, sending messages, purchasing or deleting anything.

## Source and licence

Source code, issues and documentation are at https://github.com/lx223/agent-bridge-browser-extension. Licensed under Apache-2.0.
