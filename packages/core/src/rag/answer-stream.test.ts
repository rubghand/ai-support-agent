import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Llm } from "../llm/provider";
import { type AnswerStreamEvent, streamCitedAnswer } from "./answer-stream";
import type { RetrievedChunk } from "./search";

const chunks: RetrievedChunk[] = [
  {
    chunkId: "faq:0",
    documentId: "faq",
    title: "FAQ",
    url: "https://docs.ledgerly.example/faq",
    headingPath: "FAQ",
    content: "Yes, a 14-day trial.",
    updatedOn: new Date("2026-10-01"),
    score: 0.03,
    vectorRank: 1,
    keywordRank: 1,
  },
];

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function streamingLlm(json: string, pieces = 6): Llm {
  const size = Math.ceil(json.length / pieces);
  const deltas = Array.from({ length: pieces }, (_, i) => json.slice(i * size, (i + 1) * size)).filter(
    Boolean,
  );
  const parts: LanguageModelV4StreamPart[] = [
    { type: "text-start", id: "t" },
    ...deltas.map((delta): LanguageModelV4StreamPart => ({ type: "text-delta", id: "t", delta })),
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: parts }) }),
  });
  return { provider: "ollama", model: () => model, modelId: () => "mock", providerOptions: {} };
}

async function run(llm: Llm) {
  const events: AnswerStreamEvent[] = [];
  for await (const e of streamCitedAnswer(llm, "Is there a trial?", chunks)) events.push(e);
  return events;
}

describe("streamCitedAnswer", () => {
  it("streams answer text incrementally, then a final resolved answer", async () => {
    const json = JSON.stringify({
      answer: "Yes, there is a 14-day trial. [S1] [S9]",
      citations: ["S1"],
      confidence: "high",
      needsHuman: false,
    });
    const events = await run(streamingLlm(json));
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(1);
    const final = events.at(-1);
    expect(final?.type).toBe("final");
    if (final?.type !== "final") return;
    expect(final.answer.answer).toBe("Yes, there is a 14-day trial. [S1]");
    expect(final.answer.citations.map((c) => c.label)).toEqual(["S1"]);
    expect(final.answer.invalidCitations).toEqual(["S9"]);
    expect(final.answer.grounded).toBe(true);
    // Streamed text is the raw answer (markers for unknown sources are only removed in the final event).
    expect(tokens.map((t) => (t.type === "token" ? t.text : "")).join("")).toBe(
      "Yes, there is a 14-day trial. [S1] [S9]",
    );
  });
});
