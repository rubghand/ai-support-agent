# Build from the repo root: docker build -f packages/mcp-server/Dockerfile .
# Workspace packages export TypeScript source, so this image runs them with tsx instead of a compile step.

# Full workspace: also used by the compose `setup` service (migrate, seed, ingest).
FROM node:24-bookworm-slim AS workspace
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/mcp-server/package.json packages/mcp-server/
RUN npm ci
COPY . .
ENV MODEL_CACHE_DIR=/models
RUN mkdir /models && chown node:node /models
USER node

FROM workspace AS mcp
ENV NODE_ENV=production \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3333
EXPOSE 3333
CMD ["node", "--import", "tsx", "packages/mcp-server/src/http-main.ts"]
