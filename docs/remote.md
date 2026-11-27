# Remote access

Normally your agent starts the MCP server on the same computer as your browser, and the extension connects to it at `127.0.0.1`. Remote access lets agents somewhere else use your browser, such as an agent on another computer or a cloud agent. You run a relay server, your browser connects to it, and agents connect to it with a token.

```
Agent anywhere ──HTTPS, MCP, agent token──▶ relay ◀──WebSocket, browser token proof── your browser
```

The browser opens the connection to the relay, so it works behind home routers and firewalls without opening ports.

The relay serves one person: you configure it with two secrets, and everyone who has them shares the same browsers.

| Secret | Who uses it | How |
| --- | --- | --- |
| Agent token | Your agents | Sent as `Authorization: Bearer <token>` on every request to `/mcp`. |
| Browser token | Your browser | Entered on the extension's setup page. The extension proves it knows it; the token itself never crosses the network. |

Keep them apart: an agent never needs the browser token, and the browser never needs the agent token. Anyone with the agent token can use your browser as you, so treat it like a password.

## Run a relay

Create the two tokens:

```bash
npx -y agent-browser-bridge-mcp@latest tokens > relay.env
```

`relay.env` now holds `AGENT_BROWSER_BRIDGE_AGENT_TOKEN` and `AGENT_BROWSER_BRIDGE_BROWSER_TOKEN`, each 32 random bytes. Keep the file private, for example with `chmod 600 relay.env`.

Start the relay with them in its environment:

