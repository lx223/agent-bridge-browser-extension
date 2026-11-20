# Claude plugin

The repository is a Claude plugin marketplace with one plugin, `agent-browser-bridge`. Installing it gives Claude the MCP server and a setup skill in one step. The same plugin format works in Claude Code, Cowork and claude.ai.

## Layout

| Path | Purpose |
| --- | --- |
| `.claude-plugin/marketplace.json` | The marketplace. It lists each plugin and the folder it lives in. It has to be at the repository root. |
| `plugins/claude/.claude-plugin/plugin.json` | The plugin manifest: name, version, description and the hosts the plugin reaches. |
| `plugins/claude/.claude-plugin/icon.png` | The 512 px listing icon. `npm run icons -w agent-browser-bridge-extension` renders it from the same drawing as the extension icons. |
| `plugins/claude/.mcp.json` | Starts the MCP server with `npx -y agent-browser-bridge-mcp@latest`, the same command every other agent uses. |
| `plugins/claude/skills/setup/SKILL.md` | The `/agent-browser-bridge:setup` skill. It checks `browser_status` and walks the user through installing the browser extension, which a plugin cannot do for them. |
| `plugins/plugins.test.ts` | Checks that the plugin starts the server the same way as the setup page, that the marketplace entry matches the manifest, and that the setup skill names the current status tool and Node.js version. |

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

The plugin has its own version in `plugin.json`, separate from the extension and the npm package. Claude only offers an update when that version changes, so raise it in every pull request that changes a file under `plugins/claude`. Server releases do not need a plugin release: the plugin starts `agent-browser-bridge-mcp@latest`, and the running server updates itself as `docs/updates.md` describes.

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

Merging to `main` publishes the plugin through this repository's own marketplace. Nothing else is needed for the install commands above.

Listing it in Anthropic's public plugin directory is a separate, manual submission through the developer portal at https://claude.ai/directory/manage. It needs a paid claude.ai plan, and Anthropic runs automated validation, a security scan and a human review of new listings. The steps are at https://claude.com/docs/plugins/submit. The listing icon is taken from `icon.png` the first time the plugin is submitted and cannot be changed by editing the file afterwards.

The `claude-plugins-official` marketplace that Claude Code adds by default does not take submissions through the portal.

`network.hosts` in `plugin.json` declares `registry.npmjs.org`, which `npx` and the server's update check contact. The server otherwise only listens on `127.0.0.1`. Update the list if the server starts reaching another host.
