# Updates without restarts

Agent sessions and browsers often run for days. The extension and the MCP server both pick up new versions on their own, so nobody has to restart Chrome or their agent after a release.

## Extension

Chrome downloads an extension update in the background but only installs it once the service worker stops. The bridge keeps the service worker running by design: the WebSocket keepalive while an agent is connected, and the reconnect loop and alarm while none is. Without help, an update would wait until the browser restarts.

The service worker listens for `chrome.runtime.onUpdateAvailable` and calls `chrome.runtime.reload()`, which installs the update. It first waits until no bridge request is in flight, for at most a minute, so an agent's tool call is not cut off. Just before reloading it sends the server a `reloading` message. After the reload the extension reconnects to the MCP server within a second or two, and the server holds calls for it during that gap instead of failing them; see [Riding out reconnects](#riding-out-reconnects).

The code is in `extensions/browser/src/background/update.ts`. `BridgeClient.whenIdle()` reports when requests have finished, and `BridgeClient.announceReload()` sends the `reloading` message.

### What survives an update

The extension keeps per-browser-session state in `chrome.storage.session`, which Chrome clears whenever the extension reloads, as well as when the browser quits. Two parts of it are carried over an update, so an agent can carry on where it was:

- the browser chat conversations (`chat.conversations`), so the side panel still shows them and the chat cursor the MCP server holds still points at the right messages;
- the undo snapshot of the last `plan.apply` (`lastPlanSnapshot`), so `chrome_plan_undo` still works.

Once bridge requests have finished, and before it sends `reloading`, the service worker copies both keys into `chrome.storage.local` under `reloadCarryOver`, with the time it was saved. When the service worker starts again it reads that copy, deletes it, and writes the keys back into `chrome.storage.session` unless they are already there. Bridge requests and the chat store wait for this to finish before they touch the state. The code is in `extensions/browser/src/background/carryOver.ts`.

A browser restart still clears this state. Normally there is no copy at start-up, because the one written before a reload is used and deleted straight away. A copy more than two minutes old, left behind if the browser quit between saving it and reloading, is deleted without being restored.

Everything else in `chrome.storage.session` is cleared by an update, as before, and so is in-memory state. A `chat.receive` call still waiting for the user is cut off, and the server sends it again once the extension is back, as [Riding out reconnects](#riding-out-reconnects) describes; with the chat restored, it picks up from the same cursor. An update from a version before this change starts with an empty chat, because the older version saves nothing before reloading.

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
4. tells the agent `notifications/tools/list_changed` and `notifications/prompts/list_changed`, so clients that support them refresh the tool and prompt lists.

If the new version fails to start or initialize, the launcher keeps the current worker and tries again at the next check. A request the old worker never answers gets an error response asking the agent to retry. The launcher itself does not change until the agent session restarts, so it is kept small and generic.

The launcher is always on for the npm package. It costs one small extra Node process and one registry request an hour. Workers are started with `AGENT_BROWSER_BRIDGE_WORKER=1`, which makes the entry point run the server directly; this is internal to the launcher. The launcher also passes `AGENT_BROWSER_BRIDGE_SESSION_ID` and `AGENT_BROWSER_BRIDGE_SESSION_STARTED_AT`, created once when it starts, so the agent session keeps the same identity in the extension after the worker is replaced (see [sessions.md](sessions.md)). The Claude Desktop extension bundle runs the server directly instead, as `docs/claude-desktop-extension.md` explains.

### Handing the bridge over to a newer server

Several agent sessions share one WebSocket port. The first server to start hosts it and the others relay through it. Each relay announces its server version when it joins. When the host sees a relay with a newer version, it hands hosting over:

1. The host stops listening on the port and sends the relay a `handover` message.
2. The relay starts listening on the port and closes its connection to the old host once its own requests through it have finished.
3. The old host finishes requests in flight, closes its extension and relay connections with code `4002`, and rejoins as a relay.
4. The extensions and the other relays reconnect to the new host.

So the newest server running on the machine ends up hosting the bridge, even while older agent sessions are still open. Servers older than this change never hand over, so a session started before it keeps hosting until it ends.

## Staying up

Agents start the MCP server once per session and do not restart it if it exits, so an exit leaves the agent without browser tools until the user restarts the session. The server is built to keep running and to hide short interruptions from the agent.

### Riding out reconnects

When an extension connection closes, the hosting server remembers the browser instance, by its `instanceId`, for a short grace period:

| Why the connection closed | Grace period |
| --- | --- |
| The extension sent `reloading` first, because it is installing an update | 20 seconds |
| The server itself was handing the bridge over or rejoining | 10 seconds |
| Anything else, such as the browser quitting | 5 seconds |

During the grace period, a call for that browser waits for the instance to reconnect instead of failing with "not connected", and goes ahead as soon as it does. Once the period passes, calls fail as before. The host lists the instances it is waiting for in the `reconnecting` field of its `status` message, so sessions relaying through it wait too. A relay whose host exits waits the same way for the browsers that host had, while it takes over hosting or finds the new host.

A call that was already in the browser when the connection closed cannot be answered by the old connection:

- Read-only calls, such as listing tabs, waiting for a tab or page, and receiving chat messages, are sent again once the instance is back, up to three attempts in all.
- Every other call fails with a message saying it may or may not have taken effect and that the agent should check before trying again. They are never repeated automatically, so a click or a tab close is never done twice.

The code is in `ExtensionBridge.ready()` and `ExtensionBridge.request()` in `packages/server/src/bridge.ts`. Extensions before 0.6.0 do not send `reloading`, so their updates get the 5-second grace period, which is longer than they take to reconnect. Servers before 0.6.0 ignore the `reloading` message.

### Restarting a stopped worker

If the active worker exits while the agent session is still open, the launcher starts a new one instead of exiting:

1. Requests the worker had not answered are sent to the new worker, except `tools/call`, which gets an error saying the tool may or may not have taken effect.
2. Requests that arrive while the new worker starts wait for it.
3. The new worker gets the agent's `initialize` request and `notifications/initialized` replayed, as in an update.
4. If the new worker runs a different version from the one that stopped, for example because the launcher fell back to the bundled version after an updated worker kept stopping, the agent gets `notifications/tools/list_changed` and `notifications/prompts/list_changed`, as in an update.

A new worker started by a restart or an update does not yet know which browsers were connected, and the extension takes a few seconds to reconnect to it. For its first 10 seconds, a call for a browser that has no connected instance waits for one instead of failing with "not connected". The launcher tells the worker why it started in `AGENT_BROWSER_BRIDGE_WORKER_REASON` (`start`, `update` or `restart`), and only `update` and `restart` get this wait, so a fresh session still reports a missing extension straight away.

A worker that ran for more than a minute is restarted at once. When one stops within a minute of starting, the launcher waits before the next attempt, starting at one second and doubling up to 30 seconds. If a worker started from a newer version on npm keeps stopping, the launcher goes back to the version it was started with. If a restart attempt fails, waiting requests get an error asking the agent to retry in a few seconds, and the launcher keeps trying. The launcher exits only when the agent closes its connection.

### Errors that do not stop the server

- A broken or oversized WebSocket frame from an extension or relay closes that one connection and is logged. Without an `error` listener it would have stopped the process.
- The worker and the launcher log uncaught exceptions and unhandled promise rejections to stderr and keep running. This matters most for the Claude Desktop extension bundle, which runs the worker without a launcher to restart it.
- If the agent's end of stdout closes, the launcher shuts down instead of failing on the write.

