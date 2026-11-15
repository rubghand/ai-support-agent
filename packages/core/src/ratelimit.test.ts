import { describe, expect, it } from "vitest";
import { type BucketConfig, takeTokens } from "./ratelimit";

const config: BucketConfig = { capacity: 3, refillPerSecond: 0.5 };
const t0 = new Date("2026-01-01T00:00:00Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

describe("takeTokens", () => {
  it("allows a burst up to capacity, then denies with a retry hint", () => {
    let state = { tokens: config.capacity, updatedAt: t0 };
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const step = takeTokens(state, config, t0);
      state = { tokens: step.tokens, updatedAt: t0 };
      outcomes.push(step.result);
    }
    expect(outcomes.map((o) => o.allowed)).toEqual([true, true, true, false]);
    expect(outcomes[2]!.remaining).toBe(0);
    expect(outcomes[3]).toMatchObject({ retryAfterSeconds: 2, remaining: 0 });
  });

  it("refills over time but never beyond capacity", () => {
    const empty = { tokens: 0, updatedAt: t0 };
    expect(takeTokens(empty, config, at(1)).result.allowed).toBe(false);
    expect(takeTokens(empty, config, at(2)).result.allowed).toBe(true);
    const full = takeTokens({ tokens: 2, updatedAt: t0 }, config, at(3600));
    expect(full.tokens).toBe(config.capacity - 1);
  });

  it("tolerates clock skew (now before updatedAt)", () => {
    const step = takeTokens({ tokens: 1, updatedAt: at(10) }, config, t0);
    expect(step.result.allowed).toBe(true);
    expect(step.tokens).toBe(0);
  });
});
