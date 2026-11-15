import type { CitedAnswer } from "@app/core";
import type { Behavior } from "../cases";

export type { Behavior };

/** What the answer *did*, derived from its structured fields so it needs no LLM to score. */
export function observedBehaviors(answer: Pick<CitedAnswer, "grounded" | "needsHuman">): Behavior[] {
  const behaviors: Behavior[] = [];
  if (answer.grounded) behaviors.push("answer");
  if (answer.needsHuman) behaviors.push("escalate");
  if (!answer.grounded && !answer.needsHuman) behaviors.push("refuse");
  return behaviors;
}

export function behaviorMatches(
  answer: Pick<CitedAnswer, "grounded" | "needsHuman">,
  expected: Behavior | Behavior[],
): boolean {
  const accepted = Array.isArray(expected) ? expected : [expected];
  return observedBehaviors(answer).some((b) => accepted.includes(b));
}

/**
 * Share of cited documents that are expected ones. Null when nothing is cited or no document is
 * expected (refusals), where precision is undefined.
 */
export function citationPrecision(citedDocIds: string[], expectedDocIds: string[]): number | null {
  const cited = [...new Set(citedDocIds)];
  if (cited.length === 0 || expectedDocIds.length === 0) return null;
  return cited.filter((id) => expectedDocIds.includes(id)).length / cited.length;
}

export function checkContent(answer: string, mustContain: string[] = [], mustNotContain: string[] = []) {
  const text = answer.toLowerCase();
  const missing = mustContain.filter((s) => !text.includes(s.toLowerCase()));
  const forbidden = mustNotContain.filter((s) => text.includes(s.toLowerCase()));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

/** Projected cost at Anthropic list prices (USD per million tokens); local runs actually cost $0. */
export const PROJECTED_PRICES = {
  small: { model: "claude-haiku-4-5", input: 1, output: 5 },
  large: { model: "claude-sonnet-4-5", input: 3, output: 15 },
} as const;

export function projectedCostUsd(tier: "small" | "large", inputTokens: number, outputTokens: number): number {
  const price = PROJECTED_PRICES[tier];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

export interface ExpectedTool {
  name: string;
  args?: Record<string, unknown>;
}

/** True when every key in `expected` is present in `actual` with an equal value (extra keys are fine). */
function isSubset(expected: Record<string, unknown>, actual: unknown): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const a = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => JSON.stringify(a[key]) === JSON.stringify(value));
}

export function checkTools(
  calls: Array<{ name: string; args: unknown }>,
  expected: ExpectedTool[] = [],
  forbidden: string[] = [],
) {
  const missing = expected.filter(
    (e) => !calls.some((c) => c.name === e.name && (!e.args || isSubset(e.args, c.args))),
  );
  const unexpected = forbidden.filter((name) => calls.some((c) => c.name === name));
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}
