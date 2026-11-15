import { describe, expect, it } from "vitest";
import { type Reranker, rerankChunks } from "./rerank";
import type { RetrievedChunk } from "./search";

const chunk = (id: string): RetrievedChunk => ({
  chunkId: `${id}:0`,
  documentId: id,
  title: id,
  url: `https://docs.ledgerly.example/${id}`,
  headingPath: id,
  content: `content of ${id}`,
  updatedOn: new Date("2026-10-01"),
  score: 0.03,
  vectorRank: 1,
  keywordRank: 1,
});

const byDocument = (scores: Record<string, number>): Reranker => ({
  model: "fake",
  score: async (_query, docs) => docs.map((d) => scores[d.split(" - ")[0]!] ?? 0),
});

describe("rerankChunks", () => {
  const chunks = ["a", "b", "c", "d"].map(chunk);

  it("reorders by reranker score and keeps the best k", async () => {
    const out = await rerankChunks(byDocument({ a: -2, b: 3, c: 1, d: 0 }), "q", chunks, { k: 2 });
    expect(out.map((c) => c.documentId)).toEqual(["b", "c"]);
    expect(out[0]!.rerankScore).toBe(3);
  });

  it("keeps the fused order on ties", async () => {
    const out = await rerankChunks(byDocument({}), "q", chunks, { k: 3 });
    expect(out.map((c) => c.documentId)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for no candidates without calling the model", async () => {
    const never: Reranker = {
      model: "fake",
      score: async () => {
        throw new Error("called");
      },
    };
    expect(await rerankChunks(never, "q", [])).toEqual([]);
  });

  it("rejects a reranker that returns the wrong number of scores", async () => {
    const broken: Reranker = { model: "fake", score: async () => [1] };
    await expect(rerankChunks(broken, "q", chunks)).rejects.toThrow(/1 scores for 4 chunks/);
  });
});
