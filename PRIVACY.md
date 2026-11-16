# Agent Browser Bridge privacy policy

Last updated: 16 November 2026

Agent Browser Bridge connects Chrome tabs and tab groups to an MCP-compatible agent through a bridge server running on your computer.

## Information used

When a connected agent requests browser information, the extension can send tab titles and URLs, tab and window identifiers, tab order and state (such as pinned, active, audible, discarded and last-accessed time), window properties, and tab-group names, colours and layout to the local bridge. The connection handshake also includes the extension version and browser user-agent string. URLs and tab titles may contain personal or sensitive information.

The extension uses Chrome session storage to keep the previous tab and group layout for the undo feature. That snapshot contains tab identifiers, positions, group membership, group names and a timestamp. It is replaced by a later applied plan, removed after undo, and cleared when the browser session ends.

## Where information goes

The extension connects to a WebSocket server at 127.0.0.1:17373 on your computer. It does not send analytics, advertising data or telemetry to the developer and does not operate a developer-hosted data collection service. It does not read webpage bodies, passwords, cookies or form contents.

The local MCP server passes tool results to the agent you connect. Your chosen agent or its model provider may transmit, process or retain those results under its own privacy policy and settings. Local communication between the extension and bridge does not mean that your agent processes data only on your device. Only connect agents you trust.

## Use and sharing

Browser information is used to provide the extension's single purpose: letting your connected agent inspect and organise tabs and tab groups. The developer does not sell browser data, use it for advertising, use it for unrelated purposes, or use it to determine creditworthiness or for lending. Data is shared with the bridge and your selected agent to provide the requested functionality.

## Your choices

You control which agent you connect and its permissions. A connected agent can request browser information and change, move, group or close tabs. Disconnect the agent or stop the local MCP server to stop bridge communication; disable or uninstall the extension to stop its operation. Removing the extension removes its extension storage. Consult your agent provider about deleting information it has received.

## Changes and contact

This policy may be updated when the extension's data practices change. For privacy questions, contact the maintainer through GitHub: https://github.com/lx223.
