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

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:integration   # needs the database from `npm run db:up`
```
