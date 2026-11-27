# Agent Browser Bridge privacy policy

Last updated: 27 November 2026

Agent Browser Bridge connects your browser's tabs, tab groups and web pages to an MCP-compatible agent through a bridge server running on your computer. It runs in Chrome, in other Chromium browsers such as Edge and Brave, and in Safari. Safari offers fewer tools, so less information is used there; see [Safari](#safari).

## Information used

When a connected agent requests browser information, the extension can send tab titles and URLs, tab and window identifiers, tab order and state (such as pinned, active, audible, muted, discarded and last-accessed time), window properties, and tab-group names, colours and layout to the local bridge. The connection handshake also includes the extension version and browser user-agent string. URLs and tab titles may contain personal or sensitive information.

When a connected agent searches history or sessions, the extension uses Chrome's `history` and `sessions` permissions and can send to the local bridge the URLs, titles, visit times, visit counts and how each visit started (such as a typed address or a followed link) for the pages that match; the tabs and windows you closed recently; and, when Chrome sync is on, the names of your other signed-in devices and the titles and URLs of the tabs open on them. The extension does not add to or delete your history.

When a connected agent uses bookmarks, Reading List, download or most-visited-site tools, the extension uses the matching Chrome permissions and can send to the local bridge the titles, URLs, folders and dates of your bookmarks and Reading List entries; the URLs, file names and paths, sizes, types, times and state of your downloads; and the titles and URLs of your most visited sites. The agent can also create, change, move and remove bookmarks and Reading List entries, start downloads, show a downloaded file in its folder, and remove entries from the download list; the extension does not open or delete downloaded files. Search tools send the text the agent searches for to your default search engine, as if you typed it, and notifications show text the agent writes on your desktop.

When a connected agent uses page tools, the extension uses Chrome's `debugger` permission to attach to the requested tab and can send that page's content to the local bridge: its accessibility tree (visible text, labels, form field values and element roles), screenshots, the results of JavaScript the agent evaluates in the page, and the results of DevTools Protocol commands the agent sends. Depending on what the agent requests, this can include anything the page shows or holds, such as messages, account details, form contents and cookies. Page tools also let the agent click, type, scroll and navigate in the page as you.

The extension uses Chrome session storage to keep the previous tab and group layout for the undo feature. That snapshot contains tab identifiers, positions, group membership, group names and a timestamp. It is replaced by a later applied plan, removed after undo, and cleared when the browser session ends.

When an agent asks you to confirm something with `browser_ask_user`, the extension brings the tab to the front and shows the question in a popover inside that page. In Chrome it uses the `debugger` permission to add the popover, and also shows a desktop notification; in Safari it uses the `scripting` permission. The extension sends back only your answer, the tab's identifier, title and URL. It does not read the page for this. The question is part of the page while it shows, so the website can read its text.

When an agent uses the chat panel, the extension keeps that conversation in Chrome session storage: the messages the agent and you write, when they were sent, the name of the agent session, and the id and name the agent chose for the conversation. Each message you send also includes the title and URL of the tab you were looking at. Your messages go only to the agent session the conversation belongs to, through the local bridge. Chrome clears the conversations when the browser session ends or the extension updates or reloads, the extension removes a conversation a day after it ended or its agent disconnected, and you can remove a conversation from the panel. Chat messages are not included in usage analytics.

The local bridge also tells the extension which agent sessions are connected, so the setup page can list them. For each session this includes the name and version the agent reports for itself, a random session identifier, when the session started, the name and path of the project folder the agent is working in, the last browser tool it used and when, how many tool calls it made, and which browser profiles it used. The extension only shows this on its own pages; it is not stored and not included in usage analytics.

### Safari

In Safari the extension has window and tab tools only. A connected agent can list, open, focus, resize and close windows, and list, open, navigate, switch to, pin, mute, duplicate, move and close tabs, and ask you to confirm something in a popover in a page. For this the extension can send tab titles and URLs, tab and window identifiers, and tab order and state to the local bridge, together with the extension version and browser user-agent string in the connection handshake. Safari gives the extension a tab's title and URL only for websites you have allowed the extension on.

The history, sessions, bookmarks, Reading List, downloads, most-visited-sites, search, notification, tab-group and page tools do not exist in Safari. The extension does not read page content, browsing history, bookmarks or downloads there, and it keeps no undo snapshot. The list of connected agent sessions, where information goes, and usage analytics work as described in the rest of this policy.

## Where information goes

The extension connects to a WebSocket server at 127.0.0.1:17373 on your computer. It reads webpage content only when a connected agent calls a page tool for a specific tab, and it does not send advertising data.

The local MCP server passes tool results to the agent you connect. Your chosen agent or its model provider may transmit, process or retain those results under its own privacy policy and settings. Local communication between the extension and bridge does not mean that your agent processes data only on your device. Only connect agents you trust.

