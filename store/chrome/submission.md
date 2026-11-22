# Chrome Web Store Submission

Copy for the dashboard. The data usage disclosures record the 0.3.0 submission. Review against the package and [privacy policy](../../PRIVACY.md) before each submission. Release procedure: [Chrome Web Store releases](../../docs/chrome-web-store.md).

## Description (16,000 char limit)

Other languages: [descriptions](descriptions/), one file per locale.

### English (United Kingdom)

Control your own browser with any AI agent you like.

Connect your AI coding agent to your everyday Chrome browser through Model Context Protocol (MCP).

Agent Browser Bridge lets a connected agent list, open, focus and close windows and tabs, organise tabs into named and coloured groups, move, pin, mute, duplicate and unload tabs, and close tabs on request. Preview a grouping plan before applying it, and undo the last plan to restore the previous layout.

Agents can also help you pick up earlier work: search your browsing history, list recently closed tabs and the tabs open on your other signed-in devices, and reopen them. They can search and organise your bookmarks and Reading List, find and start downloads, see your most visited sites, search with your default search engine, and notify you when a task finishes.

Connected agents can also inspect and operate web pages, navigate, click, type, and use page-provided WebMCP tools. The debugger permission enables this page control through the Chrome DevTools Protocol. Only connect agents you trust: they can receive tab titles, URLs and page contents and interact with pages on your behalf.

A side panel lets you chat with your agent from Chrome, so you don't need to switch back to the agent's window between steps.

The setup page shows connection status and provides configuration options for Cursor, VS Code, Claude Code and other MCP-compatible agents. A separate local Agent Browser Bridge MCP server is required. The extension connects to that server on your computer.

Anonymous product usage analytics can be turned off in the extension settings. See the privacy policy for details.


## Single Purpose

Allow a user-selected MCP agent to inspect and organise Chrome tabs and operate web pages through a local bridge server.


## Permission Justifications

### tabs

Read tab titles, URLs and window membership so the connected MCP agent can list tabs and organise them at the user's request. Also supports moving, grouping and closing tabs.

### tabGroups

Read and update Chrome tab groups, including names, colours, collapsed state and position, to apply the user's requested organisation plan.

### storage

Store the previous tab and group layout in session storage for undo. Local storage retains the browser instance identifier, analytics preference, random analytics installation identifier and analytics timing state across service-worker restarts.

### history

Search the user's browsing history and list visits to a page when the connected MCP agent is asked to find or recap something the user viewed earlier, including pages whose tabs are closed. The extension only reads history; it does not add or delete entries.

### sessions

List recently closed tabs and windows and the tabs open on the user's other signed-in devices, and reopen them with their navigation history when the user's agent is asked to. The tabs API cannot see closed tabs or other devices.

### readingList

List, add, update and remove Reading List entries when the user asks their agent to save pages for later or find something they saved.

### bookmarks

Search, create, rename, move and remove bookmarks and folders at the user's request, for example to save a set of tabs for a project or find a bookmarked page.

### downloads

Search the download list, start a download of a URL the user asks for, show a downloaded file in its folder, and remove entries from the list. The extension does not open or delete downloaded files.

### topSites

List the user's most visited sites so the agent can find pages the user returns to often.

### search

Run a search with the user's own default search engine in a new tab when the user asks their agent to look something up.

### notifications

Show a desktop notification from the user's agent, such as when a long-running task the user requested finishes.

### sidePanel

Show the chat panel where the user talks to their connected agent: the agent's messages appear there and the user's replies go back to it through the local bridge.

### alarms

Periodically wake the extension service worker to reconnect to the local MCP bridge when the worker has been suspended.

### debugger

The debugger permission enables Chrome DevTools Protocol access to tabs for browser actions requested by the user through their connected MCP agent. It is needed to inspect page structure and content, capture screenshots, navigate, click, type, scroll, and invoke page-provided WebMCP tools. These operations are routed through the local MCP bridge; ordinary tabs and tabGroups APIs cannot provide page inspection or interaction.

## Remote Code

Extension scripts and dependencies are bundled in the package. PostHog is used for event ingestion, not to download executable code. Page-control tools can evaluate agent-supplied JavaScript in a target page and invoke page-provided WebMCP tools; disclose this distinction if the reviewer asks about dynamic execution.

## Data Usage Disclosures

