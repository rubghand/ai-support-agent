import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Llm } from "../llm/provider";
import {
  type HistoryMessage,
  type MemoryOptions,
  messageTokens,
  planContext,
  toModelMessages,
} from "./context";
import { keyFacts, summarizeConversation, withKeyFacts } from "./summarize";
import { countTokens } from "./tokens";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const points = (...items: string[]) => JSON.stringify({ points: items });

/** A summarizer that returns `reply(prompt)`; records every prompt it was given. */
function mockLlm(reply: (prompt: string) => string) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      prompts.push(text);
      return {
        content: [{ type: "text", text: reply(text) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  const llm: Llm = {
    provider: "ollama",
    model: (tier) => {
      if (tier !== "small") throw new Error("summaries must use the small model");
      return model;
    },
    modelId: () => "mock",
    providerOptions: {},
  };
  return { llm, prompts };
}

describe("keyFacts / withKeyFacts", () => {
  it("extracts order ids and ticket numbers", () => {
    expect(
      keyFacts(["Check ORD-1042 and ORD-1043", "I opened ticket #57 for you.", "Ticket 9 is closed"]),
    ).toEqual(["ORD-1042", "ORD-1043", "ticket #57", "ticket #9"]);
  });

  it("appends only the identifiers the summary lost", () => {
    const out = withKeyFacts("- Customer asked about ORD-1042.", ["ORD-1042 and ORD-1044", "ticket #3"]);
    expect(out).toBe("- Customer asked about ORD-1042.\n- Also referenced earlier: ORD-1044, ticket #3");
    expect(withKeyFacts("- ORD-1042", ["ORD-1042"])).toBe("- ORD-1042");
  });
});

describe("summarizeConversation", () => {
  it("sends the previous summary and the transcript to the small model", async () => {
    const { llm, prompts } = mockLlm(() => points("Wants a refund for ORD-1042."));
    const summary = await summarizeConversation(llm, {
      previousSummary: "- Customer on the Growth plan.",
      messages: [
        { id: 1, role: "user", content: "Refund ORD-1042 please" },
        { id: 2, role: "assistant", content: "Filed, pending staff review." },
      ],
      maxTokens: 100,
    });
    expect(summary).toBe("- Wants a refund for ORD-1042.");
    expect(prompts[0]).toContain("Customer on the Growth plan.");
    expect(prompts[0]).toContain("Customer: Refund ORD-1042 please");
    expect(prompts[0]).toContain("Agent: Filed, pending staff review.");
  });

  it("caps the summary length but keeps the identifiers line", async () => {
    const { llm } = mockLlm(() => points("blah ".repeat(500)));
    const summary = await summarizeConversation(llm, {
      previousSummary: null,
      messages: [{ id: 1, role: "user", content: "about ORD-1077" }],
      maxTokens: 40,
    });
    expect(countTokens(summary)).toBeLessThanOrEqual(40);
    expect(summary).toContain("ORD-1077");
  });

  it("keeps the previous summary if the model returns nothing", async () => {
    const { llm } = mockLlm(() => points());
    const summary = await summarizeConversation(llm, {
      previousSummary: "- Asked about ORD-1042.",
      messages: [{ id: 3, role: "user", content: "thanks" }],
      maxTokens: 100,
    });
    expect(summary).toBe("- Asked about ORD-1042.");
  });
});

describe("long synthetic chat", () => {
  it("stays under the token budget every turn and never forgets an order id", async () => {
    const options: MemoryOptions = { budgetTokens: 600, keepRecentMessages: 4, summaryMaxTokens: 150 };
    // A forgetful summarizer: generic prose that drops every identifier.
    const { llm } = mockLlm(() => points("The customer asked several billing questions and got answers."));
    const history: HistoryMessage[] = [];
    let stored = { summary: null as string | null, summarizedThroughId: null as number | null };
    let summaries = 0;

    for (let turn = 0; turn < 30; turn++) {
      const order = `ORD-${1001 + turn}`;
      history.push(
        {
          id: history.length + 1,
          role: "user",
          content: `What is the status of ${order}? ${"Some detail. ".repeat(10)}`,
        },
        {
          id: history.length + 2,
          role: "assistant",
          content: `${order} is paid. ${"More detail here. ".repeat(10)}`,
        },
      );

      const plan = planContext(history, stored, options);
      if (plan.toSummarize.length > 0) {
        const summary = await summarizeConversation(llm, {
          previousSummary: stored.summary,
          messages: plan.toSummarize,
          maxTokens: options.summaryMaxTokens,
        });
        stored = { summary, summarizedThroughId: plan.toSummarize.at(-1)!.id };
        summaries++;
      }
      const tokens =
        (stored.summary ? countTokens(stored.summary) : 0) +
        plan.recent.reduce((n, m) => n + messageTokens(m), 0);
      expect(tokens, `turn ${turn}`).toBeLessThanOrEqual(options.budgetTokens);

      const context = JSON.stringify(toModelMessages(stored.summary, plan.recent));
      for (let t = 0; t <= turn; t++) expect(context, `turn ${turn}`).toContain(`ORD-${1001 + t}`);
    }
    expect(summaries).toBeGreaterThan(5);
  });
});
