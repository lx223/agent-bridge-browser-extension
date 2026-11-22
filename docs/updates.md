# Updates without restarts

Agent sessions and browsers often run for days. The extension and the MCP server both pick up new versions on their own, so nobody has to restart Chrome or their agent after a release.

## Extension

Chrome downloads an extension update in the background but only installs it once the service worker stops. The bridge keeps the service worker running by design: the WebSocket keepalive while an agent is connected, and the reconnect loop and alarm while none is. Without help, an update would wait until the browser restarts.

The service worker listens for `chrome.runtime.onUpdateAvailable` and calls `chrome.runtime.reload()`, which installs the update. It first waits until no bridge request is in flight, for at most a minute, so an agent's tool call is not cut off. After the reload the extension reconnects to the MCP server within a second or two. Calls made in that gap report that the browser is not connected.

The code is in `packages/extension/src/background/update.ts`, and `BridgeClient.whenIdle()` reports when requests have finished.

### What survives an update

The extension keeps per-browser-session state in `chrome.storage.session`, which Chrome clears whenever the extension reloads, as well as when the browser quits. Two parts of it are carried over an update, so an agent can carry on where it was:

- the browser chat conversations (`chat.conversations`), so the side panel still shows them and the chat cursor the MCP server holds still points at the right messages;
- the undo snapshot of the last `plan.apply` (`lastPlanSnapshot`), so `chrome_plan_undo` still works.

Just before `chrome.runtime.reload()`, after bridge requests have finished, the service worker copies both keys into `chrome.storage.local` under `reloadCarryOver`, with the time it was saved. When the service worker starts again it reads that copy, deletes it, and writes the keys back into `chrome.storage.session` unless they are already there. Bridge requests and the chat store wait for this to finish before they touch the state. The code is in `packages/extension/src/background/carryOver.ts`.

A browser restart still clears this state. Normally there is no copy at start-up, because the one written before a reload is used and deleted straight away. A copy more than two minutes old, left behind if the browser quit between saving it and reloading, is deleted without being restored.

Everything else in `chrome.storage.session` is cleared by an update, as before, and so is in-memory state, such as a `chat.receive` call still waiting for the user. An update from a version before this change starts with an empty chat, because the older version saves nothing before reloading.

Both storage areas allow 10 MB, so whatever fits in `storage.session` fits in the copy, apart from the few other small settings `storage.local` already holds. The chat store caps itself at 20 conversations of 500 messages each, but messages can be up to 20,000 characters, so a very full chat could still come close to that limit. If the copy cannot be written, the extension reloads anyway and the state is lost, as it was before.

### Extensions that cannot update themselves

Versions before 0.4.0 have no `onUpdateAvailable` listener. While an agent is connected their service worker never stops, so Chrome keeps the downloaded update waiting until the browser restarts. The server cannot reload them, so it tells the agent to ask the user instead (`packages/server/src/outdated.ts`):

- `browser_status` adds a `notice` to such a browser, and each tool result it answers ends with the same notice.
- When an extension answers `Unknown method` for a tool the server offers, the server replaces the error with one that names both versions and the missing tool, and asks the user to restart the browser. Safari users are sent to the Mac App Store instead.

Quitting and reopening the browser, or turning the extension off and on in `chrome://extensions`, installs the waiting update.

## MCP server

Agents start the server with `npx -y agent-browser-bridge-mcp@latest`. The `@latest` tag makes npx ask the registry for the newest version on every start instead of reusing whatever it cached first.

A long-running agent session keeps its server process, so the server also updates itself while running.

### Launcher and worker

The process the agent starts is a small launcher (`packages/server/src/launcher.ts`). It owns the stdio connection to the agent and runs the real server, the worker, as a child process. It passes MCP messages through unchanged and remembers the agent's `initialize` request and `notifications/initialized` notification.

A minute after start and then every hour, the launcher asks the npm registry (the one npm is configured with) for the latest version. When a newer one is published, it:

1. starts `npx -y agent-browser-bridge-mcp@<version>` as a second worker, alongside the first;
2. replays the agent's `initialize` request to it and waits for a successful answer, then sends `notifications/initialized`;
3. sends new agent requests to the new worker, while the old worker finishes requests already in flight (for up to a minute) and then exits;
4. tells the agent `notifications/tools/list_changed`, so clients that support it refresh the tool list.

If the new version fails to start or initialize, the launcher keeps the current worker and tries again at the next check. A request the old worker never answers gets an error response asking the agent to retry. The launcher itself does not change until the agent session restarts, so it is kept small and generic.

The launcher is always on for the npm package. It costs one small extra Node process and one registry request an hour. Workers are started with `AGENT_BROWSER_BRIDGE_WORKER=1`, which makes the entry point run the server directly; this is internal to the launcher. The launcher also passes `AGENT_BROWSER_BRIDGE_SESSION_ID` and `AGENT_BROWSER_BRIDGE_SESSION_STARTED_AT`, created once when it starts, so the agent session keeps the same identity in the extension after the worker is replaced (see [sessions.md](sessions.md)). The Claude Desktop extension bundle runs the server directly instead, as `docs/claude-desktop-extension.md` explains.

### Handing the bridge over to a newer server

Several agent sessions share one WebSocket port. The first server to start hosts it and the others relay through it. Each relay announces its server version when it joins. When the host sees a relay with a newer version, it hands hosting over:

1. The host stops listening on the port and sends the relay a `handover` message.
2. The relay starts listening on the port and closes its connection to the old host once its own requests through it have finished.
3. The old host finishes requests in flight, closes its extension and relay connections with code `4002`, and rejoins as a relay.
4. The extensions and the other relays reconnect to the new host.

So the newest server running on the machine ends up hosting the bridge, even while older agent sessions are still open. Servers older than this change never hand over, so a session started before it keeps hosting until it ends.
