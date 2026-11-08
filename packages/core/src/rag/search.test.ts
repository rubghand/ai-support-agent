import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./search";

describe("reciprocalRankFusion", () => {
  it("rewards items that appear high in several lists", () => {
    const fused = reciprocalRankFusion([{ ids: ["a", "b", "c"] }, { ids: ["c", "b", "d"] }]);
    // c (ranks 1 and 3) edges out b (rank 2 twice): 1/61 + 1/63 > 2/62.
    expect(fused.map((f) => f.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("scores with weight / (k + rank)", () => {
    const [top] = reciprocalRankFusion([{ ids: ["a"] }, { ids: ["a"], weight: 0.5 }], 60);
    expect(top?.score).toBeCloseTo(1.5 / 61);
  });

  it("lets a heavier list win when lists disagree", () => {
    const fused = reciprocalRankFusion([
      { ids: ["v"], weight: 2 },
      { ids: ["k"], weight: 1 },
    ]);
    expect(fused[0]?.id).toBe("v");
  });

  it("handles empty lists and breaks ties by id", () => {
    expect(reciprocalRankFusion([{ ids: [] }, { ids: [] }])).toEqual([]);
    expect(reciprocalRankFusion([{ ids: ["z"] }, { ids: ["y"] }]).map((f) => f.id)).toEqual(["y", "z"]);
  });
});
