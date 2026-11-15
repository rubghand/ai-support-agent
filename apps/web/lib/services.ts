import { createLlm, createLocalEmbedder, loadConfig } from "@app/core";
import { createDb } from "@app/db";

export type Role = "customer" | "admin";

/** Process-wide singletons (one pool, one loaded embedding model); survive dev hot reloads via globalThis. */
function create() {
  const config = loadConfig();
  const { db } = createDb(config.DATABASE_URL);
  return { db, embedder: createLocalEmbedder(), llm: createLlm(config) };
}

const globalForServices = globalThis as unknown as { __services?: ReturnType<typeof create> };

export function getServices() {
  globalForServices.__services ??= create();
  return globalForServices.__services;
}
