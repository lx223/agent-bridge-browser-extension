# Agent Browser Bridge

A Chrome extension that lets AI agents use your real browser over [MCP](https://modelcontextprotocol.io).
The first use case is tab organisation: ask your agent to "group my tabs by topic" and it can.

```
Agent ──stdio MCP──▶ agent-browser-bridge-mcp (Node) ◀──WebSocket 127.0.0.1:17373──▶ extension service worker ──▶ chrome.tabs / chrome.tabGroups
```

The agent launches the MCP server (`npx -y agent-browser-bridge-mcp`). The extension keeps trying to
connect to it on localhost and serves requests once connected. Unlike Chrome DevTools MCP (which drives
Chrome over the DevTools Protocol), this works on your everyday profile and can use extension-only APIs
such as tab groups.

## Tools

| Tool | Does |
| --- | --- |
| `get_bridge_status` | Whether the extension is connected |
| `list_windows`, `list_tabs`, `list_tab_groups` | Read the current layout |
| `group_tabs`, `update_tab_group`, `ungroup_tabs` | Create and edit groups |
| `move_tabs`, `move_tab_group` | Reorder |
| `close_tabs` | Close (not undoable) |
| `apply_tab_plan` | Apply a whole grouping in one call, with `dryRun` preview |
| `undo_last_plan` | Restore the layout from before the last plan |

## Layout

```
packages/
  protocol/   shared zod schemas: bridge messages + one entry per tool (source-only, bundled into both)
  server/     the MCP server, published to npm as agent-browser-bridge-mcp
  extension/  MV3 extension: background service worker + welcome/setup page
```

To add an API, add an entry to `packages/protocol/src/tools.ts` and a handler in
`packages/extension/src/background/handlers.ts`. The server registers tools from the protocol table
automatically.

## Development

Requires Node 22 (`.nvmrc`). Use npm 11 for a fresh `npm install` (npm 10 hits an installer bug on this
dependency tree); `npm ci` works with either.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `packages/extension/dist`.
A setup page opens on install; click the toolbar icon to reopen it.

Point your agent at the local server build instead of npm:

```bash
claude mcp add agent-browser-bridge -- node /absolute/path/to/packages/server/dist/index.js
```

`npm run dev:extension` and `npm run dev:server` rebuild on change.

### Configuration

| Env var (server) | Default | |
| --- | --- | --- |
| `AGENT_BROWSER_BRIDGE_PORT` | `17373` | The extension currently always uses the default |
| `AGENT_BROWSER_BRIDGE_EXTENSION_ID` | unset | Only accept this extension id (otherwise any `chrome-extension://` origin) |

## Security model

- The server listens only on `127.0.0.1` and rejects WebSocket connections whose `Origin` is not a
  `chrome-extension://` URL, so web pages cannot connect. Pin `AGENT_BROWSER_BRIDGE_EXTENSION_ID` to
  also exclude other extensions.
- The agent can read titles and URLs of all tabs and rearrange or close them. Nothing leaves the machine
  via this extension.

## Known limitations

- One agent session at a time: a second server finds the port in use and reports it via `get_bridge_status`.
- When no agent is running, the service worker retries every 30s (alarm), so connecting can take up to ~30s
  after an agent starts. Opening the setup page reconnects immediately.
- No icons yet (Chrome shows a default letter icon).

## Releasing

Run the **Publish Release** workflow manually. It uses `packages/extension/package.json`'s version for the
GitHub release tag and zip, and publishes `packages/server` to npm if that version isn't there yet
(needs an `NPM_TOKEN` repository secret).

## License

MIT
