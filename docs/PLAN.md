# Implementation Plan: AI Support Agent for "Ledgerly" (fictional invoicing SaaS)

## Context

Portfolio project demonstrating production-grade AI engineering: a customer chat widget that answers
from product docs with citations, takes actions (order lookup, tickets, escalation, refunds with human
approval) via an MCP server, and an admin dashboard for conversations, cost, and quality.

Constraints: TypeScript end-to-end, strictly $0 (local/free models and tools), built in three layers
so every layer ends in a working, demoable state.

- **v1 — RAG core** (Phases 0–7): docs → retrieval → cited, streamed answers → evals
- **v2 — Actions** (Phases 8–12): auth, tools, MCP, agent loop, human-in-the-loop
- **v3 — Production hardening** (Phases 13–18): memory, guardrails, routing/rerank/cost, tracing, dashboard, ship

Hardware: Apple M4 Max, 48 GB RAM — enough for a 14B local model plus Docker services.

## Progress (update after every phase)

**Next up:** Phase 6 — streaming chat API (`/api/chat`, SSE) + chat widget with citation chips.

| Phase | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Done        | Ollama 0.40 via `brew services`; `qwen3:4b` (small) tool call verified (~5.6s, pass `think:false`). `qwen3:14b` (large, 9.3 GB) tool call verified (~3.3s warm). Gemini key not yet created (optional).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1     | Done        | npm workspaces (`@app/web`, `@app/core`), Next.js 16.4 + Tailwind 4, ESLint 9, Prettier, Vitest, CI workflow. Postgres+pgvector 0.8.7 on **host port 5455** (5432/5433/5442/5443 are used by work repos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2     | Done        | 32 docs in `knowledge-base/` (9 categories). Traps: `refund-policy-2024` (outdated, conflicts with `refund-policy`), credit notes vs subscription refunds (near-duplicates), hidden injection comment in `troubleshooting/sync-errors.md`. Loader/validator in `packages/core/src/kb/load.ts`; `npm run kb:lint` in CI. Seed data moved to Phase 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3     | Done        | `@app/db` package (Drizzle 0.45 + `pg`): 5 tables, migrations `0000_enable_pgvector` (custom) + `0001_init_schema`. Seed fixtures used by evals: `ORD-1042` (CUS-001, Priority support, paid), `ORD-1043` (CUS-002, Growth annual), `ORD-1044` (CUS-003, failed), `ORD-1045` (CUS-001, refunded). Ingest: 32 docs → 56 chunks (60–296 tokens, avg 140), first run 38.8s incl. model download, re-run embeds 0. Smoke test: correct doc ranked #1 for 3 sample questions. CI has a new `integration` job with a pgvector service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4     | Done        | `retrieve()` in `packages/core/src/rag/search.ts`: vector (pgvector cosine) + keyword, fused with weighted RRF (k=60). Keyword scoring is IDF-weighted (BM25-style, binary tf, heading boost 1.5) because Postgres `ts_rank` has no IDF. Started the golden set early (`evals/golden.jsonl`, 35 retrieval cases) + `npm run eval:retrieval [--all]`. Default hybrid (idf, 1:1): hit@1 74.3%, hit@3 94.3%, hit@5 100%, MRR 0.852 (vector-only 88.6% hit@3, ts_rank keyword 77.1%). Chose 1:1 over 2:1 (97.1% hit@3) to avoid overfitting a 35-case set. CI gate: hit@3 ≥ 90%. Known issue: stale `refund-policy-2024` still ranks #4 for "how do I get a refund".                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5     | Done        | AI SDK v7 (`ai@7`) + `ollama-ai-provider-v2@4`, `@ai-sdk/google@4`, `@ai-sdk/anthropic@4`. `createLlm(config)` in `packages/core/src/llm/provider.ts` (exhaustive switch; Ollama gets `think:false`). Per-provider default models in `DEFAULT_MODELS` (MODEL_SMALL/LARGE now optional overrides). `generateCitedAnswer` / `answerQuestion` in `packages/core/src/rag/answer.ts`: sources labelled S1..Sk with `updated` dates, `Output.object` + Zod schema, one repair retry on `NoObjectGeneratedError`, citations resolved from array + inline markers, hallucinated ids removed, no valid citation ⇒ `grounded=false`, confidence `low`. `npm run ask -- "q" [--tier small\|large] [--json]`. Probes: `qwen3:14b` handled stale-policy conflict, injected doc, off-topic, refund→needsHuman correctly (1.5–8.8s). `qwen3:4b` initially returned empty answers; `answer.min(1)` fixed it via Ollama's schema-constrained decoding, but quality is weaker (bare "No", cites everything, missed needsHuman) ⇒ default tier is **large** until the Phase 15 router. |
| 6–18  | Not started |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Resume checklist

1. `brew services start ollama` (if not running) and start Docker Desktop.
2. `npm install && npm run setup` (starts DB, migrates, seeds, ingests).
3. `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run eval:retrieval` should be green before starting the next phase.
4. Git: commits use the repo-local identity `rubghand@gmail.com`; push to the personal GitHub remote
   (not the work `gh` account).

### Implementation notes / gotchas

- Next.js 16 ships `apps/web/AGENTS.md`: read `node_modules/next/dist/docs/` before writing Next code (APIs differ from older versions).
- Workspace packages export TypeScript source directly; `apps/web/next.config.ts` lists them in `transpilePackages`.
- `npm run typecheck` runs `next typegen` first for the web app (route types like `LayoutProps`).
- Root scripts (`scripts/*.ts`) run with `tsx` and are typechecked by the root `tsconfig.json`.
- New dependency added beyond the approved list: `tsx` (dev) to run TypeScript scripts.
- AI SDK v7 API: `generateText({ output: Output.object({ schema }) })`; docs are in `node_modules/ai/docs/`.
  Model ids for Gemini/Anthropic defaults may age; override via `MODEL_SMALL` / `MODEL_LARGE`.
- Integration tests (`*.integration.test.ts`) use database `agent_test` (created by `docker/initdb` on a fresh volume;
  on an existing volume run `CREATE DATABASE agent_test` once). They are excluded from `npm test`.
- Schema changes: edit `packages/db/src/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.
- `@app/core`'s index exports server-only code (DB, embeddings). When the web app needs core code in client
  components (Phase 6), add subpath exports (e.g. `@app/core/client`) instead of importing the root.
- The hidden injection comment in `sync-errors.md` is intentionally kept in chunk content (not stripped) so
  guardrails can be tested against it.
- `evals/golden.jsonl` currently holds only `answerable` retrieval cases (`ret-*`). Phase 7 extends the schema
  in `evals/cases.ts` (expected behaviour, unanswerable/off-topic/injection categories) rather than starting over.
- Golden questions were written by the same author as the docs; expect real-user queries to score lower.
- Stale-doc handling (done in Phase 5): sources carry `updated` dates and the prompt says to follow the newest.
  Verified: with `refund-policy-2024` in context, `qwen3:14b` answered from the 2026 policy.
- Small-model prompt tuning (no bare yes/no answers, cite only directly supporting sources, needsHuman for refunds)
  is deferred to Phase 7, where the answer evals can measure whether a prompt change actually helps.
- No LLM integration test in CI (by design); `answer.ts` is covered with `MockLanguageModelV4` from `ai/test`.

## Target architecture

```
apps/web (Next.js)                         packages/mcp-server (stdio + HTTP)
 ├─ Chat widget  ──SSE──┐                   ├─ lookup_order
 ├─ Admin dashboard     │                   ├─ create_ticket
 └─ /api/*              ▼                   ├─ escalate_to_human
packages/core ── agent loop ── MCP client ──┴─ request_refund (needs approval)
 ├─ llm/       provider interface (Ollama | Gemini free | Anthropic-ready), router
 ├─ rag/       chunk, embed, hybrid search, rerank, citations
 ├─ guard/     injection + off-topic classifier, PII redaction, output checks
 ├─ memory/    rolling summarization
 └─ telemetry/ tokens, projected cost, latency, traces
packages/db (Drizzle + Postgres/pgvector)   evals/ (golden set, scorers, report)
```

Repo layout (npm workspaces):

```
ai-project/
├─ apps/web/                 Next.js app (widget, admin, API routes)
├─ packages/core/            agent, rag, llm, guard, memory, telemetry
├─ packages/db/              schema, migrations, seed
├─ packages/mcp-server/      MCP tool server
├─ knowledge-base/           Ledgerly docs (markdown + frontmatter)
├─ evals/                    golden.jsonl, scorers, results/
├─ docs/                     PLAN.md, adr/, architecture.md
├─ docker-compose.yml
└─ .github/workflows/ci.yml
```

## Implementation Phases

### Phase 0: Local environment

**Changes:**

- Install Ollama (`brew install ollama`); pull a small model (`qwen3:4b`) and a large model
  (`qwen3:14b`), both with tool-calling support.
- Start Docker Desktop.
- Get a free Gemini API key (fallback provider for when local tool calling is unreliable).
- `git init` inside `ai-project/` (currently it sits inside the parent `Projects` git repo).

**Verify:** `ollama run qwen3:4b "hi"` responds; a curl to `localhost:11434/api/chat` with a `tools` array returns a `tool_calls` field; `docker info` succeeds.

---

### Phase 1: Repo scaffold + CI skeleton

**File(s):** `package.json` (workspaces), `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `apps/web/*`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`

**Changes:**

- npm workspaces, TypeScript strict, ESLint, Prettier, Vitest.
- Next.js app with a placeholder page.
- `docker-compose.yml` with `pgvector/pgvector:pg17` service.
- CI: install → lint → typecheck → unit tests.
- `.env.example` only (real `.env` gitignored).

**Verify:** `npm run lint && npm run typecheck && npm test && docker compose up -d db`; CI green on first push.

---

### Phase 2: Fictional product + knowledge base

**File(s):** `knowledge-base/**/*.md`, `packages/core/src/kb/load.ts`, `scripts/kb-lint.ts`

**Changes:**

- Write ~25 Ledgerly doc pages with frontmatter (`id`, `title`, `url`, `category`, `updated`): getting started,
  invoices, payments, plans & billing, refunds policy, integrations, API, security, troubleshooting, FAQ.
- Deliberately include: conflicting/outdated page (tests recency handling), one page with an embedded
  prompt-injection string (tests indirect injection), near-duplicate topics (tests reranking).

**Verify:** `npm run kb:lint` (frontmatter schema, unique ids, no broken internal links) passes.

---

### Phase 3: DB schema + seed data + ingestion pipeline

**File(s):** `packages/db/src/{schema,client,seed}.ts`, `packages/db/migrations/*`, `packages/core/src/rag/{chunk,embed,ingest}.ts`, `scripts/{db-migrate,db-seed,ingest}.ts`, tests

**Changes:**

- Seed data (deterministic): 20 customers, 100 orders (plan purchases/add-ons, `ORD-1001`–`ORD-1100`), 5 tickets.
- Tables: `documents`, `chunks` (`embedding vector(384)`, generated `tsv tsvector`, `content_hash`), HNSW index on embedding, GIN on tsv.
- Heading-aware chunker (max 300 / min 60 tokens, 45-token overlap for long sections, keeps heading path as metadata).
- Local embeddings via transformers.js (`Xenova/bge-small-en-v1.5`, 384-dim, CLS pooling, normalized).
- Idempotent ingest: skip unchanged docs by document hash; reuse embeddings of unchanged chunks by chunk hash.

**Verify:** `npm test && npm run test:integration && npm run setup` → prints counts; re-running `npm run ingest` embeds 0 chunks.

---

### Phase 4: Hybrid retrieval

**File(s):** `packages/core/src/rag/search.ts` (+ unit and integration tests), `scripts/search.ts`, `evals/{golden.jsonl,cases.ts,retrieval.ts}`, `evals/scorers/retrieval.ts`

**Changes:**

- Vector search (cosine) + Postgres full-text search, fused with weighted Reciprocal Rank Fusion.
- IDF-weighted keyword scoring (alternative `ts_rank` kept for comparison).
- `retrieve(query, options)` returns chunks with `documentId`, `chunkId`, `title`, `url`, `score`, and per-retriever ranks.
- Retrieval eval (moved forward from Phase 7): hit@1/3/5 + MRR per configuration; CI gate on hit@3.

**Verify:** `npm test && npm run test:integration && npm run eval:retrieval -- --all --min-hit3 0.9`; `npm run search -- "how do I get a refund"` → refund policy doc in top 3.

---

### Phase 5: LLM provider layer + structured, cited answers

**File(s):** `packages/core/src/llm/provider.ts`, `packages/core/src/config.ts` (model defaults), `packages/core/src/rag/answer.ts`, `packages/core/src/prompts/system.ts`, `scripts/ask.ts`, tests

**Changes:**

- Provider interface over Vercel AI SDK; adapters: Ollama, Gemini (free tier), Anthropic (configured, unused at $0).
- System prompt: role, scope, "answer only from provided context", citation format, refusal rules, conflict rule
  (prefer newest `updated`), sources-are-untrusted rule. Static content first, dynamic last (cache-friendly ordering).
- Zod answer schema: `{ answer, citations: ["S1"...], confidence, needsHuman }`; validate + one retry on failure.
  Short source labels (S1..Sk) instead of raw chunk ids, mapped back after generation.
- Citation validator: every cited label must be in the retrieved set; unknown ones removed and reported; no valid
  citation ⇒ `grounded=false` and confidence downgraded to `low`.

**Verify:** `npm test && npm run ask -- "Can I change my plan mid-cycle?"` → valid JSON with real citations.

---

### Phase 6: Streaming chat API + widget

**File(s):** `apps/web/app/api/chat/route.ts`, `apps/web/components/chat/*`, `packages/db/schema.ts` (+`conversations`, `messages`)

**Changes:**

- `/api/chat` streams via SSE (AI SDK `streamText`), emitting token, citation, and done events.
- Persist conversations and messages.
- Embeddable widget: streaming text, citation chips linking to docs, "talk to a human" button (stub).

**Verify:** `curl -N -X POST localhost:3000/api/chat -d '{...}'` shows incremental events; browser screenshot of widget with citation chips.

---

### Phase 7: Eval harness v1

**File(s):** `evals/golden.jsonl`, `evals/run.ts`, `evals/scorers/*.ts`, `evals/results/`, `README.md` (results section)

**Changes:**

- 40 golden cases across categories: answerable (20), unanswerable (5), multi-doc (5), off-topic (5), injection (5).
  Each: `question`, `expectedDocIds`, `expectedBehavior` (`answer|refuse|escalate`), optional `mustContain`.
- Scorers: retrieval hit@5 and MRR (deterministic), citation precision (deterministic), behavior match
  (deterministic), groundedness (LLM-as-judge, calibrated on 10 hand-labelled cases).
- Output: JSON results + Markdown table (per-category scores, avg latency, avg tokens, projected cost) written to README.
- CI runs the deterministic retrieval subset only (no LLM in CI).

**Verify:** `npm run eval` produces `evals/results/<timestamp>.md`; `npm run eval:retrieval` passes in CI.

**→ v1 milestone: working cited RAG chat with measured quality.**

---

### Phase 8: Auth + rate limiting

**File(s):** `apps/web/auth.ts`, `apps/web/middleware.ts`, `packages/core/ratelimit.ts`, `packages/db/schema.ts` (+`users`, `rate_limits`), tests

**Changes:**

- Auth.js with credentials (seeded demo users); roles `customer` and `admin`; session carries `customerId`.
- Token-bucket rate limiter stored in Postgres (per user + per IP), 429 with `Retry-After`.

**Verify:** `npx vitest run packages/core/ratelimit.test.ts`; curl without session → 401; burst of requests → 429.

---

### Phase 9: Tool implementations (domain layer)

**File(s):** `packages/core/tools/*.ts`, `packages/db/schema.ts` (+`tickets`, `refunds`, `audit_log`), tests

**Changes:**

- `lookupOrder`, `createTicket`, `escalateToHuman`, `requestRefund` — pure functions with Zod input/output schemas.
- Authorization inside the tool: a customer can only access their own orders (never trust model-supplied IDs).
- Each tool declares `risk: "low" | "high"` (refund = high).

**Verify:** `npx vitest run packages/core/tools` incl. cross-customer access test → rejected.

---

### Phase 10: MCP server

**File(s):** `packages/mcp-server/src/index.ts`, `packages/mcp-server/src/tools.ts`, tests

**Changes:**

- Expose the Phase 9 tools via the official MCP TypeScript SDK (stdio for local clients, Streamable HTTP for the app).
- Caller identity passed via auth context, not via tool arguments.
- Document how to connect from Cursor / Claude Desktop.

**Verify:** `npx @modelcontextprotocol/inspector` lists 4 tools and `lookup_order` call succeeds; integration test calls server over HTTP.

---

### Phase 11: Agent loop + MCP client

**File(s):** `packages/core/agent/loop.ts`, `packages/core/agent/mcp-client.ts`, `apps/web/app/api/chat/route.ts`, tests

**Changes:**

- Loop: model → tool call(s) via MCP client → results back → repeat; max 5 steps; per-step timeout.
- RAG exposed to the agent as a `search_docs` tool, so the agent decides when to retrieve.
- Stream tool-call events to the UI ("Looking up order #1042…").
- Add 10 tool cases to golden set (expected tool + args).

**Verify:** `npx vitest run packages/core/agent && npm run eval -- --category tools`.

---

### Phase 12: Human-in-the-loop approvals

**File(s):** `packages/core/agent/approval.ts`, `packages/db/schema.ts` (+`pending_actions`), `apps/web/app/admin/approvals/*`, tests

**Changes:**

- High-risk tool calls pause the loop: persist `pending_action` (tool, args, conversation, reason), tell customer it's pending.
- Admin approves/rejects in dashboard → action executes (or not) → agent resumes and notifies customer.
- Every decision written to `audit_log`.

**Verify:** integration test: refund request → pending → approve → refund row exists + audit entry; browser screenshot of approval flow.

**→ v2 milestone: agent that answers and acts safely.**

---

### Phase 13: Context and memory management

**File(s):** `packages/core/memory/summarize.ts`, `packages/core/memory/context.ts`, tests

**Changes:**

- Token counting per message; when history exceeds threshold, summarize older turns with the small model,
  keep last N turns verbatim; store summary on conversation.

**Verify:** `npx vitest run packages/core/memory` (long synthetic chat stays under budget, key facts preserved).

---

### Phase 14: Guardrails

**File(s):** `packages/core/guard/input.ts`, `packages/core/guard/pii.ts`, `packages/core/guard/output.ts`, tests, `evals/golden.jsonl` (+cases)

**Changes:**

- Input: heuristic + small-model classifier for injection / off-topic → refuse politely.
- Retrieved content wrapped as untrusted data with delimiters; tool results likewise.
- PII: regex redaction (email, phone, card numbers with Luhn check) before logging and before LLM where not needed.
- Output: must cite or explicitly refuse; block leaking system prompt.
- Expand injection/jailbreak eval cases to 15 (direct + indirect via the poisoned doc).

**Verify:** `npx vitest run packages/core/guard && npm run eval -- --category injection,off-topic`.

---

### Phase 15: Model routing, reranking, cost tracking

**File(s):** `packages/core/llm/router.ts`, `packages/core/rag/rerank.ts`, `packages/core/telemetry/usage.ts`, `packages/db/schema.ts` (+`llm_calls`), `docs/adr/*`

**Changes:**

- Router: classify query complexity (heuristics + small model) → small or large model; log decision.
- Cross-encoder reranker (`bge-reranker-base` via transformers.js): top-20 → top-5.
- Record per call: model, input/output tokens, latency, **projected cost** using a price table
  (e.g. "what this would cost on Claude Haiku / Sonnet").
- ADR documenting cache-friendly prompt layout and how Anthropic prompt caching would plug in.
- Eval comparison table: baseline vs +rerank vs +router (quality / latency / projected cost).

**Verify:** `npx vitest run packages/core/llm packages/core/rag && npm run eval -- --compare` → comparison table generated.

---

### Phase 16: Observability

**File(s):** `packages/core/telemetry/trace.ts`, `docker-compose.yml` or env config

**Changes:**

- Trace per request with spans: guard → route → retrieve → rerank → LLM → tool calls.
- Langfuse (see assumption on cloud free tier vs self-host); fallback: local `traces` table when not configured.

**Verify:** send 3 chats → traces visible in Langfuse with nested spans (screenshot).

---

### Phase 17: Admin dashboard

**File(s):** `apps/web/app/admin/*`

**Changes:**

- Conversations list + detail (messages, citations, tool calls, trace link).
- Cost & latency over time, model routing split.
- Quality: latest eval run scores + per-message thumbs up/down from the widget.
- Pending approvals (from Phase 12).

**Verify:** browser walkthrough as admin with screenshots of each page.

---

### Phase 18: Docker, final CI, README

**File(s):** `apps/web/Dockerfile`, `packages/mcp-server/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`, `docs/architecture.md`, `docs/adr/*`

**Changes:**

- Multi-stage Dockerfiles; `docker compose up` runs db + web + mcp-server (Ollama on host).
- CI: lint, typecheck, unit, integration (pgvector service container), retrieval evals, Docker build.
- README: demo GIF, architecture diagram, setup in <5 commands, eval results table, trade-offs, ADR index.

**Verify:** fresh clone → `docker compose up` → chat works; CI green.

**→ v3 milestone: portfolio-ready.**

---

## Summary

### Planned ADRs (`docs/adr/`)

| ADR | Decision                                                               |
| --- | ---------------------------------------------------------------------- |
| 001 | TypeScript monorepo, no LangChain (explicit control over the loop)     |
| 002 | pgvector + hybrid search over a dedicated vector DB                    |
| 003 | Local embeddings (bge-small) and chunking strategy                     |
| 004 | Tools exposed via MCP; identity via auth context, not arguments        |
| 005 | Human-in-the-loop policy for high-risk actions                         |
| 006 | Model routing + cache-friendly prompt layout                           |
| 007 | Guardrail strategy and threat model (direct + indirect injection, PII) |
| 008 | Eval methodology (deterministic first, calibrated LLM judge)           |

### Decisions (confirmed)

- [x] Fictional product is "Ledgerly", an invoicing SaaS; "orders" = plan purchases / add-ons.
- [x] Single Next.js app hosts both the widget and the admin dashboard (no separate frontend).
- [x] Local Ollama is the primary LLM; Gemini free tier is the fallback; Anthropic adapter exists but is unused at $0.
- [x] CI runs only deterministic tests + retrieval evals (no LLM calls in CI) — keeps CI free, fast, and non-flaky.
- [x] Tracing uses Langfuse Cloud free (Hobby) tier; local `traces` table is the fallback when no keys are set.
      Self-hosted Langfuse v3 (ClickHouse, Redis, MinIO) is too heavy for this project.
- [x] No public deployment in v1–v3; optional Phase 19 later (free host + Gemini free tier).
- [x] `ai-project` gets its own git repo and GitHub remote.
- [x] Thumbs up/down feedback in the widget is in scope (Phase 17) — gives the quality dashboard real user signal alongside evals.

### Dependencies (approved)

| Package                                                               | Why Needed                                  | Alternatives Considered                            | Approved? |
| --------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | --------- |
| `next`, `react`                                                       | App, API routes, UI                         | Vite + Express (two servers)                       | Yes       |
| `ai` + `ollama-ai-provider-v2`, `@ai-sdk/google`, `@ai-sdk/anthropic` | Streaming, tool calling, provider switching | Raw provider SDKs (more glue, no shared streaming) | Yes       |
| `zod`                                                                 | Schemas for outputs, tools, KB frontmatter  | Hand-written validators                            | Yes       |
| `drizzle-orm`, `drizzle-kit`, `pg`                                    | Typed DB access + migrations                | Prisma (weaker pgvector support), raw SQL          | Yes       |
| `@huggingface/transformers`                                           | Local embeddings + reranker                 | Ollama embeddings (no reranker), paid APIs         | Yes       |
| `@modelcontextprotocol/sdk`                                           | MCP server + client                         | None (official SDK)                                | Yes       |
| `next-auth` (Auth.js)                                                 | Sessions + roles                            | Hand-rolled JWT                                    | Yes       |
| `@langfuse/otel` / `langfuse`                                         | Tracing                                     | Local `traces` table only                          | Yes       |
| `gray-matter`                                                         | Parse doc frontmatter                       | Manual YAML parse                                  | Yes       |
| `js-tiktoken`                                                         | Token counting for memory budget            | Character-based estimate                           | Yes       |
| `tailwindcss`, `recharts`                                             | UI styling, dashboard charts                | Plain CSS, Chart.js                                | Yes       |
| `vitest`, `eslint`, `prettier`                                        | Tests + lint                                | Jest                                               | Yes       |

### Open Questions

- None blocking. Revisit public deployment (optional Phase 19) after v3.

---

To implement this plan, say: "implement the plan" (start with Phase 0).
