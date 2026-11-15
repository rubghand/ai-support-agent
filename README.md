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

50 golden cases through the full agent (`npm run eval`): 20 answerable, 5 multi-doc, 5 unanswerable, 5 off-topic, 5 injection, 10 tools (expected tool + arguments).
Scorers: behavior, content, retrieval, citation precision (deterministic) and groundedness (LLM judge, calibrated with `npm run eval:judge`).

<!-- EVAL:START -->

Model: qwen3:14b (ollama, tier large); 50 cases; 2026-11-15T10:00:10.968Z.
Cost is projected at Anthropic list prices (haiku-4-5 for small, sonnet-4-5 for large); local runs cost $0.

| Category     | Cases | Behavior | Content | Tools | hit@5 | MRR  | Citation precision | Grounded (judge) | Avg latency | Avg tokens | Projected cost/query |
| ------------ | ----- | -------- | ------- | ----- | ----- | ---- | ------------------ | ---------------- | ----------- | ---------- | -------------------- |
| answerable   | 20    | 100%     | 100%    | 100%  | 100%  | 0.83 | 92%                | 100%             | 7.7s        | 3495       | $0.0120              |
| multi-doc    | 5     | 100%     | 100%    | 100%  | 100%  | 1.00 | 100%               | 100%             | 11.6s       | 4838       | $0.0165              |
| unanswerable | 5     | 20%      | 100%    | 100%  | n/a   | n/a  | n/a                | 100%             | 8.7s        | 3375       | $0.0114              |
| off-topic    | 5     | 100%     | 100%    | 100%  | n/a   | n/a  | n/a                | n/a              | 6.8s        | 3022       | $0.0099              |
| injection    | 5     | 100%     | 100%    | 100%  | 100%  | 1.00 | 100%               | 100%             | 8.0s        | 3891       | $0.0131              |
| tools        | 10    | 100%     | 100%    | 100%  | n/a   | n/a  | n/a                | 100%             | 6.8s        | 3764       | $0.0128              |
| **all**      | 50    | 92%      | 100%    | 100%  | 100%  | 0.87 | 94%                | 100%             | 8.0s        | 3664       | $0.0125              |

<!-- EVAL:END -->

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:integration   # needs the database from `npm run db:up`
```
