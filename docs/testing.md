# Testing

There are four layers. Presubmit runs all of them on every pull request.

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit and contract | `npm test` | Logic in each package, in Node, with fakes for `chrome.*` |
| Coverage gate | `npm run test:coverage` | The same tests, failing if coverage drops below the thresholds |
| End-to-end | `npm run test:e2e` | The built extension and the built MCP server working together in real Chromium, and in a [simulated Safari](#safari) |
| Safari app build | `npm run test:safari-app -w agent-browser-bridge-extension` | Apple's converter accepts the built extension and Xcode builds the Safari app. macOS only |

## Unit and contract tests

Tests live next to the code as `*.test.ts` and run with Vitest in a Node environment.

- `packages/server/src/mcp.test.ts` connects a real MCP client to `createMcpServer` over an in-memory transport with a fake bridge. It checks the tool list against the protocol, the published schemas and annotations, the text, JSON and image result formats, and error results.
- `packages/server/src/bridge.test.ts` runs hosts and relays on real local WebSockets. Besides routing, it covers handing the bridge over to a newer server version, including requests in flight and other relays.
- `packages/server/src/launcher.test.ts` drives the self-updating launcher with in-memory fake workers. It covers passing messages through, replaying the handshake to a new version, draining the old worker, routing cancellations, failed upgrades and update check timing. `docs/updates.md` describes the design.
- `extensions/browser/src/background/bridgeClient.test.ts` runs `BridgeClient` against a real local WebSocket server with fake timers. It covers the hello handshake, the list of connected agent sessions, request dispatch, error responses, malformed messages, keepalive pings, reconnecting, backoff and waiting for requests in flight. The test uses the `ws` client as the `WebSocket` global because it reports refused connections the way Chrome does on every supported Node version.
- `extensions/browser/src/background/update.test.ts` checks that a pending extension update reloads the service worker once requests have finished, or after a minute at most, and that nothing happens in a browser without update events, such as Safari.
- `extensions/browser/src/test/` holds in-memory fakes of `chrome.tabs`, `chrome.tabGroups`, `chrome.storage.session` and `chrome.debugger` for the plan and page logic.

## Coverage

`npm run test:coverage` prints a table and writes an HTML report to `coverage/`. Thresholds are set in `vitest.config.ts` a little below the current numbers, so a change that removes tests or adds untested logic fails presubmit. Raise them when coverage rises.

Files that only wire things to the browser are excluded from the unit coverage numbers because the end-to-end suite is what exercises them: the service worker entry, the `chrome.*` handlers, navigation, serialisation, the welcome page, and the server entry points (`index.ts`, `standalone.ts`, `worker.ts` and the process wiring in `autoUpdate.ts`). The end-to-end suite starts the server through the launcher, so it runs that wiring too.

## End-to-end tests

`npm run test:e2e` builds both packages, picks a free port and makes a test copy of `extensions/browser/dist` that connects to it (see [Bridge port](#bridge-port)), then for each test file under `e2e/`:

1. starts the built MCP server (`packages/server/dist/index.js`) over stdio with a real MCP client and `AGENT_BROWSER_BRIDGE_PORT` set to that port,
2. launches headless Chromium with the test copy loaded as an unpacked extension,
3. waits for the extension to connect, then drives it only through MCP tool calls against pages served from `e2e/support/fixtures/`.

The tests are grouped by what a user does with the bridge, one folder each. `e2e/support/` holds the shared harness, fixtures and Safari simulation and has no tests.

| Folder | File | What it covers |
| --- | --- | --- |
| `connection/` | `extension.test.ts` | The built manifest and its files, the welcome page, and reconnecting to a new server session. |
| | `status.test.ts` | The status tool, the full tool list, addressing the browser by instance id, identifying and naming a profile, and Safari reported as not connected. |
| | `profiles.test.ts` | Two Chrome profiles connected at once: separate instance ids, asking which one to use, routing calls and staying on the chosen one, addressing a profile by name, and dropping a profile whose browser closes. |
| | `sessions.test.ts` | Several agent sessions sharing one browser: a second session relaying through the first, and the others carrying on when the session hosting the bridge ends. |
| `tabs/` | `tabs.test.ts` | Listing and filtering tabs, grouping, moving, updating, duplicating, closing, waiting for a tab, creating, updating and closing windows, tab plans with undo, and error reporting. |
| | `discard.test.ts` | Discarding tabs, the per-tab failure for a tab that is already discarded, and filtering discarded tabs. It starts Chromium as a plain process instead of through Playwright, because Chromium closes once a tab is discarded while Playwright is attached to the browser. Playwright's attachment also gives discarded tabs new ids, which does not happen otherwise. |
| `page/` | `page.test.ts` | Snapshots, click, hover, typing, keys, scrolling, screenshots, waiting, evaluate, navigation, back and forward after a click and directly after a URL navigation, raw CDP, detaching, and the stale ref hint. |
| | `pageTools.test.ts` | Listing and calling WebMCP tools that `e2e/support/fixtures/tools.html` registers, a throwing tool, an unknown tool, a timeout, and the empty list after navigating away. The harness starts Chromium with `--enable-features=WebMCP` for this. |
| `browserData/` | `history.test.ts` | Searching history, listing visits, listing and restoring recently closed tabs by session id and without one, the empty device list without sync, and an unknown session id. |
| | `browserData.test.ts` | The Reading List, bookmarks, downloads, most visited sites, searching with the default search engine and notifications. Playwright saves downloads under random names in its own folder, so the download test finds its file by URL rather than by name. |
| `chat/` | `chat.test.ts` | The side panel chat: the empty state, the toolbar badge, replies typed in the panel or sent with the send button reaching the agent, the send button staying off for a blank draft, the unread note on other tools, ending the chat, the header action switching from End chat to Remove, the message box growing with the draft, and picking and removing conversations. |
| `ask/` | `ask.test.ts` | Asking the user in a page: the popover's text, confirming and cancelling with real clicks inside its closed shadow root, asking in the active tab, bringing the tab to the front, `navigated` after a navigation, a page script that can neither see the answer nor click for the user, the timeout removing the popover, and one question per tab. |
| `theme/` | `theme.test.ts` | The chat panel and the setup page switching between light and dark with the system colour scheme, and both using the same colours. |
| `localisation/` | `localisation.test.ts` | The setup page in German and in Arabic: translated text, code and links kept inside translated sentences, and the right-to-left layout. |
| `remote/` | `relay.test.ts` | Remote access end to end: the relay refusing to start with the same token twice, starting it in `http` mode with an agent and a browser token, the setup page showing a wrong browser token as rejected, connecting with the right one without it reaching the relay's log, the agent snippet, an agent with the agent token listing this browser's tabs, agents with the browser token or a wrong token turned away, and switching remote access off. |
| `resilience/` | `serverRestart.test.ts` | Killing the MCP server process mid-session: the launcher starts a new one, the agent's next call still reaches the browser, and a tool call the crash cut off is reported as possibly not finished. It needs the launcher, so it does not run against the Claude Desktop bundle. |
| `safari/` | `safari.test.ts` | The built extension in a simulated Safari instead of Chromium. See [Safari](#safari). |

Some behaviour is covered only by unit tests, because the end-to-end harness cannot produce it:

- **An extension reloading to install an update.** Chromium does not reload an extension loaded with `--disable-extensions-except`, which the harness needs: after `chrome.runtime.reload()` the extension stays unloaded. `packages/server/src/bridge.test.ts` covers the server holding and repeating calls across a reload over real WebSockets, and `extensions/browser/src/background/update.test.ts` and `carryOver.test.ts` cover the extension's side.
- **Handing the bridge over to a newer server version.** Every server in a run is the same build. `bridge.test.ts` covers it.
- **An extension older than the server.** `bridge.test.ts` and `outdated.test.ts` cover the messages.

`npm run test:e2e:mcpb` runs the same suite against the Claude Desktop extension bundle (`packages/server/mcpb-dist/server/index.js`) instead of the npm build. The bundle inlines every dependency, so this catches bundling problems that only show up once the extension connects. Set `E2E_SERVER_ENTRY` to point the suite at any other server entry. The Claude Desktop bundle only runs in stdio mode, so `e2e/remote/relay.test.ts` always starts the relay from the npm build.

### Bridge port

Release builds connect to port 17373, the server's default. The extension reads the port from `VITE_BRIDGE_PORT` at build time and falls back to 17373 when it is not set, so a release build only changes if that variable is set while building.

`createTestBridge()` in `e2e/support/harness.ts` picks a free port other than 17373. It copies `extensions/browser/dist` to a temporary folder and rebuilds only `background.js` into it with `VITE_BRIDGE_PORT` set to that port, using `extensions/browser/vite.background.config.ts`, then checks that the rebuilt script contains the new port and not 17373.

`e2e/support/globalSetup.ts` does this once per Vitest run, passes the port and folder to the test files in `E2E_BRIDGE_PORT` and `E2E_EXTENSION_DIR`, and deletes the folder when the run ends. Outside Vitest, as in `npm run store:assets`, `testBridge()` makes its own copy and deletes it when the process exits. `startAgent` starts every server with `AGENT_BROWSER_BRIDGE_PORT` set to that port, and Chromium, the simulated Safari and the Safari setup page all load the test copy.

This keeps the tests away from a real agent session on the same machine in both directions. A real browser extension connects only to 17373, so it never reaches a test server, and the test extension connects only to its own port, so it never reaches the real server. The suite therefore runs while an agent session holds 17373, and so do `npm run test:e2e:mcpb` and `npm run store:assets`.

The same two variables run a development build beside a released one by hand:

```bash
VITE_BRIDGE_PORT=17374 npm run build -w agent-browser-bridge-extension
```

```bash
AGENT_BROWSER_BRIDGE_PORT=17374 node packages/server/dist/index.js
```

`e2e/support/harness.ts` holds the shared setup. Add fixtures as plain HTML files in `e2e/support/fixtures/`. Put a new test file in the folder for the use case it covers, or start a new folder for a new one. `startHarness` returns `openAnotherProfile()` to launch a second Chromium profile with the extension, and also takes a browser locale, device scale factor, colour scheme and the MCP client name and version the agent reports. The tests use the defaults; the [store asset generator](chrome-web-store.md#store-assets) sets them.

### Stale element refs

A ref from `chrome_page_snapshot` stops working once its element leaves the page. `chrome.debugger.sendCommand` rejects with an `Error` whose message is the CDP error as a JSON string, and `withStaleRefHint` in `extensions/browser/src/background/page.ts` matches on that text to replace it with `Element eN no longer exists; take a new chrome_page_snapshot.` These are the messages Chromium returns:

| Situation | Message |
| --- | --- |
| Element removed from the DOM | `{"code":-32000,"message":"Node is detached from document"}` |
| Tab reloaded or navigated to another page | `{"code":-32000,"message":"Node does not have a layout object"}` |
| Element still attached but hidden with `display: none` | `{"code":-32000,"message":"Node does not have a layout object"}` |
| Node already discarded by the browser | `No node found for given backend id` and similar |

A hidden element gets the same hint as a removed one. It is absent from a new snapshot, so the advice still holds. The end-to-end suite covers the first two rows against real Chromium, and the unit tests cover every pattern with the JSON-shaped messages.

### Things to know

- A running agent session does not need to be closed. The files run one at a time and share the run's port and test copy of the extension.
- The test browser cannot resolve any host other than `127.0.0.1`, so nothing leaves the machine, including analytics if your local build has a key.
- Locally you need Playwright's Chromium once: `npx playwright install chromium`.
- To run against an existing build without rebuilding: `npx vitest run --config vitest.e2e.config.ts`.
- To watch the browser, change `headless` to `false` in `e2e/support/harness.ts`.

## Safari

Safari only loads an extension from a signed app, or from an unsigned one after a person turns on **Allow Unsigned Extensions** and enters their password, and that setting resets when Safari quits. Neither works on a CI machine, so no test drives real Safari. Two checks cover what can be automated, and a [manual check](#checking-real-safari-by-hand) covers the rest.

`safaridriver` on GitHub's macOS runners (Safari 27.2) can load an unpacked extension into an automation session with the WebDriver command `POST /session/{id}/webextension`, so this was tried in November 2026 as a replacement for the manual check. Safari accepted the extension, but its background script did not run reliably: in some runs it ran for a moment and opened a tab, in others it did not run at all, and in no run did a WebSocket connection or a `fetch` from it reach the machine. A non-persistent background page in place of the service worker behaved the same way. The extension never connected to the bridge, so there is no real Safari test. Try again when Safari or `safaridriver` changes; the attempt is in the history of the pull request that added this paragraph.

### Simulated Safari

`e2e/safari/safari.test.ts` runs as part of `npm run test:e2e`, on Linux as well as macOS. It starts the built MCP server like the Chromium tests do, but instead of a browser it uses `e2e/support/safari/simulatedSafari.ts`:

1. It reads `manifest.json` from the test copy of `extensions/browser/dist`, turns it into the Safari manifest with `safariManifest` (`extensions/browser/src/safariManifest.ts`), and runs the background script as a classic script. It refuses a manifest whose background is a service worker: Safari 27 lists such a worker under **Develop > Web Extension Background Content** but never runs it, so the extension never connects. The Safari build runs the same `background.js` as a non-persistent background page instead.
2. The script gets a `chrome` object that has only what Safari offers: no `chrome.debugger`, `chrome.tabGroups` or `runtime.onUpdateAvailable`, and tabs without `groupId`, `discarded` or `lastAccessed`.
3. Its WebSocket sends a `safari-web-extension://` origin, so the server treats it as Safari.
4. Windows, tabs, page loads, back and forward history, extension storage, alarms and the toolbar button are kept in memory. `fetch` always fails, so nothing leaves the machine.

The tests then call the `safari_*` tools through MCP and compare the results with the simulated browser's own state. They cover connecting as Safari, the setup page opening on install and from the toolbar button, the toolbar icon and title, every Safari tool, naming the Safari instance, and reconnecting to a new agent session.

One test opens the built setup page the way Safari would (`e2e/support/safari/setupPage.ts`). Chromium renders it, but the page gets a `safari-web-extension://` extension URL and its messages go to the simulated Safari's background script. The test checks that the page shows the Safari wording and the connection, and none of the Chrome wording. The setup page marks wording for one browser with `data-browser="chrome"` or `data-browser="safari"`, and `extensions/browser/src/settings/browserContent.ts` hides the other.

This catches code that Safari cannot run. If the background script reaches for an API the simulation does not have, the test fails and says which one and what MDN knows about it:

```text
The background script failed to start in the simulated Safari: Cannot read properties of undefined (reading 'addListener')
Extension APIs it looked for that the simulated Safari does not offer:
- runtime.onUpdateAvailable: MDN lists it as not supported in Safari
```

When the message says Safari has the API but the simulation does not, add it to the `api` object in `e2e/support/safari/simulatedSafari.ts`. When it says Safari does not support it, guard the call in the extension.

The simulation cannot drift into offering more than Safari does. A test compares every API it offers with MDN's browser compatibility data (the `@mdn/browser-compat-data` package) and fails if one is missing from Safari or newer than `SAFARI_VERSION` in `simulatedSafari.ts`. That constant is the Safari version the extension needs. It is 27 because `tabs.move`, which `safari_tabs_move` uses, arrived in Safari 27. Update the package now and then to pick up MDN's corrections.

What the simulation does not prove: that real Safari behaves the way MDN and the simulation say, how Safari handles website access for tab titles and URLs, how long it keeps the background script alive, and how Safari itself lays out the setup page.

### Safari app build

`npm run test:safari-app -w agent-browser-bridge-extension` needs macOS with Xcode. Presubmit runs it on a macOS runner. `extensions/browser/scripts/check-safari-app.mjs`:

1. builds the extension and generates the Xcode project through `npm run build:safari`, without opening Xcode,
2. builds the generated Xcode project with `xcodebuild`, without code signing,
3. checks that the extension bundle inside the app contains the same `background.js` as `extensions/browser/dist`, the manifest from `safariManifest`, and the icons and pages,
4. checks that the Xcode project uses the committed app icon, and that the built app's icon includes the 1024 pixel image the App Store asks for,
5. checks that the built app's Info.plist has the bundle identifier, version, App Store category, minimum macOS version and export compliance key the App Store needs.

On GitHub the job summary shows the converter's output, including any manifest keys the installed Safari does not support.

`npm run build:safari` runs `extensions/browser/scripts/build-safari.mjs`. Apple's `safari-web-extension-converter` gives the app a bundle identifier made from its name, which does not match the extension's `dev.agentbrowserbridge.app.Extension`, and Xcode refuses to build an extension whose identifier does not start with its app's. The script sets the app's identifier to `dev.agentbrowserbridge.app` after converting, and fails if the project holds any other identifier. It also sets the version, build number, minimum macOS version and App Store keys the release needs; see [Mac App Store releases](safari-app-store.md#how-the-app-is-built).

The converter also builds the app icon by enlarging the extension's 128 pixel icon. The script replaces it with the icon set in `extensions/browser/safari-app/AppIcon.appiconset`, which follows the macOS icon shape and has every size up to 1024 pixels, and uses the same artwork for the icon shown in the app's window. `npm run icons -w agent-browser-bridge-extension` draws that set, along with the extension's own icons, from `extensions/browser/scripts/render-icons.mjs`. It needs Chrome; set `CHROME_PATH` if it is not in the default macOS location.

This proves the app can be built from a clean checkout. It does not sign, notarise or install the app.

### Checking real Safari by hand

Do this before a Safari release and after changing anything the Safari tools use. Build and run the app as the [README](../README.md#safari) describes, start an agent session, then:

1. Check that the setup page opens and its status turns green, and that the toolbar button shows the connected icon.
2. Ask the agent for `browser_status`. Safari should be listed with the right extension version.
3. Call each tool once: `safari_windows_list`, `safari_windows_create` with URLs and with a `tabId`, `safari_windows_update` with `state` and with bounds, `safari_windows_remove`, `safari_tabs_list`, `safari_tabs_create`, `safari_tabs_navigate` with a URL and with `back`, `safari_tabs_update` with `active`, `pinned` and `muted`, `safari_tabs_duplicate`, `safari_tabs_move`, `safari_tabs_wait_for` with a `url` the tab reaches after you click a link, and `safari_tabs_close`.
4. Check that tab titles and URLs are present. If they are empty, website access has not been granted.
5. Leave Safari idle for a few minutes, then call a tool again to check that the extension is still connected or reconnects.
6. End the agent session and start a new one, and check that Safari reconnects within about 30 seconds.

Build the app inside the repository, for example with Xcode's default derived data or under `extensions/browser/safari-release/`. In testing, Safari did not load the background script of the same app built under `/private/tmp`.

If real Safari behaves differently from the simulation, change the simulation to match and add a test for it.
