import {
  type Db,
  conversations,
  createDb,
  generateSeedData,
  llmCalls,
  messageFeedback,
  runMigrations,
  seedDatabase,
  users,
} from "@app/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveAssistantMessage, saveUserMessage } from "../chat/store";
import { submitFeedback } from "../chat/feedback";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { createTracer, saveTrace } from "../telemetry/trace";
import { getConversationDetail, getDashboardStats, getTraceDetail, listConversations } from "./queries";

const answer = {
  answer: "Plans can change mid-cycle [S1].",
  kind: "answer" as const,
  guardFlags: [],
  citations: [],
  invalidCitations: [],
  confidence: "high" as const,
  needsHuman: false,
  grounded: true,
  model: "qwen3:14b",
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 10,
  attempts: 1,
};

describe("admin queries and feedback (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let maya: number;
  let lucas: number;
  let conversationId: string;
  let assistantId: number;
  let userMessageId: number;
  let traceId: string;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await seedDatabase(db, generateSeedData());
    await db.execute(sql`TRUNCATE traces, llm_calls CASCADE`);
    const idOf = async (email: string) =>
      (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
    maya = await idOf("maya@brightpixelstudio.example");
    lucas = await idOf("lucas@moreauconsulting.example");

    conversationId = crypto.randomUUID();
    await db.insert(conversations).values({ id: conversationId, userId: maya });
    userMessageId = await saveUserMessage(db, conversationId, "Can I change plans mid-cycle?");
    const tracer = createTracer({ name: "chat", conversationId, userId: String(maya) });
    await tracer.span("guard", async () => undefined);
    const trace = tracer.finish();
    traceId = trace.id;
    await saveTrace(db, trace);
    assistantId = await saveAssistantMessage(db, conversationId, answer, {
      traceId,
      projectedCostUsd: 0.002,
    });
    await db.insert(llmCalls).values({
      conversationId,
      purpose: "agent",
      tier: "large",
      model: "qwen3:14b",
      inputTokens: 100,
      outputTokens: 20,
      latencyMs: 900,
      projectedCostUsd: 0.0006,
      priceModel: "claude-sonnet-4-5",
    });
  });
  afterAll(() => close());

  describe("submitFeedback", () => {
    it("stores a rating and lets the user change it", async () => {
      expect(await submitFeedback(db, maya, assistantId, "up")).toEqual({ ok: true });
      expect(await submitFeedback(db, maya, assistantId, "down")).toEqual({ ok: true });
      const rows = await db.select().from(messageFeedback).where(eq(messageFeedback.messageId, assistantId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rating).toBe("down");
    });

    it("rejects another user's message, a user message and an unknown id the same way", async () => {
      const notFound = { ok: false, error: "not_found" };
      expect(await submitFeedback(db, lucas, assistantId, "up")).toEqual(notFound);
      expect(await submitFeedback(db, maya, userMessageId, "up")).toEqual(notFound);
      expect(await submitFeedback(db, maya, 999_999, "up")).toEqual(notFound);
    });
  });

  it("lists conversations with cost, feedback and the first question", async () => {
    const [row] = (await listConversations(db)).filter((c) => c.id === conversationId);
    expect(row).toMatchObject({
      userEmail: "maya@brightpixelstudio.example",
      messageCount: 2,
      thumbsDown: 1,
      thumbsUp: 0,
      firstQuestion: "Can I change plans mid-cycle?",
    });
    expect(row!.projectedCostUsd).toBeCloseTo(0.0006);
  });

  it("returns conversation detail with rating and trace id, and the trace spans", async () => {
    const detail = await getConversationDetail(db, conversationId);
    const assistant = detail!.messages.find((m) => m.role === "assistant")!;
    expect(assistant).toMatchObject({ rating: "down", traceId });
    expect(await getConversationDetail(db, crypto.randomUUID())).toBeNull();
    const trace = await getTraceDetail(db, traceId);
    expect(trace!.spans.map((s) => s.name)).toEqual(["guard"]);
  });

  it("aggregates dashboard stats with zero-filled days", async () => {
    const stats = await getDashboardStats(db, 7);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)).toMatchObject({ requests: 1, errors: 0 });
    expect(stats.daily[0]!.requests).toBe(0);
    expect(stats.totals).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20 });
    expect(stats.routing).toEqual([
      { tier: "large", model: "qwen3:14b", calls: 1, projectedCostUsd: expect.closeTo(0.0006) as number },
    ]);
    expect(stats.feedback).toEqual({ up: 0, down: 1 });
  });
});
