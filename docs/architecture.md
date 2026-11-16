# Architecture

## Components

```mermaid
flowchart LR
  subgraph Browser
    W[Chat widget]
    A[Admin dashboard]
  end
  subgraph web["apps/web (Next.js)"]
    API["/api/chat (SSE)<br/>/api/actions, /api/feedback"]
    ADM["/admin pages"]
  end
  subgraph core["packages/core"]
    G[guard: input, PII, output]
    M[memory: rolling summary]
    AG[agent loop]
    R[rag: hybrid search + rerank]
    T[tools + approval gate]
    TEL[telemetry: usage, traces]
  end
  MCP["packages/mcp-server<br/>(stdio / HTTP)"]
  DB[(Postgres + pgvector)]
  O[Ollama on host<br/>qwen3:4b / qwen3:14b]
  EXT[Cursor / Claude Desktop]

  W --> API
  A --> ADM
  API --> G --> AG
  API --> M
  AG -->|search_docs| R
  AG -->|in-process MCP client| MCP
  EXT -->|stdio or bearer token| MCP
  MCP --> T
  AG --> O
  G --> O
  M --> O
  R --> DB
  T --> DB
  TEL --> DB
  ADM --> DB
```

| Package               | Responsibility                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`            | Widget, admin pages, API routes, Auth.js sessions, rate limiting at the edge of each route        |
| `packages/core`       | Agent loop, retrieval, prompts, guardrails, memory, tools and approvals, telemetry, admin queries |
| `packages/db`         | Drizzle schema, migrations, deterministic seed                                                    |
| `packages/mcp-server` | The tool registry over MCP (stdio for local clients, Streamable HTTP with identity tokens)        |
| `evals`               | Golden set, scorers, LLM judge calibration, result reports                                        |
| `knowledge-base`      | 32 Ledgerly help-center pages (markdown with frontmatter), including deliberate traps             |

## One chat turn

```mermaid
sequenceDiagram
  participant C as Customer
  participant API as /api/chat
  participant G as Input guard (4B)
  participant AG as Agent (14B)
  participant R as retrieve + rerank
  participant T as Tools (MCP)
  participant DB as Postgres

  C->>API: POST message (session cookie)
  API->>API: auth, rate limit, validate, redact PII
  API->>DB: save user message
  API->>DB: load history (summarize if over budget)
  API->>G: heuristics, then classifier
  alt blocked
    G-->>C: fixed refusal (no large-model call)
  else allowed
    loop up to 5 steps
      AG->>R: search_docs(query)
      AG->>T: lookup_order / create_ticket / request_refund ...
      T-->>AG: result (high risk => pending_approval)
    end
    AG-->>C: streamed tokens (SSE)
    AG->>AG: output guard (citations, leaks, claims)
    API->>DB: assistant message, llm_calls, trace + spans
    API-->>C: citations + done events
  end
```

Every model call goes through a metering middleware, so the guard, router, summarizer, and agent calls all land in
`llm_calls` with tokens, latency, and projected cost. Spans for history, guard, route, retrieve, rerank, each model call,
and each tool call are stored per request in `traces` / `spans` (and optionally exported to Langfuse).

## Data model

| Table                                     | Purpose                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `documents`, `chunks`                     | Knowledge base; `chunks.embedding vector(384)` (HNSW) and `tsv` (GIN)    |
| `customers`, `orders`, `tickets`          | Seeded product data the tools act on                                     |
| `users`, `rate_limits`                    | Demo accounts (scrypt hashes) and token buckets                          |
| `conversations`, `messages`               | Chat history, rolling summary, per-message metadata (route, guard flags) |
| `pending_actions`, `refunds`, `audit_log` | Human-in-the-loop approvals and their audit trail                        |
| `llm_calls`, `traces`, `spans`            | Cost and latency telemetry                                               |
| `message_feedback`                        | Thumbs up / down from the widget                                         |

## Runtime (Docker)

```mermaid
flowchart LR
  db[(db: pgvector)] --> setup[setup: migrate, seed once, ingest]
  setup --> web[web :3000]
  setup --> mcp[mcp 127.0.0.1:3333]
  web -. host.docker.internal:11434 .-> ollama[Ollama on host]
  web --- models[(models volume)]
  setup --- models
```

Details and trade-offs: [ADR 009](adr/009-docker-packaging.md). All decisions: [`docs/adr/`](adr/).
