# Chrome Web Store submission

The following copy was used for the 0.3.0 submission on 17 November 2026. Review it against the extension's current behaviour before each submission. The store listing is managed in the [developer dashboard](https://chrome.google.com/webstore/devconsole/10394421-983d-4910-9716-1828882027b8/kmhcfgambmbglmgdjmdlkhcfkfpkddgb/edit).

## Store description

Connect your AI coding agent to your everyday Chrome browser through Model Context Protocol (MCP).

Agent Browser Bridge lets a connected agent list windows and tabs, organise tabs into named and coloured groups, move tabs and groups, and close tabs on request. Preview a grouping plan before applying it, and undo the last plan to restore the previous layout.

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
| alarms | Periodically wake the extension service worker to reconnect to the local MCP bridge when the worker has been suspended. |
| debugger | The debugger permission enables Chrome DevTools Protocol access to tabs for browser actions requested by the user through their connected MCP agent. It is needed to inspect page structure and content, capture screenshots, navigate, click, type, scroll, and invoke page-provided WebMCP tools. These operations are routed through the local MCP bridge; ordinary tabs and tabGroups APIs cannot provide page inspection or interaction. |

## Data disclosures

The 0.3.0 submission declares Web history, User activity and Website content. Web history covers tab titles and URLs; Website content covers information returned by page tools; User activity covers usage analytics. Consult [the privacy policy](../PRIVACY.md) for the data processed by page tools and the analytics events, destination and opt-out controls.

Privacy policy URL: https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md

The store declarations state that data is not sold or transferred outside approved use cases, used for unrelated purposes, or used to determine creditworthiness or for lending. Check these declarations against current behaviour before submitting.

## Release steps

1. Run the repository checks and the Publish Release workflow on the intended main commit.
2. Download the extension ZIP from that GitHub release and verify its manifest version.
3. Upload the ZIP under Package in the developer dashboard.
4. Review the description, permission justifications and data disclosures above against the new package and privacy policy. Save the draft.
5. Submit for review. The 0.3.0 submission kept the existing tester distribution and enabled automatic publication after approval.
6. Verify that the dashboard reports Pending review. Submission does not mean the update is already published.

The MCP server is released separately through the Publish npm package workflow and any approval required on npm's staged packages page.
