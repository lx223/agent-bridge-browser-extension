# npm publishing

The Publish npm package workflow publishes `agent-browser-bridge-mcp` from `main` using GitHub Actions OIDC. It does not need `NPM_TOKEN` or `NODE_AUTH_TOKEN`. The workflow grants `id-token: write` and runs on a GitHub-hosted runner with Node 26, which includes a compatible npm CLI.

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
