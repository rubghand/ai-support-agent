import { readFile } from "node:fs/promises";
import path from "node:path";
import { type RetrievedChunk, createLlm, loadConfig } from "@app/core";
import { z } from "zod";
import { judgeGroundedness } from "./scorers/judge";

const rowSchema = z.object({
  id: z.string(),
  question: z.string(),
  source: z.string(),
  answer: z.string(),
  supported: z.boolean(),
});

/** Checks the groundedness judge against 10 hand-labelled answers before trusting its scores. */
const file = path.resolve(import.meta.dirname, "judge-calibration.jsonl");
const rows = (await readFile(file, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => rowSchema.parse(JSON.parse(line)));
const llm = createLlm(loadConfig());

let agree = 0;
for (const row of rows) {
  const chunk: RetrievedChunk = {
    chunkId: row.id,
    documentId: row.id,
    title: "Source",
    url: "",
    headingPath: "Source",
    content: row.source,
    updatedOn: new Date("2026-10-01"),
    score: 0,
    vectorRank: null,
    keywordRank: null,
  };
  const verdict = await judgeGroundedness(llm, row.question, [chunk], row.answer);
  const ok = verdict.supported === row.supported;
  if (ok) agree++;
  console.log(
    `${ok ? "ok  " : "MISS"} ${row.id} label=${row.supported} judge=${verdict.supported} — ${verdict.reason}`,
  );
}
const rate = agree / rows.length;
console.log(`\nJudge agreement with hand labels: ${agree}/${rows.length} (${(rate * 100).toFixed(0)}%)`);
if (rate < 0.9) process.exit(1);
