# Agent sessions

Several agent sessions can share the bridge at once, for example Claude Code in one project and Codex in another. The extension's setup page (click the toolbar icon or open the extension's options) shows one card for each session.

## What a card shows

- **Agent:** the name and version the MCP client reports for itself, such as `claude-code 2.1.80`.
- **Project:** the folder the agent is working in. Hover over it to see the full path.
- **Start time:** when the session started.
- **Last activity:** the last browser tool the session called, when, and how many calls it has made.
- **Browser profiles used:** each profile the session has used, most recent first, by name if it has one (see [profiles.md](profiles.md)). The one you are looking at is marked "this browser".
- **Dot:** green while the session has used a browser in the last two minutes.

Hovering over a card shows the session id and the bridge server version.

## Where the information comes from

**Session id and start time.** The process an agent starts is the launcher (see [updates.md](updates.md)). It creates a random session id and records the start time, then passes both to each worker it runs. A session therefore keeps its identity when the server updates itself in the background. While an old worker hands over to a new one, both briefly report the same session id, and the bridge shows only the newer one. The Claude Desktop bundle runs the worker without a launcher, so the worker makes up its own id.

**Project.** The server asks the agent for its workspace folders (MCP roots) after it connects, and asks again whenever the agent says they changed. The first local folder that is not the home folder or the filesystem root becomes the project, using the root's name if the agent gives one. Agents that don't share roots are covered by the server's working directory, because most agents start the server in the project folder. If that directory is the home folder or the filesystem root, no project is shown.

**Activity.** The bridge server that hosts the connection for all sessions sees every browser request, along with the session that sent it. For each session it records the time, the tool, a call count and the browser profiles used (up to eight). It sends the session list to every connected browser when a session joins or leaves and, at most four times a second, after browser activity. Activity is kept in memory only:
- It starts again when another server takes over hosting.
- It is forgotten when the session disconnects.

## Privacy

Session details stay on your computer: the bridge sends them to the extension over `127.0.0.1`, and the extension only displays them. Usage analytics still include only the agent's name and version, never the project or session id. See [PRIVACY.md](../PRIVACY.md).
