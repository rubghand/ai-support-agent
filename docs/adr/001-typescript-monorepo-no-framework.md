# ADR 001: TypeScript monorepo, no agent framework

Status: accepted (Phase 1)

## Context

The project has a web app (widget, admin, API routes), a domain/AI core, a database layer, and an MCP server.
They share types (tool schemas, SSE events, the answer schema) and must stay in step. The agent loop is the part
most worth controlling and inspecting: step limits, timeouts, the approval pause, and tracing all hook into it.

## Decision

- One npm-workspaces repo, TypeScript strict end to end: `apps/web` (Next.js), `packages/core`, `packages/db`,
  `packages/mcp-server`. Workspace packages export TypeScript source; Next.js transpiles them
  (`transpilePackages`) and scripts run them with `tsx`, so there is no per-package build step.
- Vercel AI SDK for provider calls and streaming only (`generateText`, `streamText`, `Output.object`). The agent loop,
  retrieval, guardrails, memory, and approvals are hand-written in `packages/core`.
- No LangChain / LlamaIndex. They would hide the loop behind abstractions that the approval gate, tracing,
  and guardrails each need to reach into.

## Consequences

- The whole request path is readable in a few files (`agent/loop.ts`, `rag/search.ts`, `guard/*`).
- More code to own: retries, structured-output repair, and tool plumbing are ours.
- Exporting source means a runtime that can't run TypeScript (the MCP container) uses `tsx`; see ADR 009.
