# npm publishing

The Publish npm package workflow publishes `agent-browser-bridge-mcp` from `main` using GitHub Actions OIDC. It does not need `NPM_TOKEN` or `NODE_AUTH_TOKEN`. The workflow grants `id-token: write` and runs on a GitHub-hosted runner with Node 26, which includes a compatible npm CLI.

## Release order

Release the extension to the stores first and publish the npm package last, once the new extension version is live in every store it is published in: the Chrome Web Store and, once the Safari app is released, the Mac App Store. Approved or pending review is not enough.

A published server version reaches every running agent within an hour: the launcher checks npm's `latest` tag every hour and switches to it (see [updates.md](updates.md)), and every install command uses `npx -y agent-browser-bridge-mcp@latest`. The extension takes days to get through store review. A server published first would talk to the old extension for that whole time.

Publish npm package publishes whatever is on `main` when it runs, which by then may include server changes merged after the extension release. Check that everything it publishes works with the extension version that is live in the stores.

Some users stay on an older extension for a while, because Chrome rolls updates out gradually and disables an extension whose update adds permission warnings until the user accepts them. Keep each change compatible in both directions with the previous release, and remove the old behaviour one release later:

- The new server still works with the previous extension.
- The new extension still works with the previous server, which agents keep running until the launcher's next check.

Do not bump `PROTOCOL_VERSION` for this. The server closes the connection of any extension whose protocol version differs from its own, so a bump disconnects every user still on the previous extension.

## Trusted publisher settings

Configure the package's Trusted publishing section on npm with:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | lx223 |
| Repository | agent-bridge-browser-extension |
| Workflow filename | publish-npm.yml |
| Environment name | Leave empty |
| Allowed action | npm publish |

The workflow uses direct publishing. A stage-only publisher requires changing the command to `npm stage publish` and approving the resulting version on npm.

After verifying a successful OIDC release, remove the repository's `NPM_TOKEN` Actions secret, revoke the corresponding npm token, and select Require two-factor authentication and disallow tokens in the package's publishing access settings. Verify the token is not needed by other packages before revoking it.

New trusted publisher configurations must complete a first successful publish within two days or they expire. A version already published to npm cannot be republished; increment `packages/server/package.json` and its lockfile entry before the next release.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup requirements and troubleshooting.
