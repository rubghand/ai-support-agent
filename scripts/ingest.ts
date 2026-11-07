import path from "node:path";
import { createLocalEmbedder, ingestKnowledgeBase, loadConfig, loadKnowledgeBase } from "@app/core";
import { chunks, createDb } from "@app/db";

const started = performance.now();
const docs = await loadKnowledgeBase(path.resolve(import.meta.dirname, "../knowledge-base"));
const { db, close } = createDb(loadConfig().DATABASE_URL);

const stats = await ingestKnowledgeBase(db, docs, createLocalEmbedder());
const totalChunks = await db.$count(chunks);
await close();

console.table({ ...stats, totalChunksInDb: totalChunks });
console.log(`done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
