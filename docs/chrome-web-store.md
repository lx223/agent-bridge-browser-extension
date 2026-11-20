# Chrome Web Store submission

The following copy was used for the 0.3.0 submission on 17 November 2026. Review it against the extension's current behaviour before each submission. The store listing is managed in the [developer dashboard](https://chrome.google.com/webstore/devconsole/10394421-983d-4910-9716-1828882027b8/kmhcfgambmbglmgdjmdlkhcfkfpkddgb/edit).

## Store description

Control your own browser with any AI agent you like.

Connect your AI coding agent to your everyday Chrome browser through Model Context Protocol (MCP).

Agent Browser Bridge lets a connected agent list, open, focus and close windows and tabs, organise tabs into named and coloured groups, move, pin, mute, duplicate and unload tabs, and close tabs on request. Preview a grouping plan before applying it, and undo the last plan to restore the previous layout.

Agents can also help you pick up earlier work: search your browsing history, list recently closed tabs and the tabs open on your other signed-in devices, and reopen them.

Connected agents can also inspect and operate web pages, navigate, click, type, and use page-provided WebMCP tools. The debugger permission enables this page control through the Chrome DevTools Protocol. Only connect agents you trust: they can receive tab titles, URLs and page contents and interact with pages on your behalf.

The setup page shows connection status and provides configuration options for Cursor, VS Code, Claude Code and other MCP-compatible agents. A separate local Agent Browser Bridge MCP server is required. The extension connects to that server on your computer.

Anonymous product usage analytics can be turned off in the extension settings. See the privacy policy for details.

## Single purpose

Allow a user-selected MCP agent to inspect and organise Chrome tabs and operate web pages through a local bridge server.

## Permission justifications

| Permission | Justification |
| --- | --- |
| tabs | Read tab titles, URLs and window membership so the connected MCP agent can list tabs and organise them at the user's request. Also supports moving, grouping and closing tabs. |
| tabGroups | Read and update Chrome tab groups, including names, colours, collapsed state and position, to apply the user's requested organisation plan. |
| storage | Store the previous tab and group layout for undo, the browser instance identifier, and the user's analytics preference. |
| history | Search the user's browsing history and list visits to a page when the connected MCP agent is asked to find or recap something the user viewed earlier, including pages whose tabs are closed. The extension only reads history; it does not add or delete entries. |
| sessions | List recently closed tabs and windows and the tabs open on the user's other signed-in devices, and reopen them with their navigation history when the user's agent is asked to. The tabs API cannot see closed tabs or other devices. |
| alarms | Periodically wake the extension service worker to reconnect to the local MCP bridge when the worker has been suspended. |
| debugger | The debugger permission enables Chrome DevTools Protocol access to tabs for browser actions requested by the user through their connected MCP agent. It is needed to inspect page structure and content, capture screenshots, navigate, click, type, scroll, and invoke page-provided WebMCP tools. These operations are routed through the local MCP bridge; ordinary tabs and tabGroups APIs cannot provide page inspection or interaction. |

## Data disclosures

The 0.3.0 submission declares Web history, User activity and Website content. Web history covers tab titles and URLs; Website content covers information returned by page tools; User activity covers usage analytics. Consult [the privacy policy](../PRIVACY.md) for the data processed by page tools and the analytics events, destination and opt-out controls.

Privacy policy URL: https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md

The store declarations state that data is not sold or transferred outside approved use cases, used for unrelated purposes, or used to determine creditworthiness or for lending. Check these declarations against current behaviour before submitting.

## Screenshots

`npm run screenshots` builds the extension and the MCP server, then writes 1280x800 PNG screenshots for every locale to `store/screenshots/out/<locale>/`. That folder is not committed. Upload the files for each language under Store listing in the developer dashboard. The number at the start of each file name gives its position in the listing.

```bash
npm run screenshots
npm run screenshots -- --locale de,ja
npm run screenshots -- --locale en --scene tabs,pages
npm run screenshots -- --out ~/Desktop/store-screenshots
```

| File | Shows |
| --- | --- |
| `1-tabs.png` | An agent grouping open tabs by topic with `chrome_apply_tab_plan` |
| `2-pages.png` | An agent filling in and submitting a booking form, with the page captured by `chrome_screenshot` |
| `3-profiles.png` | An agent naming the browser profile, and the options popup showing the name |
| `4-setup.png` | The setup page with an agent connected |

The script uses the end-to-end harness (`e2e/harness.ts`). Each screenshot comes from a real session: the built MCP server, the built extension in headless Chromium, and demo pages served on `127.0.0.1`. The tab groups, form contents, tool names and extension pages are what the extension actually produced. The caption, the chat transcript and the window frame around each capture are drawn by the script. Chromium starts with the locale's language, so the demo pages and the browser use it too. The extension's own pages are English only, because the extension is not localised yet.

Like the end-to-end tests, the script needs port 17373 free and Playwright's Chromium installed. Japanese and Chinese need CJK fonts on the machine. macOS and Windows have them; on Linux install a package such as `fonts-noto-cjk`.

### Locales

Each file in `store/screenshots/locales/` is one store language, named with the Chrome Web Store locale code, such as `de.json`, `pt_BR.json` or `zh_CN.json`. It holds the captions, the chat transcript and the demo page text. `en.json` is the reference.

To add a language, copy `en.json` to the new code and translate every value. Keep placeholders such as `{tabs}` and keep the same number of entries in each list. The script and `npm test` both reject a locale file with missing, extra or empty strings, or with different placeholders. If a caption or transcript is too long for its box, the script still writes the file but lists the text that was cut off and exits with an error, so shorten that text and run it again.

The translations other than English were written without a native speaker review. Have them checked before you publish them.

### Layout

`store/screenshots/scenes.ts` drives each scene through MCP tool calls and returns the content for the frame. `store/screenshots/frame.ts` holds the caption, chat and window templates and their sizes. `store/screenshots/demo.ts` serves the demo pages built from the locale strings. To add a scene, add its name to `sceneNames` in `store/screenshots/locale.ts`, a caption for it in every locale file, and a capture function in `scenes.ts`.

## Release steps

1. Run the repository checks and the Publish Release workflow on the intended main commit.
2. Download the extension ZIP from that GitHub release and verify its manifest version.
3. Upload the ZIP under Package in the developer dashboard.
4. Review the description, permission justifications and data disclosures above against the new package and privacy policy. If the release changes what the extension looks like or does, regenerate the [screenshots](#screenshots) and upload them. Save the draft.
   The `history` and `sessions` permissions added after 0.4.1 change Chrome's install warning to "Read and change your browsing history on all your signed-in devices". When an update adds a warning like this, Chrome disables the extension for existing users until they accept it, so the bridge stays disconnected for them until then. Mention this in the release notes.
5. Submit for review. The 0.3.0 submission kept the existing tester distribution and enabled automatic publication after approval.
6. Verify that the dashboard reports Pending review. Submission does not mean the update is already published.

The MCP server is released separately through the Publish npm package workflow. See [npm publishing](npm-publishing.md) for its trusted publisher configuration.
