# ADR 004: Tools exposed via MCP; identity from auth context, never from arguments

Status: accepted (Phase 9, Phase 10, Phase 11)

## Context

The agent can look up orders, open tickets, escalate, and request refunds. A model's tool arguments are
attacker-influenced (prompt injection, a customer typing "I'm CUS-002"). The same tools should also be usable from
external MCP clients (Cursor, Claude Desktop) without re-implementing authorization.

## Decision

- Tools are defined once in `packages/core/src/tools` (`defineTool`: Zod input and output, `risk: low | high`).
  Hosts call `executeTool(ctx, name, rawInput)`, which validates both sides and returns `{ok, data}` or
  `{ok: false, error: {code, message}}`.
- **Identity comes only from `ToolContext`** (`userId`, `role`, `customerId`). Extra model-supplied fields such as
  `customerId` are stripped by Zod. Another customer's order is indistinguishable from a missing one (`not_found`)
  and the attempt is written to `audit_log`.
- `packages/mcp-server` exposes the registry over MCP. Identity is fixed per connection: stdio uses `MCP_USER_EMAIL`
  (you launched the process, so you are trusted); Streamable HTTP requires `Authorization: Bearer` with a short-lived
  HMAC-SHA256 identity token (`MCP_TOKEN_SECRET`).
- The web app's agent uses an in-process MCP client bound to the verified session, so the chat and external clients go
  through the same server code.

## Consequences

- Authorization is tested in one place (cross-customer access tests in the tool layer), not per host.
- The role is carried in the token, not re-read per call: a demoted admin keeps access until the token expires
  (5 minutes by default).
- The HTTP endpoint binds to loopback (in Docker: published on the host's loopback only); exposing it further needs TLS.
