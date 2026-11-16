# ADR 005: Human-in-the-loop policy for high-risk actions

Status: accepted (Phase 12)

## Context

Refunds move money. A model can be talked into calling a tool (direct or indirect injection), and it can claim an
action happened when it didn't. External MCP clients can call tools without going through our agent loop at all.

## Decision

- **The gate is in the tool layer, not the agent.** `executeTool` never runs a `risk: "high"` tool. It calls the tool's
  side-effect-free `prepare` (access and state checks, a summary for the approver, a `subjectKey`), writes a
  `pending_actions` row, and returns `{status: "pending_approval", actionId, summary}`. MCP clients hit the same gate.
- A partial unique index allows one open action per tool and subject, so duplicates and races are settled by the database.
- `decideAction` (admin only) claims the row with a conditional update (`pending` -> `approved`/`rejected`), so two
  concurrent approvals execute the tool once. It then replays the stored arguments **as the requester**, re-runs
  `prepare` (state may have changed since the request), executes, and ends `executed` or `failed`.
- Every step is audited (`action.requested/approved/rejected/executed/failed`, `refund.issued`) in the same
  transaction as the change.
- The customer is notified with a templated message written into the conversation, not an LLM call, so the outcome
  text can't be hallucinated. The output guard also blocks "your refund was approved" claims unless a tool result in
  the same turn shows it.

## Consequences

- No prompt can issue a refund; only an admin decision can.
- Refunds are asynchronous for the customer (the widget polls the action status).
- New high-risk tools only need `risk: "high"` and a `prepare` function to get the full flow.
