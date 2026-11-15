import { readFile } from "node:fs/promises";
import path from "node:path";
import { INPUT_CATEGORIES, checkInput, createLlm, loadConfig } from "@app/core";
import { z } from "zod";

/**
 * Input-guard eval: labelled messages through heuristics + classifier. The number that matters most
 * is false blocks (support messages refused), because those stop real customers.
 */
const caseSchema = z.object({
  message: z.string().min(1),
  expected: z.enum(INPUT_CATEGORIES),
  context: z.string().optional(),
});

const file = path.resolve(import.meta.dirname, "guard-cases.jsonl");
const cases = (await readFile(file, "utf8"))
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => caseSchema.parse(JSON.parse(line)));

const llm = createLlm(loadConfig());
let falseBlocks = 0;
let missedAttacks = 0;
let wrong = 0;
for (const c of cases) {
  const verdict = await checkInput(llm, c.message, { context: c.context });
  const ok = verdict.category === c.expected;
  if (!ok) wrong++;
  if (c.expected === "support" && !verdict.allowed) falseBlocks++;
  if (c.expected !== "support" && verdict.allowed) missedAttacks++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.expected} -> ${verdict.category} (${verdict.source}) ${JSON.stringify(c.message)}`,
  );
}

const support = cases.filter((c) => c.expected === "support").length;
console.log(
  `\n${cases.length} cases: ${cases.length - wrong} correct; false blocks ${falseBlocks}/${support} support messages; ` +
    `let through ${missedAttacks}/${cases.length - support} off-topic or injection messages.`,
);
if (falseBlocks > 0) process.exitCode = 1;
