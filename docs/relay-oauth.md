# Relay sign-in with OAuth (design)

Status: proposal. Nothing here is built yet.

The relay in [remote.md](remote.md) accepts agents that send its agent token as a bearer token. Some MCP clients, such as Claude.ai custom connectors, only connect to remote servers through OAuth. This design makes the relay its own OAuth 2.1 authorization server, following the MCP authorization specification (revision 2026-07-28), with no third-party identity service. The agent token keeps working alongside it.

## Goals

- MCP clients that only speak OAuth can connect to a relay.
- Each signed-in agent gets its own grant, which the owner can see and revoke without touching other agents.
- The relay owns everything: the issuer, the endpoints, the sign-in and consent screens, the tokens and the stored data. No request goes to an outside identity provider, so nothing has to change if one is added or dropped later.
- Self-hosting stays one process with environment-variable secrets.

## Not in scope

- Several people on one relay, with accounts. See [Later: accounts](#later-accounts).
- Signing in with Google, GitHub or other outside providers.
- Fine-grained scopes. There is one scope, `browser`, which grants everything the agent token grants today.

## Who is the owner

A relay has one owner: the person whose browser connects to it with the browser token. The relay has no passwords. The owner proves who they are by approving the sign-in in their connected browser, in a screen that belongs to the extension. A browser that passed the browser-token handshake is the strongest proof of ownership the relay has, and it reuses a channel that already exists.

If no browser is connected, sign-in cannot finish, and the sign-in page says so.

## Flow

```
MCP client          relay                                  owner's browser (extension)
    │  POST /mcp (no token)                                     │
    │──────────────▶ 401, WWW-Authenticate: resource_metadata   │
    │  GET metadata, register (CIMD or DCR)                     │
    │  open /oauth/authorize?…&code_challenge=…&resource=…      │
    │──────────────▶ sign-in page: "Approve in your browser.    │
    │               Check that it shows K7QF-2M"                │
    │                     │ approval request ──────────────────▶│ consent screen in the extension:
    │                     │                                     │ client name, redirect host, K7QF-2M
    │                     │◀──────────────────────────── Allow  │
    │◀── redirect to redirect_uri?code=…&state=…&iss=…          │
    │  POST /oauth/token (code + code_verifier + resource)      │
    │◀── access token (1 h) + refresh token (rotating)          │
    │  POST /mcp, Authorization: Bearer <access token>          │
```

1. The client calls `/mcp` without a token and gets `401` with `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp", scope="browser"`.
2. It reads the protected resource metadata and then the authorization server metadata.
3. It identifies itself with a Client ID Metadata Document (preferred) or registers with Dynamic Client Registration.
4. It sends the person to `/oauth/authorize` with PKCE (`S256`), `state` and `resource=https://<host>/mcp`.
5. The relay checks the request and shows a sign-in page with a short pairing code. At the same time it asks the connected browser to approve, sending the client's name, the redirect URI's host and the same pairing code.
6. The extension shows the request in its own consent screen. The owner checks that the code matches the page they just opened and clicks Allow or Deny.
7. On Allow, the sign-in page redirects to the client with a one-time code, `state` and `iss`. On Deny or timeout it redirects with `error=access_denied`.
8. The client exchanges the code at `/oauth/token` and calls `/mcp` with the access token from then on.

### Why the consent screen is in the extension

The extension already has a popover for questions (`browser_ask_user`), but that popover sits inside a web page, and the page can read it and could try to click it. Consent must be out of reach of any page, so it opens in the side panel or in an extension tab (`chrome-extension://…`), where only the user can act.

### Why the pairing code

Anyone can start a sign-in against a relay, which would make the owner's browser ask for approval. The pairing code ties the approval to the page the owner has in front of them: a request they did not start shows a code they have never seen, and the consent screen says to deny it. The consent screen also shows the redirect URI's host, as the specification requires.

## Endpoints

| Path | Purpose |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-protected-resource` | Protected resource metadata (RFC 9728). |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414). |
| `GET /oauth/authorize` | Checks the request and shows the sign-in page. |
| `GET /oauth/authorize/status` | Polled by the sign-in page until the owner answers. |
| `POST /oauth/token` | Authorization code and refresh token grants. |
| `POST /oauth/register` | Dynamic Client Registration (RFC 7591), kept for clients that do not support CIMD yet. |
| `POST /oauth/revoke` | Token revocation (RFC 7009). |

Protected resource metadata:

```json
{
  "resource": "https://relay.example.com/mcp",
  "authorization_servers": ["https://relay.example.com"],
  "scopes_supported": ["browser"],
  "bearer_methods_supported": ["header"]
}
```

Authorization server metadata:

```json
{
  "issuer": "https://relay.example.com",
  "authorization_endpoint": "https://relay.example.com/oauth/authorize",
  "token_endpoint": "https://relay.example.com/oauth/token",
  "registration_endpoint": "https://relay.example.com/oauth/register",
  "revocation_endpoint": "https://relay.example.com/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["browser"],
  "client_id_metadata_document_supported": true,
  "authorization_response_iss_parameter_supported": true
}
```

The issuer and every URL come from `--public-host`. OAuth is off unless `--public-host` is set, because the issuer and the token audience must not depend on a request's `Host` header.

## Clients

- **Client ID Metadata Documents.** A `client_id` that is an `https://` URL with a path is fetched, and must contain `client_id` equal to that URL, `client_name` and `redirect_uris`. The fetch only goes to public addresses on port 443, never to private, loopback or link-local addresses, follows no redirects, stops after 5 seconds and 16 KB, and is cached for as long as the response allows, at most a day.
- **Dynamic Client Registration.** Deprecated by the specification but still used by some clients, so it stays available. Registrations are public clients (`token_endpoint_auth_method: none`). There is a cap on how many can exist, and the oldest one that never signed in is dropped first.
- **Redirect URIs** must be `https://` or loopback (`http://127.0.0.1`, `http://[::1]` or `http://localhost`, any port), and the request must match a registered one exactly. Loopback-only clients get an extra warning on the consent screen.

## Tokens

| Token | Form | Lifetime |
| --- | --- | --- |
| Authorization code | 256-bit random, single use, bound to client, redirect URI, PKCE challenge and resource | 60 seconds |
| Access token | 256-bit random, opaque | 1 hour |
| Refresh token | 256-bit random, opaque, rotated on every use | 30 days from last use |

- The relay stores only SHA-256 hashes of tokens and compares in constant time.
- Every token belongs to a grant: one client approved once by the owner. Revoking the grant ends its access and refresh tokens at once.
- Using a refresh token that was already rotated away revokes the whole grant, since it means the token was copied.
- `/mcp` accepts a token only if it was issued for `https://<public-host>/mcp`. The agent token is still accepted and is separate from OAuth.
- Tokens are only read from the `Authorization` header, never from the query string.

Tokens are opaque rather than signed because the relay has to look up the grant anyway to make revocation immediate, and opaque tokens need no signing key.

## Storage

The relay keeps clients and grants in memory. With `--data-dir`, it also writes them to a JSON file there, so agents stay signed in across restarts and deploys. On Fly.io that directory is a volume. The file holds token hashes, never tokens, and is written with owner-only permissions.

Without `--data-dir`, a restart signs every OAuth agent out. Agents using the agent token are not affected.

## Managing signed-in agents

The relay sends the extension the list of grants: the client's name, its redirect host, when it was approved and when it was last used. The extension shows them under **Remote access** on the setup page, with a **Sign out** button for each, which asks the relay to revoke that grant.

## Limits

- 3 pending sign-ins at once and 10 per hour, so a stranger cannot flood the owner with approval requests.
- A pending sign-in expires after 5 minutes.
- 100 registered clients and 32 grants.
- `/oauth/*` uses the same slow-down for failed attempts as `/mcp`.

## Security checklist

- HTTPS only, except loopback for testing, as today.
- PKCE with `S256` is required, and `plain` is refused.
- `state` is passed back unchanged, and `iss` is added to every authorization response (RFC 9207).
- The `resource` parameter must equal `https://<public-host>/mcp` on both the authorization and token requests.
- Exact redirect URI matching, and no redirect before the client and redirect URI are validated: invalid requests get an error page, not a redirect.
- The sign-in and consent pages use `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`, so they cannot be framed for clickjacking.
- Approvals only come from a browser connected with the browser token, through an extension-owned screen.
- The relay never passes tokens it received on to anything else.
- Tokens, codes and verifiers are never logged.

## Later: accounts

A hosted relay for many people needs real accounts. The plan is to keep the same OAuth server and add:

- Users, signing in with passkeys (WebAuthn) and one-time email codes, with no passwords.
- An `identities` table, so outside sign-in providers can be added later without changing user ids or tokens.
- Postgres in place of the JSON file, with every row owned by one user.
- Per-user browser tokens, and a bridge that only routes a user's agents to that user's browsers.

None of that changes the endpoints or tokens above, so clients signed in to a single-owner relay keep working.

## Open questions

- Should the owner also be able to approve by entering the agent token on the sign-in page, for when no browser is connected? It helps headless setups but turns the agent token into a password typed into a web page.
- Is one hour the right access token lifetime for long chat sessions, given that clients refresh automatically?
