import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type ModelTier, answerQuestion, createLlm, createLocalEmbedder, loadConfig } from "@app/core";
import { createDb } from "@app/db";
import { CATEGORIES, type Category, type EvalCase, loadCases } from "./cases";
import { type CaseResult, renderTable } from "./report";
import {
  behaviorMatches,
  checkContent,
  citationPrecision,
  observedBehaviors,
  projectedCostUsd,
} from "./scorers/answer";
import { judgeGroundedness } from "./scorers/judge";
import { firstRelevantRank, rankedDocuments } from "./scorers/retrieval";

const { values } = parseArgs({
  options: {
    category: { type: "string" },
    tier: { type: "string", default: "large" },
    /** The golden file holds 35 retrieval-eval cases; only this many run through the LLM by default. */
    "answerable-limit": { type: "string", default: "20" },
    "no-judge": { type: "boolean", default: false },
    "write-readme": { type: "boolean", default: false },
  },
});

const tier = values.tier as ModelTier;
if (!["small", "large"].includes(tier)) throw new Error("--tier must be small or large");
if (values.category && !CATEGORIES.includes(values.category as Category)) {
  throw new Error(`--category must be one of ${CATEGORIES.join(", ")}`);
}

const answerableLimit = Number(values["answerable-limit"]);
let answerable = 0;
const cases: EvalCase[] = (await loadCases()).filter((c) => {
  if (values.category && c.category !== values.category) return false;
  return c.category !== "answerable" || answerable++ < answerableLimit;
});

const config = loadConfig();
const llm = createLlm(config);
const embedder = createLocalEmbedder();
const { db, close } = createDb(config.DATABASE_URL);
const results: CaseResult[] = [];

for (const c of cases) {
  const base = {
    id: c.id,
    category: c.category,
    question: c.question,
    hasExpectedDocs: c.expectedDocIds.length > 0,
  };
  try {
    const r = await answerQuestion({ db, embedder, llm }, c.question, { tier, k: 5 });
    const rank = firstRelevantRank(rankedDocuments(r.retrieved.map((ch) => ch.documentId)), c.expectedDocIds);
    const content = checkContent(r.answer, c.mustContain, c.mustNotContain);
    let groundedOk: boolean | null = null;
    let groundedReason: string | undefined;
    if (!values["no-judge"] && r.grounded) {
      const verdict = await judgeGroundedness(llm, c.question, r.retrieved, r.answer);
      groundedOk = verdict.supported;
      groundedReason = verdict.reason;
    }
    results.push({
      ...base,
      answer: r.answer,
      observed: observedBehaviors(r),
      behaviorOk: behaviorMatches(r, c.expectedBehavior),
      contentOk: content.ok,
      contentIssues: content.ok ? undefined : { missing: content.missing, forbidden: content.forbidden },
      retrievalRank: rank,
      citationPrecision: citationPrecision(
        r.citations.map((x) => x.documentId),
        c.expectedDocIds,
      ),
      groundedOk,
      groundedReason,
      latencyMs: r.retrievalMs + r.latencyMs,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: projectedCostUsd(tier, r.usage.inputTokens, r.usage.outputTokens),
    });
  } catch (error) {
    results.push({
      ...base,
      error: error instanceof Error ? error.message : String(error),
      behaviorOk: false,
      contentOk: false,
      retrievalRank: null,
      citationPrecision: null,
      groundedOk: null,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  }
  const last = results.at(-1)!;
  const flag = last.error
    ? "ERR "
    : last.behaviorOk && last.contentOk && last.groundedOk !== false
      ? "ok  "
      : "FAIL";
  console.log(`${flag} ${last.id} (${last.category}) ${last.error ?? last.observed?.join("+")}`);
}
await close();

const table = renderTable(results);
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = path.resolve(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
const header = `Model: ${llm.modelId(tier)} (${llm.provider}, tier ${tier}); ${results.length} cases; ${new Date().toISOString()}.\nCost is projected at Anthropic list prices (haiku-4-5 for small, sonnet-4-5 for large); local runs cost $0.`;
await writeFile(
  path.join(dir, `${stamp}.json`),
  `${JSON.stringify({ tier, model: llm.modelId(tier), results }, null, 2)}\n`,
);
await writeFile(path.join(dir, `${stamp}.md`), `${header}\n\n${table}\n`);

const failures = results.filter((r) => r.error || !r.behaviorOk || !r.contentOk || r.groundedOk === false);
console.log(`\n${header}\n\n${table}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    const why =
      f.error ??
      [
        !f.behaviorOk && `behavior=${f.observed?.join("+")}`,
        f.contentIssues?.missing.length ? `missing ${JSON.stringify(f.contentIssues.missing)}` : "",
        f.contentIssues?.forbidden.length ? `forbidden ${JSON.stringify(f.contentIssues.forbidden)}` : "",
        f.groundedOk === false && `ungrounded: ${f.groundedReason}`,
      ]
        .filter(Boolean)
        .join("; ");
    console.log(`- ${f.id}: ${f.question}\n    ${why}\n    answer: ${f.answer?.slice(0, 200) ?? ""}`);
  }
}
console.log(`\nwrote evals/results/${stamp}.{json,md}`);

if (values["write-readme"]) {
  const readmePath = path.resolve(import.meta.dirname, "../README.md");
  const readme = await readFile(readmePath, "utf8");
  const block = `<!-- EVAL:START -->\n${header}\n\n${table}\n<!-- EVAL:END -->`;
  if (!readme.includes("<!-- EVAL:START -->")) throw new Error("README.md is missing the EVAL markers");
  await writeFile(readmePath, readme.replace(/<!-- EVAL:START -->[\s\S]*<!-- EVAL:END -->/, block));
  console.log("updated README.md results section");
}
