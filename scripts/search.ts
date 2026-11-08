import { parseArgs } from "node:util";
import { type RetrievalMode, createLocalEmbedder, loadConfig, retrieve } from "@app/core";
import { createDb } from "@app/db";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "hybrid" },
    k: { type: "string", default: "5" },
  },
});

const query = positionals.join(" ").trim();
const modes = ["hybrid", "vector", "keyword"] as const;
const mode = values.mode as RetrievalMode;
if (!query || !modes.includes(mode)) {
  console.error('Usage: npm run search -- "your question" [--mode hybrid|vector|keyword] [--k 5]');
  process.exit(1);
}

const { db, close } = createDb(loadConfig().DATABASE_URL);
const started = performance.now();
const results = await retrieve(db, createLocalEmbedder(), query, { mode, k: Number(values.k) });
const elapsedMs = Math.round(performance.now() - started);
await close();

console.log(`\n"${query}"  (mode: ${mode}, ${elapsedMs} ms incl. model load)\n`);
console.table(
  results.map((r) => ({
    chunk: r.chunkId,
    section: r.headingPath,
    rrf: r.score.toFixed(4),
    vectorRank: r.vectorRank ?? "-",
    keywordRank: r.keywordRank ?? "-",
  })),
);
