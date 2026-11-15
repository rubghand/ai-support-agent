import { describe, expect, it } from "vitest";
import {
  type HistoryMessage,
  type MemoryOptions,
  SUMMARY_HEADER,
  planContext,
  toModelMessages,
} from "./context";
import { countTokens, truncateToTokens } from "./tokens";

const msg = (id: number, content: string, role: HistoryMessage["role"] = id % 2 ? "user" : "assistant") => ({
  id,
  role,
  content,
});

const none = { summary: null, summarizedThroughId: null };
const opts: MemoryOptions = { budgetTokens: 200, keepRecentMessages: 4, summaryMaxTokens: 50 };

describe("planContext", () => {
  it("keeps everything verbatim while the history fits the budget", () => {
    const history = [msg(1, "Hi"), msg(2, "Hello! How can I help?"), msg(3, "Is there a trial?")];
    expect(planContext(history, none, opts)).toEqual({ toSummarize: [], recent: history });
  });

  it("folds older messages and keeps the newest N verbatim once over budget", () => {
    // ~34 tokens each: 4 recent (136) + summary reserve (50) fits the 200 budget.
    const history = Array.from({ length: 10 }, (_, i) => msg(i + 1, "word ".repeat(30)));
    const plan = planContext(history, none, opts);
    expect(plan.recent.map((m) => m.id)).toEqual([7, 8, 9, 10]);
    expect(plan.toSummarize.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps fewer than N verbatim when they would not fit next to a full summary", () => {
    // ~84 tokens each: two would exceed 200 - 50.
    const history = Array.from({ length: 6 }, (_, i) => msg(i + 1, "word ".repeat(80)));
    const plan = planContext(history, none, opts);
    expect(plan.recent.map((m) => m.id)).toEqual([6]);
  });

  it("always keeps the newest message, even if it alone exceeds the budget", () => {
    const history = [msg(1, "short"), msg(2, "word ".repeat(400))];
    expect(planContext(history, none, opts).recent.map((m) => m.id)).toEqual([2]);
  });

  it("only considers messages after the stored summary", () => {
    const history = [msg(1, "old"), msg(2, "old"), msg(3, "new"), msg(4, "new")];
    const plan = planContext(history, { summary: "- earlier stuff", summarizedThroughId: 2 }, opts);
    expect(plan).toEqual({ toSummarize: [], recent: [history[2], history[3]] });
  });
});

describe("toModelMessages", () => {
  it("puts the summary first as framed context and strips stale citation markers", () => {
    const out = toModelMessages("- Asked about ORD-1042", [
      msg(5, "How long is the trial?", "user"),
      msg(6, "It lasts 14 days [S1]. You can upgrade anytime [S2].", "assistant"),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ role: "user" });
    expect(out[0]!.content).toContain(SUMMARY_HEADER);
    expect(out[0]!.content).toContain(
      "<conversation_summary>\n- Asked about ORD-1042\n</conversation_summary>",
    );
    expect(out[2]).toEqual({ role: "assistant", content: "It lasts 14 days. You can upgrade anytime." });
  });

  it("returns only the messages when there is no summary", () => {
    expect(toModelMessages(null, [msg(1, "hi", "user")])).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("tokens", () => {
  it("counts and truncates with the cl100k tokenizer", () => {
    expect(countTokens("hello world")).toBe(2);
    const long = "alpha beta gamma ".repeat(50);
    expect(countTokens(truncateToTokens(long, 10))).toBeLessThanOrEqual(10);
    expect(truncateToTokens("short", 10)).toBe("short");
  });
});
