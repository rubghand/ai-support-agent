import { Output, generateText } from "ai";
import { z } from "zod";
import type { Llm, ModelTier } from "./provider";

export type RouteSource = "heuristic" | "classifier" | "classifier_error" | "forced";

export interface RouteDecision {
  tier: ModelTier;
  source: RouteSource;
  reason: string;
}

export interface RouteContext {
  /** True when earlier turns exist; a short follow-up then depends on context the small model handles badly. */
  hasHistory?: boolean;
  signal?: AbortSignal;
}

/** Messages where a wrong or sloppy answer costs something (money, tickets) or needs reliable tool calls. */
const ACTION_WORDS =
  /\b(refund|refunded|cancel|cancell?ation|charge[ds]?|chargeback|dispute|double[- ]charged|billing|escalate|human|agent|ticket|complain\w*|lawyer|legal|gdpr|delete my|close my account)\b/i;
const ORDER_ID = /\bORD-\d+\b/i;
const FOLLOW_UP = /\b(it|that|this|those|them|the same|again|earlier|above)\b/i;
const SIMPLE_OPENER =
  /^(how (do|can|to)|where (do|can|is)|what is|what's|what are|does|do you|can i|is there)\b/i;
const MAX_SIMPLE_WORDS = 14;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Free first pass. Returns a decision only when the signal is clear:
 * large for anything that acts on an account or is long / multi-part / a follow-up, small for a short
 * single-sentence docs question. Everything in between goes to the classifier. The rules lean towards
 * large because the small model measurably misses escalation and over-cites (see Phase 5).
 */
export function routeByHeuristics(
  question: string,
  { hasHistory = false }: RouteContext = {},
): RouteDecision | null {
  const text = question.trim();
  const words = wordCount(text);
  const heuristic = (tier: ModelTier, reason: string): RouteDecision => ({
    tier,
    source: "heuristic",
    reason,
  });

  if (ORDER_ID.test(text)) return heuristic("large", "mentions an order id (needs tools)");
  if (ACTION_WORDS.test(text)) return heuristic("large", "account action or escalation wording");
  if ((text.match(/\?/g) ?? []).length > 1) return heuristic("large", "several questions in one message");
  if (words > 40) return heuristic("large", "long message");
  if (hasHistory && FOLLOW_UP.test(text))
    return heuristic("large", "follow-up that depends on earlier turns");
  if (words <= MAX_SIMPLE_WORDS && SIMPLE_OPENER.test(text) && !/\d/.test(text)) {
    return heuristic("small", "short single docs question");
  }
  return null;
}

const complexitySchema = z.object({
  complexity: z.enum(["simple", "complex"]),
  reason: z.string().max(200),
});

const ROUTER_PROMPT = `You decide how hard a customer support question for Ledgerly (an invoicing product) is to answer well.

"simple": one self-contained how-to or factual question that one help-center article answers.
"complex": needs combining several articles, comparing plans or policies, conflicting or outdated information, troubleshooting with several steps, anything about the customer's own account, or an unclear request.

When unsure, answer "complex". Answer with the JSON object only.`;

/** Small-model second opinion for questions the heuristics could not place. */
export async function classifyComplexity(
  llm: Llm,
  question: string,
  signal?: AbortSignal,
): Promise<z.infer<typeof complexitySchema>> {
  const { output } = await generateText({
    model: llm.model("small"),
    system: ROUTER_PROMPT,
    prompt: `<question>\n${question}\n</question>`,
    output: Output.object({ schema: complexitySchema, name: "Complexity" }),
    temperature: 0,
    providerOptions: llm.providerOptions,
    abortSignal: signal,
  });
  return output;
}

/**
 * Picks the model tier for a question. A classifier failure falls back to large: a slower answer is
 * cheaper than a wrong one.
 */
export async function routeQuestion(
  llm: Llm,
  question: string,
  context: RouteContext = {},
): Promise<RouteDecision> {
  const byRule = routeByHeuristics(question, context);
  if (byRule) return byRule;
  try {
    const { complexity, reason } = await classifyComplexity(llm, question, context.signal);
    return { tier: complexity === "simple" ? "small" : "large", source: "classifier", reason };
  } catch (error) {
    if (context.signal?.aborted) throw error;
    console.warn("router classifier failed; using the large model", error);
    return { tier: "large", source: "classifier_error", reason: "classifier failed" };
  }
}
