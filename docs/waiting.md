# Waiting for the user

Some tasks need the user to do something in the browser first, such as signing in. `chrome_tabs_wait_for` and `safari_tabs_wait_for` let the agent wait for that instead of asking the user to report back.

The tool takes a `tabId` and a `url`, a `title` or both. Each matches the whole value, ignores case and accepts `*` wildcards. It returns the tab as soon as it matches, at once if it already does, and fails when the tab closes or `timeoutMs` passes. `timeoutMs` defaults to 2 minutes and is capped at 10.

The extension watches `tabs.onUpdated` and `tabs.onRemoved` (`extensions/browser/src/background/tabWait.ts`), so it needs no debugger and works in Safari too. Safari reports a tab's url and title only for websites the extension has access to, so a tab on another website never matches there.

## Timeouts along the way

- **Bridge.** The server gives up on a browser request after 30 seconds. A request whose params carry `timeoutMs` gets that time plus 5 seconds instead, so the browser's own timeout reports first.
- **MCP client.** Many clients give up on a tool call after a fixed time, often 60 seconds, unless the server reports progress. When the client sends a `progressToken`, the server sends a `notifications/progress` message every 15 seconds while any browser tool runs. Clients that reset their timeout on progress then keep waiting.