### Remote access

Remote access is off by default. When you turn it on in the setup page, the extension also opens a WebSocket connection to the relay server address you enter, which must use HTTPS. The extension proves it knows the browser token you entered without sending the token, checks that the relay can prove the same, and then sends the relay the same handshake as the local bridge. Agents that present the relay's agent token can then use every tool described above, and the relay passes their requests and the browser's answers, including tab titles, URLs, history, bookmarks, page contents and screenshots, between them. The relay also tells the extension which agent sessions are connected through it, with the name and version each agent reports.

Whoever runs the relay can see that traffic. The relay in this project keeps it in memory only while passing it on and does not store it, but only use a relay you run yourself. Switch remote access off to close the connection. The relay address and browser token stay in the extension's local storage in this browser profile and are not synced.

## Usage analytics

Release builds send anonymous usage events to PostHog (EU region, eu.i.posthog.com) so the developer can see whether setup works, which features are used and whether people keep using the extension. Events are:

- extension installed or updated, with whether it was installed from a store or loaded unpacked, setup page opened, setup link clicked or snippet copied;
- the first time an agent connects and the first time a tab plan is applied, with minutes since install;
- once a day while the browser is open: whether an agent is connected, the number of open windows, the number of open tabs as a range (such as 11–25), and whether the extension was installed from a store or loaded unpacked;
- each tool call: the tool name, whether it succeeded, how long it took, a fixed error category on failure (such as "tab not found"), and counts such as how many tabs or groups it affected, how many results a history or recently closed search returned, whether it was a preview, and minutes between applying a plan and undoing it.

Events also include the extension version, the MCP server version, and the name and version the connected agent reports for itself (such as "claude-code"). Each event includes a random identifier generated on install and kept in extension local storage. Events never include tab titles, URLs, domains, tab or window contents, tab-group names, error messages, or tool parameters or results. PostHog receives your IP address as part of the network request; the PostHog project is configured to discard it.

When analytics is on, uninstalling the extension may open a short optional PostHog survey asking why you left, linked to the same random identifier.

Usage analytics are on by default. You can turn them off at any time with the "Share anonymous usage statistics" checkbox on the setup page (right-click the toolbar icon and choose Options, or click the gear button in the side panel). Builds made from source without a PostHog key send no analytics.

## Website

The project website at lanxiao.dev/agent-bridge-browser-extension counts visits with PostHog (EU region) in cookieless mode. It sets no cookies and stores nothing in your browser, so it cannot recognise you on a later visit or on another site. It records:

- each page view and when you leave the page: the page address, the referring website, campaign tags in the link you followed (such as `utm_source`), and your browser, operating system and screen size;
- when you reach the install steps on the home page;
- when you follow a link to the Chrome Web Store, GitHub releases, the Claude Desktop extension download, GitHub or npm, and which part of the page the link was in;
- when you copy one of the install snippets, and which one.

PostHog groups a day's page views into visits with a hash of your IP address, user agent and a random value it changes every day. It removes the IP address before storing the event and does not look up your location from it. The website records no clicks or text beyond the list above, no session recordings and no form input. If your browser or an ad blocker stops the PostHog script from loading, the website works the same and sends nothing.

Links from the website to the Chrome Web Store carry `utm_source=website`, so the store's own statistics can count installs that started on the website. The Chrome Web Store handles that visit under Google's privacy policy.

## Use and sharing

Browser information is used to provide the extension's single purpose: letting your connected agent inspect and organise tabs and tab groups, and read and operate web pages on your behalf. The developer does not sell browser data, use it for advertising, use it for unrelated purposes, or use it to determine creditworthiness or for lending. Data is shared with the bridge and your selected agent to provide the requested functionality.

## Your choices

You control which agent you connect and its permissions. A connected agent can request browser information, including your browsing history and the tabs on your other signed-in devices; open, change, move, group, unload or close tabs and windows; reopen closed tabs; change your bookmarks and Reading List; start downloads; search with your default search engine; show you notifications; and read pages and act in them as you, including submitting forms. Chrome shows a banner while the extension is attached to a page; cancelling it detaches the extension from that tab. In Safari a connected agent can only list, open, focus, resize and close windows, list, open, navigate, switch to, pin, mute, duplicate, move and close tabs, and ask you to confirm something in a page. Disconnect the agent or stop the local MCP server to stop bridge communication; disable or uninstall the extension to stop its operation. Removing the extension removes its extension storage, including the analytics identifier. Consult your agent provider about deleting information it has received.

## Changes and contact

This policy may be updated when the extension's data practices change. For privacy questions, contact the maintainer through GitHub: https://github.com/lx223.
