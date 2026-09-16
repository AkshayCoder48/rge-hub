# RGE Hub MCP Server

A **self-hosted, zero-dependency** [Model Context Protocol](https://modelcontextprotocol.io) server for the RGE Hub editing platform. It packs the [RGE Hub Public API](https://rge-hub.vercel.app) into 12 MCP tools so any MCP client (Claude Desktop, Cursor, VS Code, …) can manage your Hub resources — images, clips, and files/XML presets — conversationally.

**Self-hosting only.** This server runs on YOUR machine. Your API key never leaves it, and there is no hosted/shared MCP endpoint, no account on any third-party service, and no paid dependency. All it needs is Node.js ≥ 18.

---

## Quick start

1. Get your API key from the Hub: **Settings → Security → "Reveal API key"** (`kv_live_…`).
2. Download the server (single file, no install):

   ```bash
   curl -O https://raw.githubusercontent.com/AkshayCoder48/rge-hub/main/mcp/server.mjs
   ```

   (or clone this repo and use `mcp/server.mjs` directly)

3. Verify it can reach your instance:

   ```bash
   RGE_API_KEY=kv_live_xxx node server.mjs --check
   # → health: ok (storage ok)
   # → api key: valid — yourname (N uploads)
   ```

## Configuration

| Environment   | Flag          | Default                        | Description                          |
| ------------- | ------------- | ------------------------------ | ------------------------------------ |
| `RGE_API_KEY` | `--api-key`   | —                              | Your account API key (required for authenticated tools) |
| `RGE_BASE_URL`| `--base-url`  | `https://rge-hub.vercel.app`   | The Hub instance to talk to          |

## Client setup

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "rge-hub": {
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx",
        "RGE_BASE_URL": "https://rge-hub.vercel.app"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` (or global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "rge-hub": {
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx"
      }
    }
  }
}
```

### VS Code (Copilot)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "rge-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "RGE_API_KEY": "kv_live_xxx"
      }
    }
  }
}
```

### Any Streamable HTTP client

```bash
RGE_API_KEY=kv_live_xxx node server.mjs --http 3333   # 127.0.0.1:3333/mcp
```

Then add an HTTP MCP server pointing at `http://127.0.0.1:3333/mcp`. Bind on other interfaces with `--host 0.0.0.0` (only on trusted networks — the key travels with every request).

### Claude Code (CLI)

```bash
claude mcp add rge-hub --env RGE_API_KEY=kv_live_xxx -- node /absolute/path/to/server.mjs
```

## Tools

| Tool | Auth | Description |
| ---- | ---- | ----------- |
| `rge_health` | — | Instance health (API + storage) |
| `rge_me` | key | Your profile + upload/follower counts |
| `rge_list_my_resources` | key | Your resources (drafts included), filter by type/published |
| `rge_get_resource` | — | One resource by id (drafts need the owner's key) |
| `rge_create_text_resource` | key | Create a resource from text content (XML preset, JSON, notes — ≤2 MB) |
| `rge_create_link_resource` | key | Create a resource pointing at an http(s) URL |
| `rge_update_resource` | key | Update your own resource (title, description, tags, category, published) |
| `rge_delete_resource` | key | Delete your own resource (idempotent) |
| `rge_search_resources` | — | Search public resources by title/description/creator/tags |
| `rge_community_feed` | — | Public community feed, newest first |
| `rge_get_user` | — | Public creator profile by username |
| `rge_get_file` | — | File metadata + permanent download URL |

All create/update calls accept a `clientId` idempotency key — retries with the same key return the same resource instead of duplicating.

## Security notes

- Your API key is equivalent to your account password for API access — never commit it. The client configs above keep it in local files only.
- The server sends the key only to your configured `RGE_BASE_URL`, over HTTPS.
- Losing a key (or wanting to rotate it): sign in to the Hub again — login mints a fresh key — then update your env var.
- Rate limits: the API allows 90 authenticated requests/minute/key (public endpoints 30-60/min/IP). The MCP server surfaces 429s as tool errors with retry hints.

## Transports & protocol

- **stdio** (default): newline-delimited JSON-RPC 2.0 on stdin/stdout, logs on stderr — the standard MCP stdio transport.
- **Streamable HTTP** (`--http [port]`): stateless `POST /mcp` (single or batch JSON-RPC). No server-initiated messages, so `GET /mcp` correctly answers 405.
- Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05` (the requested version is echoed when supported).
