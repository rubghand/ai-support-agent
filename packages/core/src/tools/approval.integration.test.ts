import {
  type Db,
  auditLog,
  createDb,
  generateSeedData,
  messages,
  orders,
  pendingActions,
  refunds,
  runMigrations,
  seedDatabase,
  users,
} from "@app/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureConversation } from "../chat/store";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { type ToolContext, decideAction, executeTool, getActionForUser, requestRefund } from "./index";

describe("human-in-the-loop approvals (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let maya: ToolContext;
  let lucas: ToolContext;
  let admin: ToolContext;
  let conversationId: string;

  const asUser = async (email: string): Promise<ToolContext> => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return { db, identity: { userId: u!.id, role: u!.role, customerId: u!.customerId } };
  };

  const fileRefund = async (ctx: ToolContext, orderId: string) => {
    const result = await executeTool(ctx, "request_refund", { orderId, reason: "No longer needed" });
    if (!result.ok) throw new Error(`refund request failed: ${result.error.message}`);
    return (result.data as { actionId: number }).actionId;
  };

  const actionRow = async (id: number) =>
    (await db.select().from(pendingActions).where(eq(pendingActions.id, id)))[0]!;

  const auditTrail = async (id: number) =>
    (
      await db
        .select({ action: auditLog.action, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.targetType, "pending_action"), eq(auditLog.targetId, String(id))))
        .orderBy(asc(auditLog.id))
    ).map((a) => a.action);

  const chatMessages = () =>
    db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.id));

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await seedDatabase(db, generateSeedData());
    [maya, lucas, admin] = await Promise.all([
      asUser("maya@brightpixelstudio.example"),
      asUser("lucas@moreauconsulting.example"),
      asUser("admin@ledgerly.example"),
    ]);
    conversationId = (await ensureConversation(db, maya.identity.userId))!;
    maya = { ...maya, conversationId };
  });
  afterAll(() => close());

  it("never runs a high-risk tool's effect without an approval", async () => {
    const direct = await requestRefund.execute(maya, { orderId: "ORD-1042", reason: "Sneaky" });
    expect(direct).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("only lets staff decide", async () => {
    const id = await fileRefund(maya, "ORD-1042");
    expect(await decideAction(db, maya.identity, id, "approve")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await actionRow(id)).status).toBe("pending");
  });

  it("approve: refunds the order as the requester, audits every step, and notifies the customer", async () => {
    const [action] = await db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.subjectKey, "order:ORD-1042"));
    const result = await decideAction(db, admin.identity, action!.id, "approve");
    expect(result).toEqual({ ok: true, data: { actionId: action!.id, status: "executed" } });

    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, "ORD-1042"));
    expect(refund).toMatchObject({
      status: "approved",
      amountCents: 2900,
      customerId: "CUS-001",
      requestedByUserId: maya.identity.userId,
      decidedByUserId: admin.identity.userId,
    });
    const [order] = await db.select().from(orders).where(eq(orders.id, "ORD-1042"));
    expect(order!.status).toBe("refunded");

    expect(await actionRow(action!.id)).toMatchObject({
      status: "executed",
      decidedByUserId: admin.identity.userId,
      result: { ok: true, data: { refundId: refund!.id, status: "approved" } },
    });
    expect(await auditTrail(action!.id)).toEqual(["action.requested", "action.approved", "action.executed"]);
    const [issued] = await db.select().from(auditLog).where(eq(auditLog.action, "refund.issued"));
    expect(issued).toMatchObject({ actorUserId: admin.identity.userId, targetId: String(refund!.id) });

    const [notice] = await chatMessages();
    expect(notice).toMatchObject({
      role: "assistant",
      content:
        "Staff approved your request: Refund $29.00 for order ORD-1042 (Priority support). It has been processed.",
      metadata: { kind: "action_update", actionId: action!.id, status: "executed" },
    });
    expect(await getActionForUser(db, maya.identity.userId, action!.id)).toMatchObject({
      status: "executed",
      message: notice!.content,
    });
    // Another customer can't see it, exactly as if it didn't exist.
    expect(await getActionForUser(db, lucas.identity.userId, action!.id)).toBeNull();
    expect(await executeTool(maya, "lookup_order", { orderId: "ORD-1042" })).toMatchObject({
      data: { status: "refunded", refundRequest: { status: "approved" } },
    });
  });

  it("refuses to decide an action twice, or one that doesn't exist", async () => {
    const [action] = await db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.subjectKey, "order:ORD-1042"));
    expect(await decideAction(db, admin.identity, action!.id, "approve")).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(await decideAction(db, admin.identity, 999_999, "reject")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(await db.select().from(refunds).where(eq(refunds.orderId, "ORD-1042"))).toHaveLength(1);
  });

  it("reject: refunds nothing, relays the note, and allows a new request later", async () => {
    const id = await fileRefund(maya, "ORD-1069");
    const result = await decideAction(db, admin.identity, id, "reject", "  Outside the refund window.  ");
    expect(result).toMatchObject({ ok: true, data: { status: "rejected" } });
    expect(await actionRow(id)).toMatchObject({
      status: "rejected",
      decisionNote: "Outside the refund window.",
    });
    expect(await db.select().from(refunds).where(eq(refunds.orderId, "ORD-1069"))).toHaveLength(0);
    expect((await db.select().from(orders).where(eq(orders.id, "ORD-1069")))[0]!.status).toBe("paid");
    expect(await auditTrail(id)).toEqual(["action.requested", "action.rejected"]);
    const notice = (await chatMessages()).at(-1);
    expect(notice!.content).toBe(
      "Staff declined your request: Refund $39.00 for order ORD-1069 (Growth (monthly)). Note from our team: Outside the refund window.",
    );

    // Only open actions block the subject; a rejected one doesn't.
    await fileRefund(maya, "ORD-1069");
  });

  it("executes once when two staff approve the same action at the same time", async () => {
    const [open] = await db
      .select()
      .from(pendingActions)
      .where(and(eq(pendingActions.subjectKey, "order:ORD-1069"), eq(pendingActions.status, "pending")));
    const results = await Promise.all([
      decideAction(db, admin.identity, open!.id, "approve"),
      decideAction(db, admin.identity, open!.id, "approve"),
    ]);
    const outcomes = results.map((r) => (r.ok ? r.data.status : r.error.code)).sort();
    expect(outcomes).toEqual(["executed", "invalid_state"]);
    expect(await db.select().from(refunds).where(eq(refunds.orderId, "ORD-1069"))).toHaveLength(1);
  });

  it("re-checks on approval and fails cleanly if the order changed meanwhile", async () => {
    const id = await fileRefund(lucas, "ORD-1043");
    // E.g. a chargeback marked the payment failed after the customer asked.
    await db.update(orders).set({ status: "failed" }).where(eq(orders.id, "ORD-1043"));
    const result = await decideAction(db, admin.identity, id, "approve");
    expect(result).toMatchObject({ ok: true, data: { status: "failed" } });
    expect(await db.select().from(refunds).where(eq(refunds.orderId, "ORD-1043"))).toHaveLength(0);
    expect(await actionRow(id)).toMatchObject({
      status: "failed",
      result: { ok: false, error: { code: "invalid_state" } },
    });
    expect(await auditTrail(id)).toEqual(["action.requested", "action.approved", "action.failed"]);
    expect((await getActionForUser(db, lucas.identity.userId, id))!.message).toContain(
      "couldn't be completed",
    );
  });
});
