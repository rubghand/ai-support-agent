# ADR 003: Local embeddings (bge-small) and heading-aware chunking

Status: accepted (Phase 3)

## Context

The project must run at $0 and offline-capable. Embeddings are needed at ingest (all chunks) and per query.
Help-center pages are structured by headings; a chunk that loses its heading loses most of its meaning
("How long does it take?" under "Refunds" vs "Payouts").

## Decision

- **Embeddings:** `Xenova/bge-small-en-v1.5` via transformers.js (ONNX, in-process), 384 dimensions, CLS pooling,
  normalized. Queries get bge's retrieval instruction prefix; documents are embedded as-is.
- **Chunking:** split on headings; target at most 300 tokens and at least 60 (small sections merge with their
  neighbours); long sections split with a 45-token overlap. Each chunk keeps its heading path
  (`Refunds > Annual plans`), which is embedded with the text and shown to the model.
- **Idempotent ingest:** documents are skipped when their content hash is unchanged; chunks reuse existing embeddings
  by chunk hash. A re-run embeds 0 chunks.
- Result: 32 docs -> 56 chunks (60-296 tokens, average 140).

## Consequences

- No API key and no per-token cost; the model (~130 MB) downloads on first use. Containers keep it in a volume
  (`MODEL_CACHE_DIR`, ADR 009).
- bge-small is English-only and weaker than large hosted embedders; hybrid search and reranking compensate.
- Changing the embedding model means a new vector column size and a full re-embed.
