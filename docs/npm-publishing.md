# npm publishing

The Publish npm package workflow publishes `agent-browser-bridge-mcp` from `main`, and the Promote npm package workflow moves its `latest` dist-tag. Both use GitHub Actions OIDC. It does not need `NPM_TOKEN` or `NODE_AUTH_TOKEN`. The workflows grant `id-token: write` and runs on a GitHub-hosted runner with Node 26, which includes a compatible npm CLI.

## Releasing ahead of the extension

Running agents follow the `latest` dist-tag, not the highest version. The launcher checks `latest` every hour and switches to it (see [updates.md](updates.md)), and every install command uses `npx -y agent-browser-bridge-mcp@latest`. A version under any other tag reaches nobody until it is promoted.

The extension takes days to reach users through Chrome Web Store and App Store review, while a version under `latest` reaches every running agent within an hour. So a server version that needs a new extension must not be tagged `latest` until that extension is live in the stores.

1. Run Publish npm package with `dist_tag` set to `next` (the default). The version is published, and can be tried with `npx -y agent-browser-bridge-mcp@next`, but no agent picks it up.
2. Release the extension and wait until the new version is live in the Chrome Web Store and the App Store, not only approved or pending.
3. Run Promote npm package with that version. It points `latest` at it, and running agents switch to it within an hour.

A server release that works with the extension already in the stores can be published with `dist_tag` set to `latest` directly.

Promote npm package can also move `latest` back to an earlier version. New agent sessions then start that version, but running ones keep the newer version they already switched to, because the launcher only moves forward.

## Trusted publisher settings

Configure the package's Trusted publishing section on npm with two configurations:

| Field | Publish | Promote |
| --- | --- | --- |
| Provider | GitHub Actions | GitHub Actions |
| Organization or user | lx223 | lx223 |
| Repository | agent-bridge-browser-extension | agent-bridge-browser-extension |
| Workflow filename | publish-npm.yml | promote-npm.yml |
| Environment name | Leave empty | Leave empty |
| Allowed action | npm publish | npm dist-tag |

The `npm dist-tag` action is off by default and has to be turned on for the Promote configuration.

Publish npm package uses direct publishing. A stage-only publisher requires changing the command to `npm stage publish` and approving the resulting version on npm.

After verifying a successful OIDC release, remove the repository's `NPM_TOKEN` Actions secret, revoke the corresponding npm token, and select Require two-factor authentication and disallow tokens in the package's publishing access settings. Verify the token is not needed by other packages before revoking it.

New trusted publisher configurations must complete a first successful publish within two days or they expire. A version already published to npm cannot be republished; increment `packages/server/package.json` and its lockfile entry before the next release.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup requirements and troubleshooting.
