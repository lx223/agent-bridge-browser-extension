# Setup page

The setup page (`packages/extension/src/welcome/`) opens when the extension is installed, whenever the toolbar icon is clicked, and from the extension's Options entry, where it opens in a full tab. There is no separate options page. The installed extension version, read from the manifest, sits next to the title so it is easy to quote in a bug report. Below that, the page is laid out top to bottom in the order a new user needs it:

1. **This profile and its connection.** One card at the top. Its first row names this browser profile (see [profiles](profiles.md)): the name is edited in place, with a badge showing its first letter. Enter or leaving the field saves it and shows a short "Saved" confirmation, and Escape cancels the edit. The explanation of what the name is for only shows while the profile has no name or the name is being edited. Below that, the connection status is amber while no agent is connected and green once one is, with the connected agent sessions listed underneath (see [sessions](sessions.md)).
2. **Connect your agent.** One tab per agent: Claude Code, Claude Desktop, Cursor, VS Code and Other (a JSON MCP config). Only the chosen agent's instructions are shown, and the page remembers the last tab picked. Below the tabs, a copyable prompt lets any agent that can run commands set itself up.
3. **Ask it something.** Example prompts for the current browser, each with a copy button.
4. **Privacy.** The anonymous usage statistics toggle when the build collects them, and the privacy summary.

When the page opens and an agent is already connected, the "Connect your agent" step starts collapsed and marked done, so the prompts to try come first. It stays where the user left it after that, so the page never jumps while someone is following the setup steps.

Every piece of text on the page comes from the extension's messages, so it follows the browser's language; see [localisation](localisation.md). The status wording is picked in `status.ts`, the profile badge letter in `profile.ts`, and the tab order and keyboard handling in `agentTabs.ts`, all unit tested. The page itself is covered by the end-to-end tests in `e2e/connection/extension.test.ts` and `e2e/safari/safari.test.ts`.
