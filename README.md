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

## Try retrieval

```bash
npm run search -- "can I get my money back for a monthly plan?"
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

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:integration   # needs the database from `npm run db:up`
```
