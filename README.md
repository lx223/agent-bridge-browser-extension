# Agent Browser Bridge

## Installation

### 1. Install the extension

1. Download the latest zip from the [Releases page](https://github.com/lx223/agent-bridge-browser-extension/releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the unzipped folder.

A setup page opens. You can reopen it any time from the extension's toolbar icon.

#### Safari

Safari loads web extensions through a macOS app, so build it from source with Xcode installed:

```bash
npm ci
```

```bash
npm run build:safari -w agent-browser-bridge-extension
```

This writes an Xcode project to `packages/extension/safari/`. Open it in Xcode, choose the macOS scheme and run it. Then in Safari, turn on **Settings > Advanced > Show features for web developers**, choose **Develop > Allow Unsigned Extensions**, and enable Agent Browser Bridge in **Settings > Extensions**. Allow it on all websites so it can read tab titles and URLs.

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

The toolbar icon shows the same status: a gray dot on the **A** means no agent is connected, and a green dot means an agent is connected.

## Multiple agent sessions

Several agent sessions can use the browser at the same time. The first MCP server process to start listens on port 17373 and holds the extension connection. Later processes connect to it on `ws://127.0.0.1:17373/relay` and forward their requests through it. If the hosting process exits, one of the remaining processes takes over the port and the extension reconnects to it automatically.

All sessions share the same browsers, so `chrome_undo_last_plan` undoes the most recent plan applied by any session.

## Several browsers at once

Chrome and Safari can both be connected to the same agent. The bridge keeps one connection per browser, and `browser_status` lists the browsers that are connected.

Each browser has its own tools, named after it, because each browser's extension API offers different things:

| Namespace | Tools |
|---|---|
| `chrome_*` | Tabs, windows, tab groups, tab plans and page control. |
| `safari_*` | Tabs and windows: `safari_list_windows`, `safari_list_tabs`, `safari_move_tabs`, `safari_close_tabs`, `safari_open_tab` and `safari_navigate`. |
| `browser_*` | Tools that do not belong to one browser: `browser_status`. |

Tab, window and group ids are only unique within one browser, so an id from a `chrome_*` tool is only valid in other `chrome_*` tools. Safari has no extension APIs for tab groups or the DevTools Protocol, so those tools exist only for Chrome.

### Several instances of one browser

Other Chromium browsers such as Edge and Brave use the `chrome_*` tools, and each browser profile runs its own copy of the extension. All of them can be connected at once. Each install creates a short instance id the first time it runs and keeps it in the extension's local storage, so a reload reconnects as the same instance.

`browser_status` lists every connected instance with its `instanceId` and a `label` such as `Chrome`, `Edge` or `Brave`. Every `chrome_*` and `safari_*` tool takes an optional `instance` argument. It can be left out while only one instance of that browser is connected. When several are connected, the tool returns an error that lists them and asks the agent to pass `instance`. Ids are only valid within the instance they came from.

A tool whose browser is not connected returns an error saying so.

`AGENT_BROWSER_BRIDGE_EXTENSION_ID` pins the bridge to one extension id. Safari assigns a random id per install, so pinning admits only the browser whose id is set.

## What your agent can do

**Tabs and windows** use the browser's extension APIs. In Chrome: `chrome_list_windows`, `chrome_list_tabs`, `chrome_list_tab_groups`, `chrome_group_tabs`, `chrome_update_tab_group`, `chrome_ungroup_tabs`, `chrome_move_tabs`, `chrome_move_tab_group`, `chrome_close_tabs`, `chrome_apply_tab_plan`, `chrome_undo_last_plan`, `chrome_open_tab` and `chrome_navigate`. Safari has the six `safari_*` tools listed above.

**Page control** is Chrome only. It uses the Chrome DevTools Protocol through the extension's `debugger` permission:

| Tool | What it does |
|---|---|
| `chrome_snapshot_page` | Returns the page's accessibility tree. Elements carry refs such as `[ref=e42]`. |
| `chrome_click`, `chrome_hover` | Sends real mouse events to an element ref or to x/y coordinates. |
| `chrome_type_text`, `chrome_press_key` | Inserts text and sends real key events, e.g. `Enter` or `Control+a`. |
| `chrome_scroll` | Sends mouse-wheel events over an element or the viewport. |
| `chrome_screenshot` | Captures the viewport or the full page as PNG or JPEG. |
| `chrome_wait_for` | Waits for text to appear or disappear. |
| `chrome_evaluate` | Runs a JavaScript expression in the page. |
| `chrome_list_page_tools` | Lists the WebMCP tools the page has registered for agents. |
| `chrome_call_page_tool` | Calls one of those tools and returns its output. |
| `chrome_cdp_send` | Sends any raw DevTools Protocol command. |
| `chrome_detach_debugger` | Detaches from a tab and removes Chrome's debugging banner. |

A typical loop is `chrome_open_tab` or `chrome_navigate`, then `chrome_snapshot_page`, act on a ref, and snapshot again.

`chrome_navigate` with `back` or `forward` uses `chrome.tabs.goBack` and `chrome.tabs.goForward`. Chrome refuses those with "Cannot find a next page in history." in a tab whose history was built only by agent navigations, with no click or key press in the page. When that happens the extension attaches the debugger, moves to the neighbouring history entry with `Page.navigateToHistoryEntry`, and detaches again once the page has loaded, so the debugging banner shows only for that step. If the debugger was already attached for page tools it stays attached. At either end of the history the tool reports that the tab is on its first or last page.

While a page tool is in use, Chrome shows a banner saying Agent Browser Bridge started debugging the browser. The extension detaches from a tab after five minutes without page commands, or when `chrome_detach_debugger` is called. Chrome does not let extensions debug `chrome://` pages, other extensions' pages, DevTools or the Chrome Web Store, so page tools fail there.

## WebMCP page tools

Pages can register their own tools for agents through [WebMCP](https://webmachinelearning.github.io/webmcp/) with `document.modelContext.registerTool`. `chrome_list_page_tools` returns the tools registered in a tab and `chrome_call_page_tool` runs one by name. Both are Chrome only. They go through the experimental `WebMCP` domain of the DevTools Protocol, so they attach the debugger like the other page tools.

- Chrome only exposes WebMCP to pages when the feature is on, for example with `chrome://flags/#enable-webmcp-testing`, `--enable-features=WebMCP` or a site's origin trial token. On other pages the list is empty.
- The list is rebuilt on every call, so call `chrome_list_page_tools` again after a navigation.
- Tools registered inside cross-origin iframes are not listed.
- When several frames register the same tool name, pass the `frameId` from `chrome_list_page_tools` to `chrome_call_page_tool`.
- `chrome_call_page_tool` waits up to `timeoutMs`, 20 seconds by default, and then cancels the invocation.
- Tool names, descriptions and outputs are written by the page. Agents are told to treat them as untrusted data and to confirm with the user before calling a tool that changes data.

## Icons

Icon sources are generated by `packages/extension/scripts/render-icons.mjs`, which writes SVGs to `packages/extension/icons/` and renders PNGs into `packages/extension/public/icons/` with headless Chrome. Run `npm run icons -w agent-browser-bridge-extension` after changing the design. Set `CHROME_PATH` if Chrome is not at the default macOS location.

## Testing

`npm test` runs the unit tests, `npm run test:coverage` adds the coverage gate, and `npm run test:e2e` drives the built extension and server in headless Chromium. See [docs/testing.md](docs/testing.md).

## Store releases

Copy-ready store fields are in [Chrome Web Store submission](store/chrome/submission.md). See [release steps](docs/chrome-web-store.md) for publishing.
