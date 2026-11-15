# AI Support Agent

An AI support agent for **Ledgerly**, a fictional invoicing SaaS. Customers chat with a widget that answers
from the product docs with citations and can take actions (order lookup, tickets, escalation, refunds with
human approval) through an MCP server. An admin dashboard shows conversations, cost, and quality scores.

Built entirely on free tools: local models via Ollama, Postgres + pgvector, Next.js.

> Work in progress. See [`docs/PLAN.md`](docs/PLAN.md) for the roadmap and current progress.

## Quick start

```bash
brew install ollama && brew services start ollama
ollama pull qwen3:4b && ollama pull qwen3:14b
cp .env.example .env   # then set AUTH_SECRET (openssl rand -base64 32)
npm install
npm run setup   # start Postgres, migrate, seed, ingest the knowledge base
npm run dev
```

Sign in at <http://localhost:3000/login> with a seeded demo user (password `demo1234`):
`maya@brightpixelstudio.example` (customer, `CUS-001`), `lucas@moreauconsulting.example`, `aisha@bellobakery.example`,
or `admin@ledgerly.example` (admin). The chat is limited to a burst of 10 messages per user, then 10 per minute.

## Try it

```bash
npm run ask -- "Can I get a refund on my monthly plan?"            # cited answer (qwen3:14b)
npm run ask -- "Can I get a refund on my monthly plan?" --tier small
npm run search -- "can I get my money back for a monthly plan?"    # retrieval only
npm run eval:retrieval -- --all   # compare retrieval configurations on the golden set
```

Human-in-the-loop refunds: sign in as Maya and ask _"I want a refund for order ORD-1042"_. The agent files the
request and the chat shows it as waiting for staff approval. In another browser profile, sign in as
`admin@ledgerly.example`, open **Approvals** (`/admin/approvals`) and approve or reject it, optionally with a note.
The customer's chat then shows the outcome. Only an approval refunds the order. Each step (request, decision,
execution) is written to `audit_log`.

## Results

Retrieval on the golden set (35 paraphrased customer questions, document-level). Full table:
[`evals/results/retrieval.md`](evals/results/retrieval.md).

| Config                           | hit@1 | hit@3 | hit@5  | MRR   |
| -------------------------------- | ----- | ----- | ------ | ----- |
| Keyword only (Postgres ts_rank)  | 48.6% | 77.1% | 88.6%  | 0.662 |
| Keyword only (IDF-weighted)      | 71.4% | 85.7% | 91.4%  | 0.795 |
| Vector only (bge-small)          | 74.3% | 88.6% | 100.0% | 0.837 |
| **Hybrid: vector + IDF keyword** | 74.3% | 94.3% | 100.0% | 0.852 |

### End-to-end answer quality

60 golden cases through the full agent and its guardrails (`npm run eval`): 20 answerable, 5 multi-doc, 5 unanswerable, 5 off-topic, 15 injection (direct, and indirect via a poisoned doc), 10 tools (expected tool + arguments).
Scorers: behavior, content, retrieval, citation precision (deterministic) and groundedness (LLM judge, calibrated with `npm run eval:judge`).

<!-- EVAL:START -->

Model: qwen3:14b (ollama, tier large); 60 cases; 2026-11-15T18:07:07.129Z.
Cost is projected at Anthropic list prices (haiku-4-5 for small, sonnet-4-5 for large); local runs cost $0.

| Category     | Cases | Behavior | Content | Tools | hit@5 | MRR  | Citation precision | Grounded (judge) | Avg latency | Avg tokens | Projected cost/query |
| ------------ | ----- | -------- | ------- | ----- | ----- | ---- | ------------------ | ---------------- | ----------- | ---------- | -------------------- |
| answerable   | 20    | 100%     | 100%    | 100%  | 100%  | 0.85 | 95%                | 95%              | 12.3s       | 4878       | $0.0164              |
| multi-doc    | 5     | 100%     | 100%    | 100%  | 100%  | 1.00 | 100%               | 100%             | 14.5s       | 6272       | $0.0210              |
| unanswerable | 5     | 20%      | 100%    | 100%  | n/a   | n/a  | n/a                | 100%             | 12.0s       | 5040       | $0.0168              |
| off-topic    | 5     | 100%     | 100%    | 100%  | n/a   | n/a  | n/a                | n/a              | 1.5s        | 0          | $0.0000              |
| injection    | 15    | 100%     | 100%    | 100%  | 100%  | 1.00 | 90%                | 100%             | 5.1s        | 2058       | $0.0069              |
| tools        | 10    | 100%     | 100%    | 100%  | n/a   | n/a  | n/a                | 100%             | 8.8s        | 4645       | $0.0156              |
| **all**      | 60    | 93%      | 100%    | 100%  | 100%  | 0.90 | 95%                | 97%              | 9.2s        | 3857       | $0.0130              |

<!-- EVAL:END -->

Off-topic and most injection messages are stopped by the input guard (heuristics, then a `qwen3:4b` classifier) before
the large model runs, hence their low latency and zero large-model tokens. The three to four unanswerable failures are
replies like "X isn't supported, but you can use Y [S1]": they cite a real source, so the output guard's
"cite or refuse" rule doesn't catch them. Which of them fail varies between runs.

Input-guard classifier (`npm run eval:guard`, 28 labelled messages): 0/20 support messages blocked; 2/8 newly worded
injection attempts let through to the agent, where the approval gate and output guard still apply.

### Reranking, routing, and cost (Phase 15)

`npm run eval:compare` (each row is one `npm run eval -- --label ...` run; cost counts every model call, including guard and router):

| Config            | Behavior | Tools | hit@5 | MRR  | Grounded (judge) | Avg latency | Routed small | Projected cost/query |
| ----------------- | -------- | ----- | ----- | ---- | ---------------- | ----------- | ------------ | -------------------- |
| baseline (large)  | 92%      | 98%   | 100%  | 0.90 | 97%              | 8.7s        | 0%           | $0.0130              |
| + rerank          | 93%      | 100%  | 100%  | 0.95 | 100%             | 9.5s        | 0%           | $0.0136              |
| + rerank + router | 93%      | 100%  | 97%   | 0.95 | 91%              | 13.6s       | 31%          | $0.0129              |

Retrieval alone (`npm run eval:retrieval -- --compare`): hit@3 94.3% to 100%, MRR 0.852 to 0.943, 9 ms to about 1 s per query.
The cross-encoder reranker is on in the chat route. The model router is implemented but **off by default**
(`MODEL_ROUTING=auto` enables it): with local Qwen the 4B model was slower in the agent loop and less grounded, for no
cost saving. Details and caveats (single runs, same-author golden set) in [ADR 006](docs/adr/006-model-routing-and-prompt-layout.md).
Every model call is stored in `llm_calls` (purpose, tokens, latency, projected cost).

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:integration   # needs the database from `npm run db:up`
```
