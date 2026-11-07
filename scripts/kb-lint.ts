import path from "node:path";
import { loadKnowledgeBase, validateKnowledgeBase } from "@app/core";

const dir = path.resolve(import.meta.dirname, "../knowledge-base");
const docs = await loadKnowledgeBase(dir);
const problems = validateKnowledgeBase(docs);

const byCategory = Object.groupBy(docs, (doc) => doc.category);
for (const [category, items] of Object.entries(byCategory)) {
  console.log(`${category.padEnd(16)} ${items?.length ?? 0}`);
}
console.log(`total            ${docs.length}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("knowledge base OK");
