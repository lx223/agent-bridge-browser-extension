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
- `packages/extension/src/background/bridgeClient.test.ts` runs `BridgeClient` against a real local WebSocket server with fake timers. It covers the hello handshake, request dispatch, error responses, malformed messages, keepalive pings, reconnecting and backoff. The test uses the `ws` client as the `WebSocket` global because it reports refused connections the way Chrome does on every supported Node version.
- `packages/extension/src/test/` holds in-memory fakes of `chrome.tabs`, `chrome.tabGroups`, `chrome.storage.session` and `chrome.debugger` for the plan and page logic.

## Coverage

`npm run test:coverage` prints a table and writes an HTML report to `coverage/`. Thresholds are set in `vitest.config.ts` a little below the current numbers, so a change that removes tests or adds untested logic fails presubmit. Raise them when coverage rises.

Files that only wire things to the browser are excluded from the unit coverage numbers because the end-to-end suite is what exercises them: the service worker entry, the `chrome.*` handlers, navigation, serialisation, the welcome and options pages, and the server entry point.

## End-to-end tests

`npm run test:e2e` builds both packages, then for each file in `e2e/`:

1. starts the built MCP server (`packages/server/dist/index.js`) over stdio with a real MCP client,
2. launches headless Chromium with `packages/extension/dist` loaded as an unpacked extension,
3. waits for the extension to connect, then drives it only through MCP tool calls against pages served from `e2e/fixtures/`.

The files are:

- `e2e/tabs.test.ts`: connection status, listing, grouping, moving, closing, tab plans with undo, error reporting, and a second agent session relaying through the first.
- `e2e/page.test.ts`: snapshots, click, hover, typing, keys, scrolling, screenshots, waiting, evaluate, navigation, raw CDP and detaching.
- `e2e/pageTools.test.ts`: listing and calling WebMCP tools that `e2e/fixtures/tools.html` registers, a throwing tool, an unknown tool, a timeout, and the empty list after navigating away. The harness starts Chromium with `--enable-features=WebMCP` for this.
- `e2e/extension.test.ts`: the built manifest and its files, the welcome and options pages, and reconnecting to a new server session.

`e2e/harness.ts` holds the shared setup. Add fixtures as plain HTML files in `e2e/fixtures/`.

### Things to know

- The extension always connects to port 17373, so the files run one at a time. The harness refuses to start if that port is already in use, because a running agent session would otherwise connect the tests to your own browser. Close agent sessions that use the bridge first.
- The test browser cannot resolve any host other than `127.0.0.1`, so nothing leaves the machine, including analytics if your local build has a key.
- Locally you need Playwright's Chromium once: `npx playwright install chromium`.
- To run against an existing build without rebuilding: `npx vitest run --config vitest.e2e.config.ts`.
- To watch the browser, change `headless` to `false` in `e2e/harness.ts`.
