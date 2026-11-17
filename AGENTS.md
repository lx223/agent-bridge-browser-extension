# Repository instructions

These instructions apply to the entire repository.

## No code comments

- Do not add code comments, including inline comments, block comments, documentation comments, or commented-out code.
- Use clear names and straightforward code to communicate intent.
- Put necessary explanations in Markdown documentation instead of source code comments.

## Repository layout

- `packages/extension`: Chrome and Safari extension, setup and options pages, browser tools and analytics.
- `packages/server`: npm package `agent-browser-bridge-mcp`, MCP tools and local WebSocket bridge.
- `packages/protocol`: shared source-only schemas bundled into extension and server.
- `e2e`: Chromium integration tests.
- `docs`: usage, testing and release documentation.

## Development

Use the Node version in `.nvmrc` and install dependencies with `npm ci`.

Run `npm run typecheck`, `npm test` and `npm run build` for implementation changes. Consult `docs/testing.md` for coverage and Chromium end-to-end checks; run relevant integration checks when changing browser interactions or bridge routing. Documentation-only changes need link and formatting checks.

Keep the README focused on unique selling points and installation. Put detailed usage and developer information in `docs/usage.md` and other focused guides. Keep copy-ready Chrome dashboard fields in `store/chrome/submission.md`.

## Releases and privacy

The extension and server have separate versions. Update the corresponding package version and lockfile together. The extension build injects its package version into the generated manifest.

Publish from `main` using the repository workflows. npm publishing uses GitHub Actions trusted publishing after its migration is merged; do not add long-lived publishing credentials to source or logs. Check `docs/npm-publishing.md` when available.

Update `PRIVACY.md` and store disclosures when changing data handling, analytics, browser permissions or page-control capabilities. Keep browser/page data out of analytics events.

## Working tree

Preserve existing user edits and unrelated work. Use an isolated checkout when the current checkout is stale or contains unrelated changes. Keep pull requests focused and report what was validated.
