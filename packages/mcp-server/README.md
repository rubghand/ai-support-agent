# Ledgerly MCP server

Exposes the support tools (`lookup_order`, `create_ticket`, `escalate_to_human`, `request_refund`) over the
[Model Context Protocol](https://modelcontextprotocol.io). Tool logic, validation, and authorization live in
`@app/core` (`packages/core/src/tools`); this package only transports them.

**The caller's identity never comes from tool arguments.** It is fixed per connection, so a model cannot ask
for another customer's data.

| Transport                    | Identity comes from                                                                                          | Use for                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| stdio                        | `MCP_USER_EMAIL` (a seeded user; you launched the process, so it is trusted)                                 | Cursor, Claude Desktop, Inspector |
| Streamable HTTP, `POST /mcp` | `Authorization: Bearer <token>`: an HMAC-signed, short-lived token the app mints after verifying the session | The app's agent loop              |

Prerequisite: `npm run setup` (Postgres up, migrated, seeded). Seeded users: see the root README.

## Connect from Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ledgerly": {
      "command": "npm",
      "args": ["run", "--silent", "mcp:stdio"],
      "cwd": "/absolute/path/to/ai-project",
      "env": { "MCP_USER_EMAIL": "maya@brightpixelstudio.example" }
    }
  }
}
```

## Connect from Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ledgerly": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/ai-project", "run", "--silent", "mcp:stdio"],
      "env": { "MCP_USER_EMAIL": "maya@brightpixelstudio.example" }
    }
  }
}
```

Use `admin@ledgerly.example` to act as an admin: admins can read any order, but mutating tools refuse them
because they have no customer to act for.

## Try it with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector --cli -e MCP_USER_EMAIL=maya@brightpixelstudio.example \
  npx tsx --env-file-if-exists=.env packages/mcp-server/src/stdio.ts \
  --method tools/call --tool-name lookup_order --tool-arg orderId=ORD-1042
```

(`-e` is needed because the Inspector does not pass your shell environment to the server.)

## HTTP

```bash
# .env: MCP_TOKEN_SECRET=<openssl rand -base64 32>   (>= 16 chars)
npm run mcp:http                                              # 127.0.0.1:3333/mcp
TOKEN=$(npm run --silent mcp:token -- maya@brightpixelstudio.example)
curl -s localhost:3333/mcp -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

It binds to loopback only and is stateless (no sessions). Requests without a valid, unexpired token get 401.

## Notes

- `request_refund` is marked `_meta.risk = "high"`. It only files a request for staff review.
- Domain failures (not found, invalid state, conflict) are returned as tool results with `isError: true`, so the
  model can read them and recover; malformed arguments are rejected by the SDK before the tool runs.
