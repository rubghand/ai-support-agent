import { createLlm, createLocalEmbedder, createLocalReranker, loadConfig } from "@app/core";
import { createDb } from "@app/db";

export type Role = "customer" | "admin";

/** Process-wide singletons (one pool, one loaded embedding model); survive dev hot reloads via globalThis. */
function create() {
  const config = loadConfig();
  const { db } = createDb(config.DATABASE_URL);
  return {
    db,
    embedder: createLocalEmbedder(),
    reranker: createLocalReranker(),
    llm: createLlm(config),
    modelRouting: config.MODEL_ROUTING,
    langfuse:
      config.LANGFUSE_PUBLIC_KEY && config.LANGFUSE_SECRET_KEY
        ? {
            publicKey: config.LANGFUSE_PUBLIC_KEY,
            secretKey: config.LANGFUSE_SECRET_KEY,
            baseUrl: config.LANGFUSE_BASE_URL,
          }
        : undefined,
  };
}

const globalForServices = globalThis as unknown as { __services?: ReturnType<typeof create> };

export function getServices() {
  globalForServices.__services ??= create();
  return globalForServices.__services;
}
