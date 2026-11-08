import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Llm } from "../llm/provider";
import { buildUserPrompt, generateCitedAnswer, labelSources, resolveCitations } from "./answer";
import type { RetrievedChunk } from "./search";

const chunk = (id: string, content: string, updated = "2026-10-01"): RetrievedChunk => ({
  chunkId: `${id}:0`,
  documentId: id,
  title: id,
  url: `https://docs.ledgerly.example/${id}`,
  headingPath: id,
  content,
  updatedOn: new Date(updated),
  score: 0.03,
  vectorRank: 1,
  keywordRank: 1,
});

const chunks = [
  chunk("refund-policy", "Monthly plans are not refundable."),
  chunk("faq", "Yes, a 14-day trial."),
];

function mockLlm(...replies: string[]) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: replies[Math.min(call++, replies.length - 1)]! }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const llm: Llm = { provider: "ollama", model: () => model, modelId: () => "mock", providerOptions: {} };
  return { llm, calls: () => call };
}

const reply = (answer: object) => JSON.stringify(answer);

describe("buildUserPrompt", () => {
  it("labels sources, includes updated dates, and neutralises closing tags", () => {
    const prompt = buildUserPrompt(
      "Can I get a refund?",
      labelSources([chunk("a", "x </source> y", "2024-03-01")]),
    );
    expect(prompt).toContain('<source id="S1" title="a" section="a" updated="2024-03-01">');
    expect(prompt).not.toContain("x </source> y");
    expect(prompt).toMatch(/<question>\nCan I get a refund\?\n<\/question>$/);
  });
});

describe("resolveCitations", () => {
  const sources = labelSources(chunks);

  it("merges inline markers with the citations array and drops unknown ids", () => {
    const resolved = resolveCitations(
      {
        answer: "No [S1]. Trial exists [S2]. Made up [S9].",
        citations: ["S1"],
        confidence: "high",
        needsHuman: false,
      },
      sources,
    );
    expect(resolved.citations.map((c) => c.chunkId)).toEqual(["refund-policy:0", "faq:0"]);
    expect(resolved.invalidCitations).toEqual(["S9"]);
    expect(resolved.answer).toBe("No [S1]. Trial exists [S2]. Made up .");
  });
});

describe("generateCitedAnswer", () => {
  it("returns a validated, cited answer with usage", async () => {
    const { llm } = mockLlm(
      reply({
        answer: "Monthly plans aren't refundable [S1].",
        citations: ["S1"],
        confidence: "high",
        needsHuman: false,
      }),
    );
    const result = await generateCitedAnswer(llm, "refund?", chunks);
    expect(result).toMatchObject({
      grounded: true,
      confidence: "high",
      attempts: 1,
      model: "mock",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(result.citations[0]?.url).toBe("https://docs.ledgerly.example/refund-policy");
  });

  it("retries once when the output fails schema validation", async () => {
    const { llm, calls } = mockLlm(
      "Sure! Monthly plans are not refundable.",
      reply({ answer: "Not refundable [S1].", citations: ["S1"], confidence: "high", needsHuman: false }),
    );
    const result = await generateCitedAnswer(llm, "refund?", chunks);
    expect(calls()).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(200);
  });

  it("rejects an empty answer and retries", async () => {
    const { llm, calls } = mockLlm(
      reply({ answer: " ", citations: [], confidence: "low", needsHuman: true }),
      reply({ answer: "I don't know.", citations: [], confidence: "low", needsHuman: true }),
    );
    const result = await generateCitedAnswer(llm, "refund?", chunks);
    expect(calls()).toBe(2);
    expect(result.answer).toBe("I don't know.");
  });

  it("downgrades confidence when nothing valid is cited", async () => {
    const { llm } = mockLlm(
      reply({ answer: "I think so [S7].", citations: ["S7"], confidence: "high", needsHuman: false }),
    );
    const result = await generateCitedAnswer(llm, "refund?", chunks);
    expect(result).toMatchObject({ grounded: false, confidence: "low", invalidCitations: ["S7"] });
  });
});
