import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Llm } from "./provider";
import { routeByHeuristics, routeQuestion } from "./router";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function llmReplying(text: string | Error) {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls++;
      if (text instanceof Error) throw text;
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  const llm: Llm = { provider: "ollama", model: () => model, modelId: () => "mock", providerOptions: {} };
  return { llm, calls: () => calls };
}

describe("routeByHeuristics", () => {
  it.each([
    ["Where is my order ORD-1042?", "large"],
    ["I want a refund for my plan", "large"],
    ["How do I cancel my subscription?", "large"],
    ["How do I export invoices? And can I schedule it?", "large"],
    ["How do I add a teammate?", "small"],
    ["What is the file size limit for attachments?", "small"],
  ])("%s -> %s", (question, tier) => {
    expect(routeByHeuristics(question)?.tier).toBe(tier);
  });

  it("sends a follow-up to large only when there is history", () => {
    expect(routeByHeuristics("what about that one?", { hasHistory: true })?.tier).toBe("large");
    expect(routeByHeuristics("what about that one?")).toBeNull();
  });

  it("leaves unclear wording to the classifier", () => {
    expect(routeByHeuristics("Compare the Growth and Priority support plans for a team of 12")).toBeNull();
  });

  it("treats a long message as complex", () => {
    expect(routeByHeuristics("word ".repeat(45))?.tier).toBe("large");
  });
});

describe("routeQuestion", () => {
  it("does not call a model when the heuristics decide", async () => {
    const { llm, calls } = llmReplying("{}");
    const decision = await routeQuestion(llm, "How do I add a teammate?");
    expect(decision).toMatchObject({ tier: "small", source: "heuristic" });
    expect(calls()).toBe(0);
  });

  it("uses the classifier for ambiguous questions", async () => {
    const simple = llmReplying(JSON.stringify({ complexity: "simple", reason: "one article" }));
    expect(await routeQuestion(simple.llm, "Invoice numbering format options")).toMatchObject({
      tier: "small",
      source: "classifier",
    });
    const complex = llmReplying(JSON.stringify({ complexity: "complex", reason: "compares plans" }));
    expect((await routeQuestion(complex.llm, "Invoice numbering format options")).tier).toBe("large");
  });

  it("falls back to large when the classifier fails", async () => {
    const { llm } = llmReplying(new Error("ollama down"));
    expect(await routeQuestion(llm, "Invoice numbering format options")).toMatchObject({
      tier: "large",
      source: "classifier_error",
    });
  });
});
