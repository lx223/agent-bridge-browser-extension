# Several browsers and profiles

Each browser profile with the extension installed connects to the bridge on its own, so an agent can see several at once: two Chrome profiles, Chrome and Edge, or Chrome and Safari.

## How an instance is identified

Every profile has an **instance**:

- **Instance id.** The extension makes up a random 8-character id the first time it runs and keeps it in the profile's extension storage. Other profiles have their own storage, so their ids differ.
- **Name.** This is optional. The user or the agent can give an instance a name such as `Work` or `Personal`. The name is stored in the profile and sent to the bridge each time the extension connects, so every agent session sees it.

Chrome and Safari have separate tools (`chrome_*` and `safari_*`), so the browser is never ambiguous. Chromium browsers such as Chrome, Edge and Brave all use `chrome_*`, as do all of their profiles. These are told apart by the `instance` argument, which accepts either the id or the name. Name matching ignores case.

## Naming instances

The agent can do this for the user, so nobody needs to open the extension page.

1. The user mentions a profile by a name that no instance has, for example "close the Jira tabs in my work Chrome". The tool's error message, or the server's instructions, sends the agent to `browser_identify_instances`.
2. `browser_identify_instances` lists each connected instance with a few of its tabs (title and site), preferring active and recently used web pages.
3. The agent shows the user these tabs and asks which instance is which.
4. Once the user confirms, the agent calls `browser_name_instance`. The extension saves the name and reconnects with it within a second or two.

The `name_browser_profiles` MCP prompt runs the same flow on request. In Claude Code it shows up as `/mcp__agent-browser-bridge__name_browser_profiles`.

Users can also type a name on the setup page, opened from the toolbar icon or the extension's options.

## Staying on the same instance

Tab, window and group ids only mean something inside the instance they came from. To stop an id from one profile being used in another:

- Each agent session remembers the instance it last used for each browser. Calls without `instance` go to that instance.
- If that instance disconnects, for example because the profile was closed or the extension is reloading, those calls fail with an explanation. They are not sent to whichever instance is still connected. The agent can wait for the instance to reconnect, or pass `instance` to switch.
- When several instances are connected and the session has not used one yet, calls without `instance` fail and list the instances.
- Every result ends with a line naming the instance that answered, for example `Browser instance: "Work" (Chrome, a1b2c3d4)`.

The memory belongs to one agent session. It is reset when the server process restarts or updates itself; see [updates.md](updates.md).

## Two profiles with the same id

If a profile folder is copied, both copies start with the same id. When the second copy connects, the bridge replaces the first copy's connection. The first copy recognises that it was replaced, rather than merely disconnected, so it generates a new id, saves it, and reconnects. The copied name stays the same, so an agent that asks for that name is told it is ambiguous until one copy is renamed.
