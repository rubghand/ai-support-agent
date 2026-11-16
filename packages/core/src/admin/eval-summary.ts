import { z } from "zod";

const caseSchema = z.object({
  id: z.string(),
  category: z.string(),
  behaviorOk: z.boolean(),
  contentOk: z.boolean().optional(),
  groundedOk: z.boolean().nullable().optional(),
  latencyMs: z.number().optional(),
  costUsd: z.number().optional(),
});

export const evalRunSchema = z.object({
  label: z.string().nullable().optional(),
  tier: z.string().optional(),
  rerank: z.boolean().optional(),
  results: z.array(caseSchema),
});

export interface EvalCategorySummary {
  category: string;
  cases: number;
  behaviorPassed: number;
  failedIds: string[];
}

export interface EvalSummary {
  label: string;
  tier: string;
  rerank: boolean;
  cases: number;
  behaviorRate: number;
  /** Share of judged cases the LLM judge found grounded; null when no case was judged. */
  groundedRate: number | null;
  avgLatencyMs: number;
  totalCostUsd: number;
  categories: EvalCategorySummary[];
}

/** Reduces one `evals/results/*.json` file to the numbers the dashboard shows; throws on a file of another shape. */
export function summarizeEvalRun(raw: unknown, fallbackLabel: string): EvalSummary {
  const run = evalRunSchema.parse(raw);
  const results = run.results;
  const byCategory = new Map<string, EvalCategorySummary>();
  for (const r of results) {
    const entry = byCategory.get(r.category) ?? {
      category: r.category,
      cases: 0,
      behaviorPassed: 0,
      failedIds: [],
    };
    entry.cases += 1;
    if (r.behaviorOk) entry.behaviorPassed += 1;
    else entry.failedIds.push(r.id);
    byCategory.set(r.category, entry);
  }
  const judged = results.filter((r) => typeof r.groundedOk === "boolean");
  const latencies = results.flatMap((r) => (r.latencyMs === undefined ? [] : [r.latencyMs]));
  return {
    label: run.label ?? fallbackLabel,
    tier: run.tier ?? "unknown",
    rerank: run.rerank ?? false,
    cases: results.length,
    behaviorRate: results.length === 0 ? 0 : results.filter((r) => r.behaviorOk).length / results.length,
    groundedRate: judged.length === 0 ? null : judged.filter((r) => r.groundedOk).length / judged.length,
    avgLatencyMs:
      latencies.length === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    totalCostUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    categories: [...byCategory.values()],
  };
}
