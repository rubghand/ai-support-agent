import {
  type Db,
  conversations,
  createDb,
  generateSeedData,
  runMigrations,
  seedDatabase,
  users,
} from "@app/db";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureConversation, saveUserMessage } from "../chat/store";
import type { Llm } from "../llm/provider";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { loadConversationHistory } from "./history";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function summarizer(text: string | Error) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
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
  return { llm, calls: () => model.doGenerateCalls.length };
}

const options = { budgetTokens: 300, keepRecentMessages: 2, summaryMaxTokens: 80 };

describe("loadConversationHistory (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: number;

  /** Saves `count` long messages, each mentioning a different order, and returns their ids. */
  const fill = async (conversationId: string, count: number) => {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await saveUserMessage(
          db,
          conversationId,
          `Message ${i} about ORD-${1001 + i}. ${"filler ".repeat(40)}`,
        ),
      );
    }
    return ids;
  };

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await seedDatabase(db, generateSeedData());
    const [u] = await db.select().from(users).where(eq(users.email, "maya@brightpixelstudio.example"));
    userId = u!.id;
  });

  afterAll(() => close());

  it("returns short histories verbatim without calling the model", async () => {
    const id = (await ensureConversation(db, userId))!;
    await saveUserMessage(db, id, "Is there a free trial?");
    const current = await saveUserMessage(db, id, "And how long is it?");
    const { llm, calls } = summarizer("unused");
    const history = await loadConversationHistory({ db, llm }, id, { ...options, beforeId: current });
    expect(history.messages).toEqual([{ role: "user", content: "Is there a free trial?" }]);
    expect(calls()).toBe(0);
  });

  it("summarizes older messages once over budget, stores the summary, and reuses it next turn", async () => {
    const id = (await ensureConversation(db, userId))!;
    const ids = await fill(id, 8);
    const { llm, calls } = summarizer(JSON.stringify({ points: ["Customer asked about several orders."] }));

    const first = await loadConversationHistory({ db, llm }, id, options);
    expect(first.summarizedNow).toBeGreaterThan(0);
    expect(first.tokens).toBeLessThanOrEqual(options.budgetTokens);
    expect(first.summary).toContain("Customer asked about several orders.");
    // Every order id from folded messages survives, even though the model dropped them.
    for (let i = 0; i < first.summarizedNow; i++) expect(first.summary).toContain(`ORD-${1001 + i}`);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row!.summary).toBe(first.summary);
    expect(row!.summarizedThroughId).toBe(ids[first.summarizedNow - 1]);

    const second = await loadConversationHistory({ db, llm }, id, options);
    expect(calls()).toBe(1);
    expect(second.summarizedNow).toBe(0);
    expect(second.messages).toEqual(first.messages);
  });

  it("goes ahead with recent messages when summarizing fails, without storing anything", async () => {
    const id = (await ensureConversation(db, userId))!;
    await fill(id, 8);
    const { llm } = summarizer(new Error("model down"));
    const history = await loadConversationHistory({ db, llm }, id, options);
    expect(history.summarizedNow).toBe(0);
    expect(history.summary).toBeNull();
    expect(history.messages.length).toBeLessThanOrEqual(options.keepRecentMessages);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row!.summary).toBeNull();
  });
});
