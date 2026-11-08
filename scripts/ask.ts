import { parseArgs } from "node:util";
import { type ModelTier, answerQuestion, createLlm, createLocalEmbedder, loadConfig } from "@app/core";
import { createDb } from "@app/db";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tier: { type: "string", default: "large" },
    json: { type: "boolean", default: false },
  },
});

const question = positionals.join(" ").trim();
const tier = values.tier as ModelTier;
if (!question || !["small", "large"].includes(tier)) {
  console.error('Usage: npm run ask -- "your question" [--tier small|large] [--json]');
  process.exit(1);
}

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const result = await answerQuestion(
  { db, embedder: createLocalEmbedder(), llm: createLlm(config) },
  question,
  {
    tier,
  },
);
await close();

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\nQ: ${question}\n\n${result.answer}\n`);
  for (const c of result.citations) console.log(`  [${c.label}] ${c.title} — ${c.url}`);
  if (result.invalidCitations.length > 0)
    console.log(`  invalid citations removed: ${result.invalidCitations.join(", ")}`);
  console.log(
    `\nconfidence=${result.confidence} needsHuman=${result.needsHuman} grounded=${result.grounded} attempts=${result.attempts}`,
  );
  console.log(
    `model=${result.model} tokens=${result.usage.inputTokens}+${result.usage.outputTokens} retrieval=${result.retrievalMs}ms generation=${result.latencyMs}ms`,
  );
  console.log(`retrieved: ${result.retrieved.map((r) => r.chunkId).join(", ")}`);
}
