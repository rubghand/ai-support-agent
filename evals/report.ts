import { CATEGORIES, type Category } from "./cases";
import { mean } from "./scorers/answer";

export interface CaseResult {
  id: string;
  category: Category;
  question: string;
  error?: string;
  answer?: string;
  observed?: string[];
  behaviorOk: boolean;
  contentOk: boolean;
  toolsOk: boolean;
  toolCalls?: Array<{ name: string; args: unknown; ok: boolean }>;
  toolIssues?: { missing: unknown[]; unexpected: string[] };
  contentIssues?: { missing: string[]; forbidden: string[] };
  /** 1-based rank of the first expected document among retrieved docs; null when none or none expected. */
  retrievalRank: number | null;
  hasExpectedDocs: boolean;
  citationPrecision: number | null;
  /** Null when the case wasn't judged (refusals, judge disabled). */
  groundedOk: boolean | null;
  groundedReason?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const rate = (flags: boolean[]) => mean(flags.map(Number));

export interface Row {
  label: string;
  n: number;
  behavior: number | null;
  content: number | null;
  tools: number | null;
  hitAt5: number | null;
  mrr: number | null;
  citationPrecision: number | null;
  grounded: number | null;
  latencyMs: number | null;
  tokens: number | null;
  costUsd: number;
}

export function summarize(results: CaseResult[], label: string): Row {
  const withDocs = results.filter((r) => r.hasExpectedDocs);
  const judged = results.filter((r) => r.groundedOk !== null);
  return {
    label,
    n: results.length,
    behavior: rate(results.map((r) => r.behaviorOk)),
    content: rate(results.map((r) => r.contentOk)),
    tools: rate(results.map((r) => r.toolsOk)),
    hitAt5: rate(withDocs.map((r) => r.retrievalRank !== null && r.retrievalRank <= 5)),
    mrr: mean(withDocs.map((r) => (r.retrievalRank === null ? 0 : 1 / r.retrievalRank))),
    citationPrecision: mean(
      results.flatMap((r) => (r.citationPrecision === null ? [] : [r.citationPrecision])),
    ),
    grounded: rate(judged.map((r) => r.groundedOk === true)),
    latencyMs: mean(results.map((r) => r.latencyMs)),
    tokens: mean(results.map((r) => r.inputTokens + r.outputTokens)),
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

export function renderTable(results: CaseResult[]): string {
  const rows = [
    ...CATEGORIES.map((c) => ({ c, rs: results.filter((r) => r.category === c) }))
      .filter(({ rs }) => rs.length > 0)
      .map(({ c, rs }) => summarize(rs, c)),
    summarize(results, "**all**"),
  ];
  const lines = rows.map(
    (r) =>
      `| ${r.label} | ${r.n} | ${pct(r.behavior)} | ${pct(r.content)} | ${pct(r.tools)} | ${pct(r.hitAt5)} | ${r.mrr === null ? "n/a" : r.mrr.toFixed(2)} | ${pct(r.citationPrecision)} | ${pct(r.grounded)} | ${r.latencyMs === null ? "n/a" : (r.latencyMs / 1000).toFixed(1)}s | ${r.tokens === null ? "n/a" : Math.round(r.tokens)} | $${(r.costUsd / Math.max(r.n, 1)).toFixed(4)} |`,
  );
  return [
    "| Category | Cases | Behavior | Content | Tools | hit@5 | MRR | Citation precision | Grounded (judge) | Avg latency | Avg tokens | Projected cost/query |",
    "| -------- | ----- | -------- | ------- | ----- | ----- | --- | ------------------ | ---------------- | ----------- | ---------- | -------------------- |",
    ...lines,
  ].join("\n");
}
