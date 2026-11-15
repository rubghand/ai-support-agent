# ADR 006: Model routing, reranking, cost tracking, and cache-friendly prompts

Status: accepted (Phase 15)

## Context

Every question went to the large model (`qwen3:14b`). The small model (`qwen3:4b`) is faster and, on a
paid provider, roughly 3x cheaper, but it is measurably worse: bare "No" answers, citing every source,
and missed escalations (Phase 5). Retrieval also left the right chunk at rank 4 for some questions
(hit@3 94%).

## Decisions

### Router (`llm/router.ts`)

Heuristics first, small-model classifier second, large model on any doubt.

- **Large, decided by rules:** an order id, account-action words (refund, cancel, charge, dispute, human,
  ticket...), several questions, long messages, and follow-ups ("that", "it") when there is history.
  These need tools, escalation, or earlier context, which the small model gets wrong.
- **Small, decided by rules:** a short single sentence that opens like a how-to and has no digits.
- **Everything else:** `qwen3:4b` labels it `simple` or `complex`. A classifier failure means large.
- The router runs after the input guard, so blocked messages never reach it. The decision (`tier`,
  `source`, `reason`) is stored in `messages.metadata.route`.
- `tier: "small" | "large"` in the request forces a tier (debugging, evals). Without it, `MODEL_ROUTING=auto`
  uses the router and the default `off` uses large. **Routing ships off by default** (see Results).

The rules are deliberately one-sided: a wrong "large" costs latency, a wrong "small" costs a bad answer.

### Reranker (`rag/rerank.ts`)

`Xenova/bge-reranker-base` (8-bit ONNX, in-process, free) scores the fused top 20 as
(query, chunk) pairs and keeps the best 5. Fusion only has to get the right chunk into the top 20.
On the 35 retrieval cases: hit@3 94.3% -> 100%, MRR 0.852 -> 0.943, at about 1 s per query on an M4 Max
(vs 9 ms). That latency is the price; it is paid per `search_docs` call.

### Usage and projected cost (`telemetry/usage.ts`, table `llm_calls`)

A language-model middleware wraps each model and records tokens and latency for every call, including
retries and streamed calls. Purposes are `guard`, `route`, `summary` and `agent`, so overhead calls
(which Phase 14 did not count) now show up. Cost is projected at Anthropic list prices
(small = Haiku 4.5, large = Sonnet 4.5); local runs cost $0. Rows are saved per request, in a `finally`,
so failed requests are still accounted for.

### Cache-friendly prompt layout

Provider prompt caches match on a stable prefix, so everything that does not change per request comes first:

1. Tool definitions and the system prompt (identical for every request; the agent prompt is a constant).
2. Conversation summary and recent history (change once per turn, grow append-only).
3. Retrieved sources and tool results (change per request).
4. The customer's question last.

Keeping the order stable and moving per-request content to the end is what makes a cache hit possible.
Anthropic prompt caching would plug in at the `Llm` boundary (`llm/provider.ts`): for the `anthropic`
provider, set `providerOptions.anthropic.cacheControl = { type: "ephemeral" }` on the system message and on
the last history message, so the static prefix is cached for the default 5 minutes. Cached reads are billed at
about 10% of the input price, and `PRICE_TABLE` would need a `cachedInput` rate and the metering
middleware would read `usage.inputTokens.cacheRead`. Not enabled: Ollama has no equivalent, and
the project runs at $0.

## Results (60 eval cases, `npm run eval:compare`, qwen3 on an M4 Max)

| Config            | Behavior | Tools | hit@5 | MRR  | Grounded (judge) | Avg latency | Routed small | Projected cost/query |
| ----------------- | -------- | ----- | ----- | ---- | ---------------- | ----------- | ------------ | -------------------- |
| baseline (large)  | 92%      | 98%   | 100%  | 0.90 | 97%              | 8.7s        | 0%           | $0.0130              |
| + rerank          | 93%      | 100%  | 100%  | 0.95 | 100%             | 9.5s        | 0%           | $0.0136              |
| + rerank + router | 93%      | 100%  | 97%   | 0.95 | 91%              | 13.6s       | 31%          | $0.0129              |

- **Rerank helps**: MRR 0.90 -> 0.95, grounded 97% -> 100%, +0.8 s. Kept on.
- **Router does not pay off locally**: 14 of 45 answered cases went to the small model. Those took 30 s on average
  against 12 s for large (the 4B model burns tool steps and writes longer answers, so tokens, and therefore projected cost,
  were not lower: $0.0148 vs $0.0181 per query, a small gap that is mostly the cheaper price per token). Grounded fell to 91%:
  `ret-09` and `ret-12` were routed small and invented details. All five unanswerable cases were routed small
  and still fail (large fails 4 of 5 too). Net: cost -1%, latency +43%, quality down, so the default stays `large`.
- The heuristics decided every small route in this run (`SIMPLE_OPENER` matches "how do I ..."), so short does not
  mean easy. Tightening the rules to fit these 60 cases would overfit a golden set the same author wrote; the
  right test is a larger, independent question set, or a stronger small model (the router
  would be worth re-measuring with `gemini-2.5-flash-lite`).
- Single run each; Ollama is not fully deterministic, and one case flipping moves behavior by about 1.7 points.
  Latency may also include Ollama swapping between the 4B and 14B models in memory (not isolated).

## Consequences

- Routing is implemented, measured, and off by default; `MODEL_ROUTING=auto` turns it on.
- One more small-model call (about 1 s) for ambiguous questions.
- The reranker adds a ~290 MB model download on first use and ~1 s per search.
- The heuristics are English-only and written by the same author as the golden set; real traffic will
  route differently. The routed share and the per-message route reason are stored to check that.
