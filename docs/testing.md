# Testing

There are three layers. Presubmit runs all of them on every pull request.

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit and contract | `npm test` | Logic in each package, in Node, with fakes for `chrome.*` |
| Coverage gate | `npm run test:coverage` | The same tests, failing if coverage drops below the thresholds |
| End-to-end | `npm run test:e2e` | The built extension and the built MCP server working together in real Chromium |

## Unit and contract tests

Tests live next to the code as `*.test.ts` and run with Vitest in a Node environment.

- `packages/server/src/mcp.test.ts` connects a real MCP client to `createMcpServer` over an in-memory transport with a fake bridge. It checks the tool list against the protocol, the published schemas and annotations, the text, JSON and image result formats, and error results.
- `packages/server/src/bridge.test.ts` runs hosts and relays on real local WebSockets. Besides routing, it covers handing the bridge over to a newer server version, including requests in flight and other relays.
- `packages/server/src/launcher.test.ts` drives the self-updating launcher with in-memory fake workers. It covers passing messages through, replaying the handshake to a new version, draining the old worker, routing cancellations, failed upgrades and update check timing. `docs/updates.md` describes the design.
- `packages/extension/src/background/bridgeClient.test.ts` runs `BridgeClient` against a real local WebSocket server with fake timers. It covers the hello handshake, the list of connected agent sessions, request dispatch, error responses, malformed messages, keepalive pings, reconnecting, backoff and waiting for requests in flight. The test uses the `ws` client as the `WebSocket` global because it reports refused connections the way Chrome does on every supported Node version.
- `packages/extension/src/background/update.test.ts` checks that a pending extension update reloads the service worker once requests have finished, or after a minute at most.
- `packages/extension/src/test/` holds in-memory fakes of `chrome.tabs`, `chrome.tabGroups`, `chrome.storage.session` and `chrome.debugger` for the plan and page logic.

## Coverage

`npm run test:coverage` prints a table and writes an HTML report to `coverage/`. Thresholds are set in `vitest.config.ts` a little below the current numbers, so a change that removes tests or adds untested logic fails presubmit. Raise them when coverage rises.

Files that only wire things to the browser are excluded from the unit coverage numbers because the end-to-end suite is what exercises them: the service worker entry, the `chrome.*` handlers, navigation, serialisation, the welcome and options pages, and the server entry points (`index.ts`, `standalone.ts`, `worker.ts` and the process wiring in `autoUpdate.ts`). The end-to-end suite starts the server through the launcher, so it runs that wiring too.

## End-to-end tests

`npm run test:e2e` builds both packages, then for each file in `e2e/`:

1. starts the built MCP server (`packages/server/dist/index.js`) over stdio with a real MCP client,
2. launches headless Chromium with `packages/extension/dist` loaded as an unpacked extension,
3. waits for the extension to connect, then drives it only through MCP tool calls against pages served from `e2e/fixtures/`.

The files are:

- `e2e/tabs.test.ts`: connection status, listing and filtering tabs, grouping, moving, updating, duplicating, closing, creating, updating and closing windows, tab plans with undo, error reporting, and a second agent session relaying through the first.
- `e2e/history.test.ts`: searching history, listing visits, listing and restoring recently closed tabs by session id and without one, the empty device list without sync, and an unknown session id.
- `e2e/discard.test.ts`: discarding tabs, the per-tab failure for a tab that is already discarded, and filtering discarded tabs. It starts Chromium as a plain process instead of through Playwright, because Chromium closes once a tab is discarded while Playwright is attached to the browser. Playwright's attachment also gives discarded tabs new ids, which does not happen otherwise.
- `e2e/page.test.ts`: snapshots, click, hover, typing, keys, scrolling, screenshots, waiting, evaluate, navigation, back and forward after a click and directly after a URL navigation, raw CDP, detaching, and the stale ref hint.
- `e2e/extension.test.ts`: the built manifest and its files, the welcome and options pages, and reconnecting to a new server session.
- `e2e/pageTools.test.ts`: listing and calling WebMCP tools that `e2e/fixtures/tools.html` registers, a throwing tool, an unknown tool, a timeout, and the empty list after navigating away. The harness starts Chromium with `--enable-features=WebMCP` for this.

`npm run test:e2e:mcpb` runs the same suite against the Claude Desktop extension bundle (`packages/server/mcpb-dist/server/index.js`) instead of the npm build. The bundle inlines every dependency, so this catches bundling problems that only show up once the extension connects. Set `E2E_SERVER_ENTRY` to point the suite at any other server entry.

`e2e/harness.ts` holds the shared setup. Add fixtures as plain HTML files in `e2e/fixtures/`.

### Stale element refs

A ref from `chrome_snapshot_page` stops working once its element leaves the page. `chrome.debugger.sendCommand` rejects with an `Error` whose message is the CDP error as a JSON string, and `withStaleRefHint` in `packages/extension/src/background/page.ts` matches on that text to replace it with `Element eN no longer exists; take a new chrome_snapshot_page.` These are the messages Chromium returns:

| Situation | Message |
| --- | --- |
| Element removed from the DOM | `{"code":-32000,"message":"Node is detached from document"}` |
| Tab reloaded or navigated to another page | `{"code":-32000,"message":"Node does not have a layout object"}` |
| Element still attached but hidden with `display: none` | `{"code":-32000,"message":"Node does not have a layout object"}` |
| Node already discarded by the browser | `No node found for given backend id` and similar |

A hidden element gets the same hint as a removed one. It is absent from a new snapshot, so the advice still holds. The end-to-end suite covers the first two rows against real Chromium, and the unit tests cover every pattern with the JSON-shaped messages.

### Things to know

- The extension always connects to port 17373, so the files run one at a time. The harness refuses to start if that port is already in use, because a running agent session would otherwise connect the tests to your own browser. Close agent sessions that use the bridge first.
- The test browser cannot resolve any host other than `127.0.0.1`, so nothing leaves the machine, including analytics if your local build has a key.
- Locally you need Playwright's Chromium once: `npx playwright install chromium`.
- To run against an existing build without rebuilding: `npx vitest run --config vitest.e2e.config.ts`.
- To watch the browser, change `headless` to `false` in `e2e/harness.ts`.
