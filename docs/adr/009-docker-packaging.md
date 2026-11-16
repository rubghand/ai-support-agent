# ADR 009: Docker packaging

Status: accepted (Phase 18)

## Context

`docker compose up` should start a working stack from a fresh clone: database, schema, demo data, indexed docs,
the web app, and the MCP server. The LLM runs in Ollama, which needs the host GPU (Metal on macOS) that containers
can't use. Workspace packages export TypeScript source (ADR 001), and inference uses native ONNX binaries.

## Decision

- **Ollama stays on the host.** Containers reach it at `http://host.docker.internal:11434`
  (`DOCKER_OLLAMA_BASE_URL` overrides it; `extra_hosts: host-gateway` makes it resolve on Linux too).
- **Web image** (`apps/web/Dockerfile`): Next.js `output: "standalone"` traced from the monorepo root, on
  `node:24-bookworm-slim` (onnxruntime-node ships glibc binaries only, so no Alpine), running as `node`. The tracer
  misses `onnxruntime-node` (loaded with `createRequire`) and keeps only the ESM half of `onnxruntime-common`, so both
  are listed in `outputFileTracingIncludes` (Linux binaries only). The image also carries `evals/results`, so the admin
  eval card works in Docker.
- **Workspace image** (`packages/mcp-server/Dockerfile`): full workspace with dependencies, run with `tsx` rather than
  adding a compile step for each package. Its `workspace` target is the one-shot `setup` service (migrate,
  `db:seed --if-empty`, ingest); its `mcp` target runs the MCP HTTP server.
- **Startup order:** `db` (healthy) -> `setup` (completed successfully) -> `web` and `mcp` (both with healthchecks:
  `/login` returns 200, unauthenticated `POST /mcp` returns 401).
- **Seeding runs once.** `--if-empty` keeps users, conversations, and approvals across restarts; ingest is idempotent.
- **Models in a volume.** transformers.js caches next to its install by default; `MODEL_CACHE_DIR=/models` (a named
  volume shared by `setup` and `web`) keeps the embedder and reranker (~410 MB) across rebuilds.
- **Secrets from `.env`** via `env_file` (optional file), with container-specific values (`DATABASE_URL`,
  `OLLAMA_BASE_URL`) overriding it. `AUTH_TRUST_HOST=true` because Auth.js only trusts the Host header on known
  platforms by default.
- **CI** builds both images, boots the stack with throwaway secrets, and smoke-tests login, the 401s, and an MCP tool
  call with a minted token. No LLM is involved.

## Consequences

- The workspace image is large (dev dependencies, all ONNX platforms); acceptable for a local demo, not for production.
- Without Ollama on the host, the stack starts but chat requests fail; `LLM_PROVIDER=google` with a key in `.env` is
  the alternative.
- The first chat after a fresh start downloads the reranker (~290 MB) and takes about 40 s.
