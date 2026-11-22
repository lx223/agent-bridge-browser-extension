# Mac App Store Submission

Copy for App Store Connect. Review it against the build and the [privacy policy](../../PRIVACY.md) before each submission. Release procedure: [Mac App Store releases](../../docs/safari-app-store.md).

## App information

| Field | Value |
| --- | --- |
| Name (30 characters) | Agent Browser Bridge |
| Subtitle (30 characters) | Let AI agents use Safari tabs |
| Bundle ID | dev.agentbrowserbridge.app |
| SKU | agent-browser-bridge |
| Primary category | Developer Tools |
| Secondary category | Productivity |
| Price | Free |
| Availability | Every country or region except China mainland, which needs AI-generated content and security filings |
| EU trader status | Not a trader under the Digital Services Act |
| Content rights | Does not contain, show or access third-party content |
| Privacy policy URL | https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md |
| Support URL | https://github.com/lx223/agent-bridge-browser-extension/issues |
| Marketing URL | https://github.com/lx223/agent-bridge-browser-extension |
| Copyright | 2026 Lan Xiao |

## Promotional text (170 characters)

Let Claude Code, Cursor, VS Code or any MCP agent list, open, navigate, move and close your Safari tabs through a bridge that runs on your Mac.

## Keywords (100 characters)

```
mcp,ai agent,model context protocol,tabs,windows,automation,llm,assistant,developer tools,agents
```

## Description (4,000 characters)

Control your own browser with any AI agent you like.

Agent Browser Bridge connects your everyday Safari to an AI agent through the Model Context Protocol (MCP). Ask your agent to find the tab you had open, open a set of pages for a task, tidy tabs between windows or close what you no longer need.

A connected agent can:
• list your Safari windows and tabs, with their titles and URLs
• open new tabs and navigate tabs to a page, back or forward
• move tabs within and between windows
• close tabs you ask it to close

Agent Browser Bridge works with Claude Code, Claude Desktop, Cursor, VS Code and other MCP-compatible agents. It needs the free Agent Browser Bridge MCP server, which your agent runs on your Mac with Node.js. The app's setup page shows the one-line configuration for each agent and turns green when an agent connects. Several agents can share one Safari at once, and Chrome can connect alongside it.

Your tabs stay between Safari and the agent you choose. The extension talks only to the bridge on your own Mac; the agent you connect may send what it receives to its model provider under its own privacy policy, so connect only agents you trust. Safari only lets the extension read the titles and URLs of websites you allow.

Anonymous usage statistics, which never include titles, URLs or page content, can be turned off on the setup page.

Open source under the Apache 2.0 licence.

## What's New

Write per release from the GitHub release notes, mentioning only what changed for Safari.

## App Privacy

Answer **Yes, we collect data from this app**, and declare only the usage analytics described in the privacy policy. Tab titles and URLs go to the bridge on the user's Mac and to the agent the user chooses, not to the developer, so they are not collected in App Store terms.

| Data type | Use | Linked to the user | Used for tracking |
| --- | --- | --- | --- |
| Usage Data: Product Interaction | Analytics | No | No |
| Diagnostics: Performance Data | Analytics | No | No |
| Diagnostics: Other Diagnostic Data | Analytics | No | No |

Product interaction covers setup page events, tool names and counts. Performance data covers tool call durations. Other diagnostic data covers the fixed error categories. The random install identifier only links events to each other, not to a person or account, so the data is not linked to the user.

## Age rating

Answer **None** or **No** to every question, including Unrestricted Web Access: the app shows only its own setup screen, and browsing happens in Safari. The result is 4+.

## App Review Information

Sign-in required: No.

Notes:

```
Agent Browser Bridge is a Safari web extension that lets an AI agent the user runs on their Mac (an MCP client such as Claude Code, Cursor or VS Code) list, open, navigate, move and close Safari tabs. The app itself only shows how to turn the extension on.

The extension connects to a local MCP server on 127.0.0.1:17373, which the user's agent starts. To test without an AI agent, use the official MCP Inspector, which needs Node.js 20 or later:

1. Open the app, click the button, and turn on Agent Browser Bridge in Safari Settings > Extensions. Allow it on all websites so it can read tab titles and URLs.
2. In Terminal, run:
   npx -y @modelcontextprotocol/inspector npx -y agent-browser-bridge-mcp@latest
3. In the Inspector page that opens, click Connect, then Tools > List Tools.
4. Run safari_tabs_list to see the open Safari tabs, then safari_tabs_create with a URL such as https://example.com to open a tab. The extension's toolbar icon turns green while connected; click it to see the setup page and the connected session.
```

## Screenshots and app preview

`npm run store:assets -- --store safari` writes these files to `store/assets/out/safari/`. Upload them under the macOS version's App Previews and Screenshots. Do not reuse the Chrome Web Store files: they show tab groups and page tools that Safari does not have.

- `1-setup.png`: 1280x800, the built setup page in its Safari wording, connected to one agent session.
- `2-tabs.png`: 1280x800, an agent opening and closing Safari tabs with the `safari_*` tools.
- `app-preview.mp4`: 1920x1080 H.264 with a silent stereo AAC track, about 20 seconds. It plays both scenes between an opening and a closing title card. App Store previews must last 15 to 30 seconds, and the script fails if the video falls outside that range. Pick a poster frame from the first scene after uploading.

The script needs neither the bridge nor a running agent. It loads the real built setup page in Playwright's Chromium, posing as Safari through `e2e/support/safari/setupPage.ts`, with a stubbed background that reports one connected session. The tabs scene is drawn in HTML from fixed text in `store/assets/safari.ts`, in three states: the old search tabs, the new pages opened beside them, and the new pages alone. Both use the caption, window, chat and video templates of the Chrome Web Store assets; see [Store assets](../../docs/chrome-web-store.md#store-assets).
