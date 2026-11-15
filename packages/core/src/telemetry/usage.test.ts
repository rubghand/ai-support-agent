import { generateText, streamText } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Llm } from "../llm/provider";
import { createCallCollector, projectCostUsd } from "./usage";

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const llmOf = (model: MockLanguageModelV4): Llm => ({
  provider: "ollama",
  model: () => model,
  modelId: () => "mock-model",
  providerOptions: {},
});

describe("projectCostUsd", () => {
  it("prices small at haiku and large at sonnet list prices", () => {
    expect(projectCostUsd("small", 1_000_000, 1_000_000)).toBe(6);
    expect(projectCostUsd("large", 1_000_000, 1_000_000)).toBe(18);
    expect(projectCostUsd("large", 0, 0)).toBe(0);
  });
});

describe("createCallCollector", () => {
  it("records a blocking call with its purpose, tokens and projected cost", async () => {
    const collector = createCallCollector();
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "hi" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const metered = collector.meter(llmOf(model), "route");
    await generateText({ model: metered.model("small"), prompt: "hello" });
    expect(collector.calls).toHaveLength(1);
    expect(collector.calls[0]).toMatchObject({
      purpose: "route",
      tier: "small",
      model: "mock-model",
      inputTokens: 100,
      outputTokens: 20,
      priceModel: "claude-haiku-4-5",
    });
    expect(collector.calls[0]!.projectedCostUsd).toBeCloseTo(0.0002);
  });

  it("records a streamed call once, when the stream finishes", async () => {
    const collector = createCallCollector();
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "hi" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ],
        }),
      }),
    });
    const metered = collector.meter(llmOf(model), "agent");
    await streamText({ model: metered.model("large"), prompt: "hello" }).text;
    expect(collector.calls).toHaveLength(1);
    expect(collector.calls[0]).toMatchObject({ purpose: "agent", tier: "large", inputTokens: 100 });
    expect(collector.totals()).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20 });
  });
});
