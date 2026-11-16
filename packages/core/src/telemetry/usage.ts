import { type Db, llmCalls } from "@app/db";
import { wrapLanguageModel } from "ai";
import type { Llm, ModelTier } from "../llm/provider";

/** USD per million tokens at a reference cloud model's list price. Local runs cost $0; this is what they would cost. */
export const PRICE_TABLE = {
  small: { model: "claude-haiku-4-5", input: 1, output: 5 },
  large: { model: "claude-sonnet-4-5", input: 3, output: 15 },
} as const satisfies Record<ModelTier, { model: string; input: number; output: number }>;

export function projectCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const price = PRICE_TABLE[tier];
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export const CALL_PURPOSES = ["guard", "route", "summary", "agent"] as const;
export type CallPurpose = (typeof CALL_PURPOSES)[number];

export interface LlmCallRecord {
  purpose: CallPurpose;
  tier: ModelTier;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  projectedCostUsd: number;
  priceModel: string;
}

export interface CallTiming {
  startedAt: number;
  endedAt: number;
  /** Span the call belongs under, when the caller passed one to `meter`. */
  parentId?: string;
}

export interface CallCollector {
  /** Returns a view of `llm` whose every model call is recorded under `purpose` (and traced under `parentId`). */
  meter(llm: Llm, purpose: CallPurpose, parentId?: string): Llm;
  calls: LlmCallRecord[];
  totals(): { inputTokens: number; outputTokens: number; projectedCostUsd: number; calls: number };
}

/**
 * Collects one record per model call. Metering sits in a model middleware, so it sees every call
 * (including retries and streamed ones) without each call site having to report its own usage.
 */
export function createCallCollector(
  onCall?: (call: LlmCallRecord, timing: CallTiming) => void,
): CallCollector {
  const calls: LlmCallRecord[] = [];
  const record = (
    parentId: string | undefined,
    purpose: CallPurpose,
    tier: ModelTier,
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
  ) => {
    const call: LlmCallRecord = {
      purpose,
      tier,
      model,
      inputTokens,
      outputTokens,
      latencyMs: Math.round(latencyMs),
      projectedCostUsd: projectCostUsd(tier, inputTokens, outputTokens),
      priceModel: PRICE_TABLE[tier].model,
    };
    calls.push(call);
    const endedAt = Date.now();
    onCall?.(call, { startedAt: endedAt - latencyMs, endedAt, parentId });
  };

  return {
    calls,
    meter(llm, purpose, parentId) {
      const metered = (tier: ModelTier) =>
        wrapLanguageModel({
          model: llm.model(tier) as Parameters<typeof wrapLanguageModel>[0]["model"],
          middleware: {
            specificationVersion: "v4",
            wrapGenerate: async ({ doGenerate }) => {
              const started = performance.now();
              const result = await doGenerate();
              record(
                parentId,
                purpose,
                tier,
                llm.modelId(tier),
                result.usage.inputTokens.total ?? 0,
                result.usage.outputTokens.total ?? 0,
                performance.now() - started,
              );
              return result;
            },
            wrapStream: async ({ doStream }) => {
              const started = performance.now();
              const { stream, ...rest } = await doStream();
              return {
                ...rest,
                stream: stream.pipeThrough(
                  new TransformStream({
                    transform(chunk, controller) {
                      if (chunk.type === "finish") {
                        record(
                          parentId,
                          purpose,
                          tier,
                          llm.modelId(tier),
                          chunk.usage.inputTokens.total ?? 0,
                          chunk.usage.outputTokens.total ?? 0,
                          performance.now() - started,
                        );
                      }
                      controller.enqueue(chunk);
                    },
                  }),
                ),
              };
            },
          },
        });
      return { ...llm, model: metered };
    },
    totals() {
      return calls.reduce(
        (sum, c) => ({
          inputTokens: sum.inputTokens + c.inputTokens,
          outputTokens: sum.outputTokens + c.outputTokens,
          projectedCostUsd: sum.projectedCostUsd + c.projectedCostUsd,
          calls: sum.calls + 1,
        }),
        { inputTokens: 0, outputTokens: 0, projectedCostUsd: 0, calls: 0 },
      );
    },
  };
}

export async function saveLlmCalls(db: Db, conversationId: string | null, calls: LlmCallRecord[]) {
  if (calls.length === 0) return;
  await db.insert(llmCalls).values(calls.map((call) => ({ ...call, conversationId })));
}
