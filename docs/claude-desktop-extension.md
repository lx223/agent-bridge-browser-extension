# Claude Desktop extension

Claude Desktop users can install the MCP server as a Claude Desktop extension (`.mcpb` file). Claude Desktop runs it with its built-in Node.js, so these users do not need to install Node.js themselves.

## How it is built

`npm run pack:mcpb -w agent-browser-bridge-mcp [output path]` runs `packages/server/scripts/pack-mcpb.mjs`, which:

1. bundles the server and all of its npm dependencies into `packages/server/mcpb-dist/server/index.js` with `packages/server/vite.mcpb.config.ts`, starting from `src/standalone.ts`,
2. writes `manifest.json` from `packages/server/mcpb/manifest.json`, using the version in `packages/server/package.json`,
3. copies the extension icon and the licence,
4. validates the manifest and packs the folder with the `mcpb` CLI.

The output defaults to `packages/server/agent-browser-bridge.mcpb`.

The bundle sets `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE` at build time. Without them the bundler swaps the optional native `ws` add-ons for empty stubs, and the server crashes on the first message from the browser extension. `npm run test:e2e:mcpb` runs the end-to-end suite against the bundle to catch this kind of problem, and presubmit runs it on every pull request.

The bundle runs the server directly, without the self-updating launcher described in `docs/updates.md`. The launcher upgrades through `npx`, which Claude Desktop users of the bundle may not have, so they get a new server version by installing a newer `.mcpb`.

## How it is released

The Publish Release workflow attaches `agent-browser-bridge.mcpb` to each GitHub release next to the extension ZIP. The file name has no version, so the setup page and README can link to `releases/latest/download/agent-browser-bridge.mcpb`.

The bundle is built from the server code at the release commit, so publish the matching npm version from the same commit to keep both install routes on the same server version.