The submitted 0.3.0 dashboard selected Web history, User activity and Website content:

- Web history: tab titles, URLs and window/tab metadata are returned to the connected agent through the local bridge.
- User activity: release builds send usage events, tool names, success/failure, timing and counts to PostHog EU. Analytics excludes tab titles, URLs, page contents and tool parameters/results.
- Website content: page tools return accessibility trees, form values, screenshots, JavaScript results and DevTools Protocol results to the connected agent.

Review additional categories before the next submission: analytics uses a persistent random installation identifier and the service receives an IP address. Page tools can also return personal communications, account details, financial or health information, authentication information and other sensitive data present in the requested page. The three selections above record what was submitted, not a claim that other categories can never be processed.

Analytics is on by default in configured release builds and can be disabled on the setup or options page. Browser information goes to the local bridge and the user's chosen agent; that agent or its model provider may transmit or retain it under its own policies.

Privacy policy URL: https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md

The dashboard declarations state that data is not sold or transferred outside approved use cases, used for unrelated purposes, or used to determine creditworthiness or for lending. Verify these statements against current behaviour before submitting.

## Reviewer Test Instructions

No extension account is required. Use Chrome 116 or later and Node.js 20 or later. An MCP-compatible agent and the separate local bridge server are required.

1. Install the extension and open its toolbar setup page.
2. Add the server to your agent's MCP configuration:

   ```json
   {
     "mcpServers": {
       "agent-browser-bridge": {
         "command": "npx",
         "args": ["-y", "agent-browser-bridge-mcp@0.3.0"]
       }
     }
   }
   ```

3. Restart the agent. The setup page and toolbar indicator show a connected agent.
4. Open https://example.com in a tab. Ask the agent to list Chrome tabs and confirm the title and URL appear.
5. Ask the agent to preview a tab grouping plan, apply it, then undo it. Confirm groups and tab positions change and restore.
6. Ask the agent to inspect the example.com tab with `chrome_snapshot_page`, then click its More information link using the returned reference. Chrome displays a debugging banner while attached.
7. Call `chrome_detach_debugger` for that tab and confirm the banner disappears.
8. Open the extension options and turn off Share anonymous usage statistics to test the analytics control.

Page control cannot operate on chrome:// pages, extension pages, DevTools or the Chrome Web Store. WebMCP tools require a page that registers them and a Chrome build with WebMCP enabled; they are not required for ordinary page inspection or clicks.

## Permission Audit

| Permission | Active use | Why narrower access is insufficient |
| --- | --- | --- |
| tabs | Reads titles and URLs across open tabs and windows for agent inspection and organisation. | activeTab covers only the invoked tab, not the user's multi-window tab layout. |
| tabGroups | Reads and changes group names, colours, positions and collapsed state. | tabs alone does not expose group metadata or update groups. |
| storage | Saves undo snapshots, browser identity, analytics preference and analytics state. | In-memory worker state is lost when the service worker stops. |
| history | Searches history and lists visits to a page when the agent is asked to find earlier browsing. Read only. | tabs only covers pages that are still open. |
| sessions | Lists and restores recently closed tabs and windows and tabs on the user's other devices. | tabs cannot see closed tabs or other devices. |
| readingList | Lists, adds, updates and removes Reading List entries at the user's request. | No other API exposes the Reading List. |
| bookmarks | Searches, creates, renames, moves and removes bookmarks and folders at the user's request. | No other API exposes bookmarks. |
| downloads | Searches the download list, starts a requested download, shows a file in its folder and removes list entries. | No other API exposes the download list. |
| topSites | Lists the most visited sites. | history alone does not return Chrome's most visited ranking. |
| search | Runs a search with the user's default search engine in a new tab. | Opening a fixed search URL would ignore the user's chosen engine. |
| notifications | Shows a desktop notification from the agent, such as when a requested task finishes. | Pages and the service worker cannot show system notifications without it. |
| sidePanel | Shows the chat panel for talking to the connected agent. | A tab or popup would cover the page the user is working on, or close as soon as they click it. |
| alarms | Wakes the service worker periodically to reconnect the local bridge. | Ordinary worker timers do not survive suspension. |
| debugger | Attaches the DevTools Protocol for page snapshots, screenshots, interactions, evaluation, navigation fallback and WebMCP tools. | tabs and tabGroups APIs cannot inspect or operate page contents. |
