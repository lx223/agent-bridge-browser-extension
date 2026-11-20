# Claude plugin

The repository is a Claude plugin marketplace with one plugin, `agent-browser-bridge`. Installing it gives Claude the MCP server and a setup skill in one step. The same plugin format works in Claude Code, Cowork and claude.ai.

## Layout

| Path | Purpose |
| --- | --- |
| `.claude-plugin/marketplace.json` | The marketplace. It lists each plugin and the folder it lives in. It has to be at the repository root. |
| `plugins/claude/.claude-plugin/plugin.json` | The plugin manifest: name, version, description and the hosts the plugin reaches. |
| `plugins/claude/.claude-plugin/icon.png` | The 512 px listing icon. `npm run icons -w agent-browser-bridge-extension` renders it from the same drawing as the extension icons. |
| `plugins/claude/.mcp.json` | Starts the MCP server with `npx -y agent-browser-bridge-mcp@<version>`. The version is exact because Anthropic's plugin directory rejects `@latest`. |
| `plugins/claude/README.md` | The listing text. The plugin directory requires a README in the plugin folder and scans it for a description of everything the plugin runs, sends and fetches. |
| `plugins/claude/skills/setup/SKILL.md` | The `/agent-browser-bridge:setup` skill. It checks `browser_status` and walks the user through installing the browser extension, which a plugin cannot do for them. |
| `plugins/plugins.test.ts` | Checks that the plugin starts the server package at an exact version, that the README is long enough for the plugin directory, that the marketplace entry matches the manifest, and that the setup skill names the current status tool and Node.js version. |

`plugins/` holds one folder per agent ecosystem. A plugin for another agent goes in its own folder next to `plugins/claude`.

The plugin adds no tools or instructions of its own. Browser tools and the guidance on using them come from the MCP server, so every agent gets the same behaviour and the plugin does not need a release when the server changes.

## Installing

In Claude Code 2.1.275 or later:

```
/plugin install agent-browser-bridge --marketplace lx223/agent-bridge-browser-extension
```

On older versions, add the marketplace first:

```
/plugin marketplace add lx223/agent-bridge-browser-extension
/plugin install agent-browser-bridge@agent-browser-bridge
```

In claude.ai and Cowork, open **Customize > Plugins > Add**, choose **Add marketplace** and enter `lx223/agent-bridge-browser-extension`.

The plugin's MCP server is registered as `plugin:agent-browser-bridge:agent-browser-bridge`. Someone who earlier ran `claude mcp add agent-browser-bridge` has two copies of the server. Both work and share one bridge; `claude mcp remove agent-browser-bridge` removes the manual one.

## Versions

The plugin has its own version in `plugin.json`, separate from the extension and the npm package. Claude only offers an update when that version changes, so raise it in every pull request that changes a file under `plugins/claude`. `.mcp.json` names an exact server version, which must already be published on npm. Server releases do not need a plugin release: the version in `.mcp.json` is only where the server starts, and the running server moves itself to the newest release as `docs/updates.md` describes. Raise the version in `.mcp.json` now and then, after the npm release is out, so new sessions start closer to the current server.

Third-party marketplaces do not update automatically unless the user turns that on. Users update with `claude plugin update agent-browser-bridge@agent-browser-bridge`.

## Checking a change

```bash
claude plugin validate plugins/claude
```

```bash
claude plugin validate . --strict
```

The first command also runs a subset of the plugin directory's checks, such as the icon size and the declared hosts. To try the plugin without installing it:

```bash
claude --plugin-dir plugins/claude
```

## Publishing

There are two separate routes. They do not depend on each other.

### This repository's marketplace

Merging to `main` publishes the plugin through `.claude-plugin/marketplace.json`. This is what makes the Claude Code install commands above work, with no review and no account needed. Anthropic's directory does not read this file.

### Anthropic's plugin directory

The directory is the catalog in claude.ai under **Customize > Plugins > Discover**. A plugin added there also loads in Claude Code for the same account, as `agent-browser-bridge@synced`.

Submit through the developer portal at https://claude.ai/directory/manage. It needs a paid claude.ai plan and a GitHub account connected to claude.ai with push access to this repository. On the Source step enter:

| Field | Value |
| --- | --- |
| Repository | `lx223/agent-bridge-browser-extension` |
| Plugin path | `plugins/claude` |
| Branch or tag | Leave empty to follow `main` |

The repository and plugin path cannot be changed after submitting. The portal also asks data-handling questions, a contact email and compliance acknowledgements. The full steps are at https://claude.com/docs/plugins/submit and the checks are listed at https://claude.com/docs/plugins/pre-submission-checklist.

The directory reads and scans only `plugins/claude`. After listing, it picks up each commit on `main` that changes that folder, validates and scans it, and by default holds it until an Anthropic reviewer publishes it. The listing keeps serving the last published version meanwhile.

Points the directory checks that shape this plugin:

- A launcher such as `npx` must name an exact package version. `@latest` is rejected, and a plugin that uses a launcher is held for a reviewer even when pinned.
- The plugin folder needs its own README of at least 40 words outside code blocks, and it should describe everything the plugin runs, sends and fetches. Keep the "What it runs, sends and fetches" section of `plugins/claude/README.md` true, including the server's self-update.
- `network.hosts` in `plugin.json` declares `registry.npmjs.org`, which `npx` and the server's update check contact. The server otherwise only listens on `127.0.0.1`. Update the list if the server starts reaching another host.
- The listing icon is taken from `icon.png` the first time the plugin is submitted and cannot be changed by editing the file afterwards.

### Anthropic's own marketplaces

`claude-plugins-official`, the marketplace Claude Code adds by default, does not take submissions through the portal; a listing there goes through an Anthropic partner contact. `claude-community` (`anthropics/claude-plugins-community`) holds third-party plugins that authors submitted to Anthropic. The documentation does not say whether a portal submission is added to it.
