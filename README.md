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
cp .env.example .env
npm install
npm run setup   # start Postgres, migrate, seed, ingest the knowledge base
npm run dev
```

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

40 golden cases through the full pipeline (`npm run eval`): 20 answerable, 5 multi-doc, 5 unanswerable, 5 off-topic, 5 injection.
Scorers: behavior, content, retrieval, citation precision (deterministic) and groundedness (LLM judge, calibrated with `npm run eval:judge`).

<!-- EVAL:START -->

Model: qwen3:14b (ollama, tier large); 40 cases; 2026-11-15T06:55:57.041Z.
Cost is projected at Anthropic list prices (haiku-4-5 for small, sonnet-4-5 for large); local runs cost $0.

| Category     | Cases | Behavior | Content | hit@5 | MRR  | Citation precision | Grounded (judge) | Avg latency | Avg tokens | Projected cost/query |
| ------------ | ----- | -------- | ------- | ----- | ---- | ------------------ | ---------------- | ----------- | ---------- | -------------------- |
| answerable   | 20    | 100%     | 100%    | 100%  | 0.88 | 98%                | 100%             | 3.7s        | 1404       | $0.0050              |
| multi-doc    | 5     | 100%     | 100%    | 100%  | 0.90 | 100%               | 100%             | 7.6s        | 1480       | $0.0055              |
| unanswerable | 5     | 80%      | 100%    | n/a   | n/a  | n/a                | 100%             | 3.4s        | 1246       | $0.0043              |
| off-topic    | 5     | 100%     | 100%    | n/a   | n/a  | n/a                | n/a              | 5.0s        | 1398       | $0.0047              |
| injection    | 5     | 100%     | 100%    | 100%  | 1.00 | 100%               | 100%             | 5.3s        | 1322       | $0.0047              |
| **all**      | 40    | 98%      | 100%    | 100%  | 0.89 | 98%                | 100%             | 4.5s        | 1383       | $0.0049              |

<!-- EVAL:END -->

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:integration   # needs the database from `npm run db:up`
```
