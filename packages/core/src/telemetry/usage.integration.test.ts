import { type Db, createDb, llmCalls, runMigrations } from "@app/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { type LlmCallRecord, saveLlmCalls } from "./usage";

const call = (purpose: LlmCallRecord["purpose"], tier: LlmCallRecord["tier"]): LlmCallRecord => ({
  purpose,
  tier,
  model: "qwen3:4b",
  inputTokens: 120,
  outputTokens: 30,
  latencyMs: 450,
  projectedCostUsd: 0.00027,
  priceModel: "claude-haiku-4-5",
});

describe("saveLlmCalls (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await db.execute(sql`TRUNCATE llm_calls`);
  });
  afterAll(() => close());

  it("stores one row per call, with no conversation when none is given", async () => {
    await saveLlmCalls(db, null, [call("guard", "small"), call("agent", "large")]);
    await saveLlmCalls(db, null, []);
    const rows = await db.select().from(llmCalls);
    expect(rows.map((r) => r.purpose).sort()).toEqual(["agent", "guard"]);
    expect(rows[0]).toMatchObject({ conversationId: null, inputTokens: 120, priceModel: "claude-haiku-4-5" });
  });
});