```bash
set -a; . ./relay.env; set +a
npx -y agent-browser-bridge-mcp@latest http --port 8080 --public-host relay.example.com
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--port` | `$PORT`, else `8080` | Port to listen on. |
| `--host` | `$HOST`, else `127.0.0.1` | Address to listen on. Use `0.0.0.0` in a container. |
| `--public-host` | `$AGENT_BROWSER_BRIDGE_PUBLIC_HOST` | The host name browsers use to reach the relay, such as `relay.example.com`, with the port if it is not the default. See [How the browser and relay check each other](#how-the-browser-and-relay-check-each-other). Without it the relay uses the request's `Host` header and logs a warning. |
| `--extension-id` | `$AGENT_BROWSER_BRIDGE_EXTENSION_ID` | Only accept browsers running this extension id. |

| Environment variable | Meaning |
| --- | --- |
| `AGENT_BROWSER_BRIDGE_AGENT_TOKEN` | The agent token. |
| `AGENT_BROWSER_BRIDGE_BROWSER_TOKEN` | The browser token. |
| `AGENT_BROWSER_BRIDGE_AGENT_TOKEN_FILE`, `AGENT_BROWSER_BRIDGE_BROWSER_TOKEN_FILE` | Read the token from a file instead, such as a Docker secret. Set either the variable or the file, not both. |

The relay refuses to start if either token is missing, shorter than 32 characters, has spaces around it, or if the two are the same. Tokens are read from the environment or files only, never from command-line flags, which other users on the machine can see.

Without a command, or with `stdio`, the server runs as before for a local agent.

The relay serves:

| Path | Used by |
| --- | --- |
| `/extension` | Browsers, over WebSocket. |
| `/mcp` | Agents, over MCP Streamable HTTP. |
| `/healthz` | Health checks. Returns `{"ok":true}` and nothing else. |

It keeps everything in memory and stores nothing on disk. One process holds every browser connection, so run a single instance.

### Docker

`packages/server/Dockerfile` builds an image that runs the relay on port 8080 as an unprivileged user. Build it from the repository root:

```bash
docker build -f packages/server/Dockerfile -t agent-browser-bridge-relay .
```

```bash
docker run -d --restart unless-stopped --env-file relay.env -e AGENT_BROWSER_BRIDGE_PUBLIC_HOST=relay.example.com -p 127.0.0.1:8080:8080 agent-browser-bridge-relay
```

Publishing the port on `127.0.0.1` keeps it reachable only through the HTTPS proxy on the same machine.

### HTTPS

Browsers and agents must reach the relay over HTTPS. The extension refuses relay addresses that are not `https://`, except `localhost`, `127.0.0.1` and `[::1]` for testing. Put the relay behind something that terminates TLS and forwards WebSockets:

- Caddy on the same machine gets and renews a certificate by itself:

  ```
  relay.example.com {
      reverse_proxy 127.0.0.1:8080
  }
  ```

- Cloudflare in front of the machine, with the DNS record proxied. Set SSL/TLS to **Full (strict)**: the Flexible mode sends traffic from Cloudflare to the machine unencrypted.

Long agent calls, such as waiting for a chat reply, keep a request open for up to about ten minutes. Set the proxy's read timeout above that.

## Turn it on in the browser

1. Open the extension's setup page and find **Remote access**.
2. Switch on **Let agents reach this browser through a relay**.
3. Enter the relay address, such as `https://relay.example.com`, and the browser token. The status turns green once the browser is connected.

The extension keeps the browser token in this browser profile's local extension storage. It is not synced to other devices.

## Connect an agent

Put the agent token in the agent's environment as `AGENT_BROWSER_BRIDGE_AGENT_TOKEN`, then add the relay. The setup page shows both commands with your relay address filled in. For Claude Code:

```bash
claude mcp add --transport http agent-browser-bridge-remote https://relay.example.com/mcp --header "Authorization: Bearer $AGENT_BROWSER_BRIDGE_AGENT_TOKEN"
```

For agents configured with JSON, the setup page shows a config that reads the token from the environment, so the token does not end up in a file you might commit:

```json
{
  "mcpServers": {
    "agent-browser-bridge-remote": {
      "type": "http",
      "url": "https://relay.example.com/mcp",
      "headers": { "Authorization": "Bearer ${AGENT_BROWSER_BRIDGE_AGENT_TOKEN}" }
    }
  }
}
```

Check how your agent expands environment variables in its configuration; if it does not, paste the token in a configuration file that stays out of version control.

Agents that connect this way get the same tools as a local agent, including the chat panel and questions in the page. They appear under **Remote access** on the setup page while they are connected.

A build of the extension can suggest a relay address: set `VITE_RELAY_URL` when building.

## Security

### How the browser and relay check each other

When the browser connects to `/extension`:

1. The relay checks that the WebSocket comes from a browser extension (`chrome-extension://` or `safari-web-extension://`, or exactly the configured `--extension-id`). Web pages cannot open it.
2. The relay sends a random 256-bit challenge.
3. The browser answers with its own random nonce and an HMAC-SHA256, keyed with the browser token, over the role `browser`, the relay's host name, the relay's challenge and its own nonce.
4. The relay computes the same HMAC and compares in constant time. On a mismatch it closes the connection.
5. The relay answers with the HMAC for the role `relay` over the same values. The browser checks it before it introduces itself or answers any request. A relay that cannot produce it does not know the browser token, and the setup page says the relay could not prove it knows the token.

So:

- The browser token never crosses the network, and neither side can be replayed into a later connection, because both nonces change every time.
- A server that is not your relay learns nothing it can use and gets no access to your browser.
- Each proof covers the host name the browser connected to. If someone gets you to enter their address and quietly forwards your connection to your real relay, the proofs no longer match, as long as the relay knows its own name. Set `--public-host` for that: without it the relay uses the `Host` header, which a forwarding server can set.

### Agents

- Every request to `/mcp` must carry the agent token, including requests within an existing MCP session; a session id alone is not enough.
- Tokens are compared in constant time and never logged.
- The browser token is not accepted as an agent token.

### Failed attempts

Each failed agent request or browser handshake from an address makes the next failure from it wait longer: 250 ms, then doubling up to 10 seconds, for ten minutes after the last failure. Requests with the right token are never slowed. At most 100 failures wait at once; further ones are dropped immediately. The relay logs the first rejection from each address and then every tenth, hundredth and so on, with the address but never the token.

Behind a proxy every request comes from the proxy's address, so failures are counted together; the right token still goes straight through.

### Limits

16 browsers, 64 agent sessions (the least recently used one closes when another starts), agent sessions end after an hour without requests, 4 MB per agent request, 32 MB per browser message, 10 seconds to finish the handshake, 20 seconds to send request headers and 60 seconds to send a request body.

### Responses

Every HTTP response carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Errors never echo tokens, and `/healthz` does not reveal the version.

### What the relay can see

The relay passes the agent's requests to the browser and the browser's answers back, so it handles everything the agent reads: tab titles and URLs, history, bookmarks, page contents and screenshots. Run it yourself. It does not store any of it.

The setup page's privacy section says when remote access is on and which relay the browser connects to.

### Rotating tokens

Generate new tokens with `agent-browser-bridge-mcp tokens`, restart the relay with them, enter the new browser token on the setup page and update the agent token wherever your agents read it. Agents and browsers using the old tokens are turned away from then on.

## Not yet supported

- Several people on one relay. A relay has one agent token and one browser token.
- Separate tokens per agent, so one agent can be cut off without the others.
- OAuth, for agents that only accept OAuth for remote MCP servers rather than a bearer token in a header.
