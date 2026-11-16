# ADR 002: pgvector and hybrid search instead of a dedicated vector database

Status: accepted (Phase 3, Phase 4)

## Context

The app already needs Postgres for users, orders, conversations, approvals, and telemetry. The knowledge base is
small (32 docs, 56 chunks). Support questions mix paraphrase ("get my money back") with exact terms
("ORD-1042", "Zapier", "credit note") that embeddings handle poorly.

## Decision

- Chunks live in Postgres with `embedding vector(384)` (HNSW index, cosine) and a generated `tsvector` (GIN index).
- `retrieve()` runs vector search and keyword search and fuses them with weighted Reciprocal Rank Fusion (k = 60).
- Keyword scoring is IDF-weighted (BM25-style, binary term frequency, heading boost 1.5), computed from the
  `tsvector` lexemes, because Postgres `ts_rank` has no IDF and ranked rare terms no higher than common ones.
- Weights stay 1:1. 2:1 (vector-heavy) scored hit@3 97.1% against 94.3%, but on 35 cases that is one question,
  so it was not worth fitting.
- A cross-encoder reranker was added later on top of fusion (ADR 006).

## Results (35 golden retrieval cases, `npm run eval:retrieval -- --all`)

| Config                     | hit@1 | hit@3  | hit@5  | MRR   |
| -------------------------- | ----- | ------ | ------ | ----- |
| Keyword (ts_rank)          | 48.6% | 77.1%  | 88.6%  | 0.662 |
| Keyword (IDF)              | 71.4% | 85.7%  | 91.4%  | 0.795 |
| Vector (bge-small)         | 74.3% | 88.6%  | 100.0% | 0.837 |
| Hybrid (vector + IDF)      | 74.3% | 94.3%  | 100.0% | 0.852 |
| Hybrid + rerank (Phase 15) | 88.6% | 100.0% | 100.0% | 0.943 |

## Consequences

- One database, one backup, transactional consistency between documents and chunks; no extra service.
- CI gates on hit@3 >= 90% against a real pgvector service container.
- At millions of chunks, IDF computed in SQL and HNSW tuning would need revisiting; not a concern at this size.
