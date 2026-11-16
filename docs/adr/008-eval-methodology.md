# ADR 008: Eval methodology, deterministic first, calibrated LLM judge second

Status: accepted (Phase 4, Phase 7)

## Context

Changes to prompts, retrieval, or models need a number that says better or worse. LLM-as-judge scores are cheap to
add but drift and flatter; deterministic checks are reproducible but can't judge whether an answer is supported.

## Decision

- **Golden set** (`evals/golden.jsonl`, 60 cases): answerable (20), multi-doc (5), unanswerable (5), off-topic (5),
  injection (15, direct and indirect), tools (10, expected tool and arguments). Each case names the expected
  behavior (`answer | refuse | escalate`), expected documents, and optional `mustContain` / `mustNotContain`.
- **Deterministic scorers first:** retrieval hit@k and MRR, behavior match (answer = grounded, escalate = needsHuman,
  refuse = neither), citation precision, content checks, expected tool calls, latency, tokens, projected cost.
- **LLM judge only for groundedness**, calibrated before it is trusted: `npm run eval:judge` compares it with 10
  hand-labelled answers (10/10 agreement when adopted).
- **CI runs only the deterministic retrieval eval** against a real pgvector database (hit@3 >= 90%). No LLM calls in
  CI: they would cost money or need a GPU and make the build flaky.
- Results are written to `evals/results/<timestamp>.{json,md}` and the README table; `npm run eval:compare` builds
  comparison tables across labelled runs (ADR 006).

## Consequences

- The golden questions were written by the same author as the docs, so real-user queries will score lower; tuning
  rules to this set would overfit it (the router decision in ADR 006 deliberately didn't).
- Ollama is not fully deterministic at temperature 0; one case flipping moves a 60-case score by about 1.7 points,
  so single runs are reported as such.
- Full answer evals run locally (about 10 minutes on an M4 Max).
