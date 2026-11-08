import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type RetrieveOptions, createLocalEmbedder, loadConfig, retrieve } from "@app/core";
import { createDb } from "@app/db";
import { loadCases } from "./cases";
import {
  type RetrievalSummary,
  firstRelevantRank,
  rankedDocuments,
  summarizeRanks,
} from "./scorers/retrieval";

/** Configurations compared side by side; the first one is the production default. */
const CONFIGS: Record<string, RetrieveOptions> = {
  "hybrid (idf, 1:1) [default]": {},
  "vector only": { mode: "vector" },
  "keyword ts_rank only": { mode: "keyword", keywordScoring: "ts_rank" },
  "keyword idf only": { mode: "keyword", keywordScoring: "idf" },
  "hybrid (ts_rank, 1:1)": { mode: "hybrid", keywordScoring: "ts_rank" },
  "hybrid (ts_rank, 2:1)": { mode: "hybrid", keywordScoring: "ts_rank", weights: { vector: 2, keyword: 1 } },
  "hybrid (idf, 2:1)": { mode: "hybrid", keywordScoring: "idf", weights: { vector: 2, keyword: 1 } },
};

const { values } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    "min-hit3": { type: "string" },
    out: { type: "string" },
  },
});

const cases = await loadCases();
const embedder = createLocalEmbedder();
const { db, close } = createDb(loadConfig().DATABASE_URL);
const configNames = values.all ? Object.keys(CONFIGS) : [Object.keys(CONFIGS)[0]!];

const results: Array<RetrievalSummary & { config: string; msPerQuery: number }> = [];
const misses: string[] = [];

for (const name of configNames) {
  const ranks: Array<number | null> = [];
  const started = performance.now();
  for (const c of cases) {
    const chunks = await retrieve(db, embedder, c.question, { ...CONFIGS[name], k: 10 });
    const docs = rankedDocuments(chunks.map((ch) => ch.documentId));
    const rank = firstRelevantRank(docs, c.expectedDocIds);
    ranks.push(rank);
    if (name === configNames[0] && (rank === null || rank > 3)) {
      misses.push(`${c.id} "${c.question}" → got ${docs.slice(0, 3).join(", ")} (rank ${rank ?? "none"})`);
    }
  }
  results.push({
    config: name,
    ...summarizeRanks(ranks),
    msPerQuery: (performance.now() - started) / cases.length,
  });
}
await close();

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const table = [
  "| Config | hit@1 | hit@3 | hit@5 | MRR | ms/query |",
  "| ------ | ----- | ----- | ----- | --- | -------- |",
  ...results.map(
    (r) =>
      `| ${r.config} | ${pct(r.hitAt1)} | ${pct(r.hitAt3)} | ${pct(r.hitAt5)} | ${r.mrr.toFixed(3)} | ${r.msPerQuery.toFixed(1)} |`,
  ),
].join("\n");

console.log(`\nRetrieval eval: ${cases.length} cases (document-level, any expected doc counts)\n`);
console.log(table);
if (misses.length > 0)
  console.log(`\nMisses outside top 3 for "${configNames[0]}":\n- ${misses.join("\n- ")}`);

if (values.out) {
  const file = path.resolve(values.out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${table}\n`);
  console.log(`\nwrote ${file}`);
}

const minHit3 = values["min-hit3"] ? Number(values["min-hit3"]) : undefined;
if (minHit3 !== undefined && results[0]!.hitAt3 < minHit3) {
  console.error(`\nFAIL: hit@3 ${pct(results[0]!.hitAt3)} is below the threshold ${pct(minHit3)}`);
  process.exit(1);
}
