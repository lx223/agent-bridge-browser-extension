# Remote access

Normally your agent starts the MCP server on the same computer as your browser, and the extension connects to it at `127.0.0.1`. Remote access lets agents somewhere else use your browser, such as an agent on another computer or a cloud agent. You run a relay server, the browser connects to it, and agents connect to it with an access token you create in the extension.

```
Agent anywhere ──HTTPS, MCP with an access token──▶ relay ◀──WebSocket── your browser
```

The browser makes the connection to the relay, so it works behind home routers and firewalls without opening ports.

## Run a relay

The relay is the same `agent-browser-bridge-mcp` package started in `http` mode:

```bash
npx -y agent-browser-bridge-mcp@latest http --port 8080 --host 0.0.0.0
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--port` | `$PORT`, else `8080` | Port to listen on. |
| `--host` | `$HOST`, else `127.0.0.1` | Address to listen on. Use `0.0.0.0` in a container. |

Without a command, or with `stdio`, the server runs as before for a local agent.

The relay serves:

| Path | Used by |
| --- | --- |
| `/extension` | Browsers, over WebSocket. |
| `/mcp` | Agents, over MCP Streamable HTTP. |
| `/healthz` | Health checks. Returns `{"ok":true,"version":"…"}`. |

It keeps everything in memory and needs no database or secrets of its own. One process holds every browser connection, so run a single instance.

### Docker

`packages/server/Dockerfile` builds an image that runs the relay on port 8080. Build it from the repository root:

```bash
docker build -f packages/server/Dockerfile -t agent-browser-bridge-relay .
```

```bash
docker run -d --restart unless-stopped -p 8080:8080 agent-browser-bridge-relay
```

### HTTPS

Browsers and agents should reach the relay over HTTPS, because tokens and page contents pass through it. Put it behind something that terminates TLS and forwards WebSockets, for example:

- Caddy on the same VM: `relay.example.com { reverse_proxy 127.0.0.1:8080 }`.
- Cloudflare in front of the VM, with the DNS record proxied. WebSockets are on by default.

Long agent calls, such as waiting for a chat reply, keep a request open for up to about ten minutes. Set the proxy's read timeout above that.

## Turn it on in the browser

1. Open the extension's setup page and find **Remote access**.
2. Switch on **Let agents reach this browser through a relay** and enter the relay address, such as `https://relay.example.com`. The status turns green once the browser is connected.
3. Under **Agent access tokens**, enter who the token is for and choose **Create token**. Copy it straight away: it is shown once.

The page shows a Claude Code command and a JSON snippet for other agents:

```bash
claude mcp add --transport http agent-browser-bridge-remote https://relay.example.com/mcp --header "Authorization: Bearer abb_…"
```

```json
{
  "mcpServers": {
    "agent-browser-bridge-remote": {
      "type": "http",
      "url": "https://relay.example.com/mcp",
      "headers": { "Authorization": "Bearer abb_…" }
    }
  }
}
```

Agents that connect this way get the same tools as a local agent, including the chat panel and questions in the page. They appear under **Remote access** on the setup page while they are connected.

A build of the extension can suggest a relay address: set `VITE_RELAY_URL` when building.

## How access works

- When you first switch remote access on, the extension creates a random key and keeps it in the browser's local storage. The relay derives a space from the key; every browser that presents the same key joins the same space.
- Each access token names its space and carries 256 random bits. The extension stores only a SHA-256 hash of each token and sends the hashes to the relay when it connects and whenever you create or revoke one.
- The relay accepts an agent only if a browser in the token's space lists that token's hash. Revoking a token ends the agent sessions using it at once.
- While no browser of a space is connected, the relay still lets agents with a well-formed token start a session, so an agent can start before you open the browser. Its tools then report that the browser is not connected, until a browser connects and the token is checked.
- Agents with tokens for one space never see browsers in another.

Limits: 16 browsers per space, 32 agent sessions per space, 5,000 sessions in total, agent sessions end after an hour without requests, 4 MB per agent request and 32 MB per browser message.

## What the relay can see

The relay passes the agent's requests to the browser and the browser's answers back, so it handles everything the agent reads: tab titles and URLs, history, bookmarks, page contents and screenshots. Use a relay you run yourself or trust. The relay does not store any of it; it only logs connections and disconnections with a short prefix of the space id.

The setup page's privacy section says when remote access is on and which relay the browser connects to.

## Not yet supported

- OAuth. Agents that only accept OAuth for remote MCP servers, rather than a bearer token in a header, cannot connect yet.
- Rate limiting by address. Run the relay behind a proxy that limits requests if it is reachable by anyone.
- Sharing tokens between profiles. Each browser profile has its own key and tokens, so an agent needs a token from each profile it should use.
