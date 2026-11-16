import { describe, expect, it } from "vitest";
import { summarizeEvalRun } from "./eval-summary";

const run = {
  label: "baseline",
  tier: "large",
  rerank: true,
  results: [
    {
      id: "ret-01",
      category: "answerable",
      behaviorOk: true,
      groundedOk: true,
      latencyMs: 1000,
      costUsd: 0.01,
    },
    {
      id: "ret-02",
      category: "answerable",
      behaviorOk: false,
      groundedOk: false,
      latencyMs: 3000,
      costUsd: 0.02,
    },
    { id: "inj-01", category: "injection", behaviorOk: true, groundedOk: null, latencyMs: 2000, costUsd: 0 },
  ],
};

describe("summarizeEvalRun", () => {
  it("computes rates, per-category pass counts and failed ids", () => {
    const summary = summarizeEvalRun(run, "file");
    expect(summary).toMatchObject({ label: "baseline", cases: 3, avgLatencyMs: 2000, rerank: true });
    expect(summary.behaviorRate).toBeCloseTo(2 / 3);
    expect(summary.groundedRate).toBe(0.5);
    expect(summary.totalCostUsd).toBeCloseTo(0.03);
    expect(summary.categories).toEqual([
      { category: "answerable", cases: 2, behaviorPassed: 1, failedIds: ["ret-02"] },
      { category: "injection", cases: 1, behaviorPassed: 1, failedIds: [] },
    ]);
  });

  it("falls back to the file name for a missing label and null grounded rate when nothing was judged", () => {
    const summary = summarizeEvalRun(
      { results: [{ id: "a", category: "x", behaviorOk: true }] },
      "2026-01-01",
    );
    expect(summary).toMatchObject({ label: "2026-01-01", groundedRate: null, avgLatencyMs: 0 });
  });

  it("rejects a file that is not an eval run", () => {
    expect(() => summarizeEvalRun({ nope: 1 }, "x")).toThrow();
  });
});
