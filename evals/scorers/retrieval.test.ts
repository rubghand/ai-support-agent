import path from "node:path";
import { loadKnowledgeBase } from "@app/core";
import { describe, expect, it } from "vitest";
import { loadCases } from "../cases";
import { firstRelevantRank, rankedDocuments, summarizeRanks } from "./retrieval";

describe("retrieval scorers", () => {
  it("collapses chunks to documents in rank order", () => {
    expect(rankedDocuments(["a", "a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("finds the rank of the first expected document", () => {
    expect(firstRelevantRank(["x", "y", "z"], ["z", "y"])).toBe(2);
    expect(firstRelevantRank(["x"], ["z"])).toBeNull();
  });

  it("computes hit@k and MRR", () => {
    expect(summarizeRanks([1, 2, null, 4])).toEqual({
      cases: 4,
      hitAt1: 0.25,
      hitAt3: 0.5,
      hitAt5: 0.75,
      mrr: (1 + 0.5 + 0 + 0.25) / 4,
    });
  });
});

describe("golden set", () => {
  it("parses, has unique ids, and only expects documents that exist", async () => {
    const kb = await loadKnowledgeBase(path.resolve(import.meta.dirname, "../../knowledge-base"));
    const docIds = new Set(kb.map((d) => d.id));
    const cases = await loadCases();
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) for (const id of c.expectedDocIds) expect(docIds, `${c.id}: ${id}`).toContain(id);
  });
});
