import { describe, expect, it } from "vitest";
import { parseCases } from "../cases";
import { type CaseResult, summarize } from "../report";
import {
  behaviorMatches,
  checkContent,
  citationPrecision,
  observedBehaviors,
  projectedCostUsd,
} from "./answer";

describe("behavior", () => {
  it("derives behaviours from grounded/needsHuman", () => {
    expect(observedBehaviors({ grounded: true, needsHuman: false })).toEqual(["answer"]);
    expect(observedBehaviors({ grounded: true, needsHuman: true })).toEqual(["answer", "escalate"]);
    expect(observedBehaviors({ grounded: false, needsHuman: true })).toEqual(["escalate"]);
    expect(observedBehaviors({ grounded: false, needsHuman: false })).toEqual(["refuse"]);
  });

  it("accepts a single expectation or a list", () => {
    expect(behaviorMatches({ grounded: false, needsHuman: true }, ["escalate", "refuse"])).toBe(true);
    expect(behaviorMatches({ grounded: false, needsHuman: false }, "answer")).toBe(false);
    expect(behaviorMatches({ grounded: true, needsHuman: true }, "escalate")).toBe(true);
  });
});

describe("citationPrecision", () => {
  it("is the share of cited documents that were expected", () => {
    expect(citationPrecision(["a", "b", "a"], ["a"])).toBe(0.5);
    expect(citationPrecision(["a"], ["a", "b"])).toBe(1);
  });
  it("is null when nothing is cited or nothing is expected", () => {
    expect(citationPrecision([], ["a"])).toBeNull();
    expect(citationPrecision(["a"], [])).toBeNull();
  });
});

describe("checkContent", () => {
  it("is case-insensitive and reports what failed", () => {
    expect(checkContent("The price is $99.", ["$99"], ["verify@x"]).ok).toBe(true);
    expect(checkContent("Email VERIFY@X now", [], ["verify@x"])).toMatchObject({
      ok: false,
      forbidden: ["verify@x"],
    });
    expect(checkContent("nothing", ["$99"])).toMatchObject({ ok: false, missing: ["$99"] });
  });
});

describe("projectedCostUsd", () => {
  it("prices tokens per million", () => {
    expect(projectedCostUsd("large", 1_000_000, 1_000_000)).toBe(18);
    expect(projectedCostUsd("small", 1000, 0)).toBeCloseTo(0.001);
  });
});

describe("summarize", () => {
  const base: CaseResult = {
    id: "x",
    category: "answerable",
    question: "q",
    behaviorOk: true,
    contentOk: true,
    retrievalRank: 1,
    hasExpectedDocs: true,
    citationPrecision: 1,
    groundedOk: true,
    latencyMs: 1000,
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.01,
  };
  it("averages only over applicable cases", () => {
    const row = summarize(
      [
        base,
        { ...base, retrievalRank: 4, groundedOk: false },
        {
          ...base,
          hasExpectedDocs: false,
          retrievalRank: null,
          citationPrecision: null,
          groundedOk: null,
          behaviorOk: false,
        },
      ],
      "t",
    );
    expect(row.n).toBe(3);
    expect(row.hitAt5).toBe(1);
    expect(row.mrr).toBeCloseTo((1 + 0.25) / 2);
    expect(row.grounded).toBe(0.5);
    expect(row.behavior).toBeCloseTo(2 / 3);
    expect(row.costUsd).toBeCloseTo(0.03);
  });
});

describe("golden.jsonl", () => {
  it("parses with defaults", () => {
    const [c] = parseCases('{"id":"a","category":"off-topic","question":"q"}');
    expect(c).toMatchObject({ expectedDocIds: [], expectedBehavior: "answer" });
  });
});
