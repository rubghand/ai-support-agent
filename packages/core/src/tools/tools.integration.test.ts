import {
  type Db,
  auditLog,
  createDb,
  generateSeedData,
  orders,
  pendingActions,
  refunds,
  runMigrations,
  seedDatabase,
  tickets,
  users,
} from "@app/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { type ToolContext, executeTool } from "./index";

describe("tools (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let maya: ToolContext;
  let lucas: ToolContext;
  let admin: ToolContext;

  const asUser = async (email: string): Promise<ToolContext> => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return { db, identity: { userId: u!.id, role: u!.role, customerId: u!.customerId } };
  };

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await seedDatabase(db, generateSeedData());
    [maya, lucas, admin] = await Promise.all([
      asUser("maya@brightpixelstudio.example"),
      asUser("lucas@moreauconsulting.example"),
      asUser("admin@ledgerly.example"),
    ]);
  });
  afterAll(() => close());

  describe("lookup_order", () => {
    it("returns the caller's own order", async () => {
      const result = await executeTool(maya, "lookup_order", { orderId: "ORD-1042" });
      expect(result).toMatchObject({
        ok: true,
        data: { id: "ORD-1042", item: "Priority support", status: "paid", refundRequest: null },
      });
    });

    it("rejects another customer's order exactly like a missing one, and audits it", async () => {
      const others = await executeTool(lucas, "lookup_order", { orderId: "ORD-1042" });
      const missing = await executeTool(lucas, "lookup_order", { orderId: "ORD-9999" });
      expect(others).toEqual(missing);
      expect(others).toMatchObject({ ok: false, error: { code: "not_found" } });
      const denied = await db.select().from(auditLog).where(eq(auditLog.action, "order.access_denied"));
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ actorUserId: lucas.identity.userId, targetId: "ORD-1042" });
    });

    it("lets an admin read any order", async () => {
      expect(await executeTool(admin, "lookup_order", { orderId: "ORD-1042" })).toMatchObject({ ok: true });
    });
  });

  describe("create_ticket and escalate_to_human", () => {
    it("files tickets for the session's customer, never one named by the model", async () => {
      const result = await executeTool(maya, "create_ticket", {
        subject: "Sync problem",
        body: "Invoices fail to sync.",
        customerId: "CUS-002", // extra field from a malicious model: ignored
      });
      expect(result).toMatchObject({ ok: true });
      const id = (result as { data: { ticketId: number } }).data.ticketId;
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
      expect(ticket).toMatchObject({ customerId: "CUS-001", priority: "normal", status: "open" });
    });

    it("escalates with high priority and an audit entry", async () => {
      const result = await executeTool(maya, "escalate_to_human", { reason: "Customer is very upset." });
      const id = (result as { data: { ticketId: number } }).data.ticketId;
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
      expect(ticket).toMatchObject({ priority: "high" });
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, String(id)));
      expect(audit.map((a) => a.action)).toContain("conversation.escalated");
    });

    it("refuses admins, who have no customer to act for", async () => {
      expect(await executeTool(admin, "create_ticket", { subject: "x y z", body: "x y z" })).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    });
  });

  describe("request_refund", () => {
    it("files a request for staff approval without refunding anything, and audits it", async () => {
      const result = await executeTool(maya, "request_refund", { orderId: "ORD-1042", reason: "Not needed" });
      expect(result).toMatchObject({
        ok: true,
        data: { status: "pending_approval", summary: "Refund $29.00 for order ORD-1042 (Priority support)" },
      });
      const [order] = await db.select().from(orders).where(eq(orders.id, "ORD-1042"));
      expect(order!.status).toBe("paid");
      expect(await db.select().from(refunds)).toHaveLength(0);
      const [action] = await db.select().from(pendingActions);
      expect(action).toMatchObject({
        toolName: "request_refund",
        subjectKey: "order:ORD-1042",
        status: "pending",
        requestedByUserId: maya.identity.userId,
        args: { orderId: "ORD-1042", reason: "Not needed" },
      });
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, "action.requested"));
      expect(audit).toHaveLength(1);
      const lookup = await executeTool(maya, "lookup_order", { orderId: "ORD-1042" });
      expect(lookup).toMatchObject({
        data: { refundRequest: { id: action!.id, status: "pending_approval" } },
      });
    });

    it("rejects a second request for the same order", async () => {
      expect(
        await executeTool(maya, "request_refund", { orderId: "ORD-1042", reason: "Again" }),
      ).toMatchObject({
        ok: false,
        error: { code: "conflict" },
      });
    });

    it("rejects other customers' orders and non-paid orders", async () => {
      expect(
        await executeTool(lucas, "request_refund", { orderId: "ORD-1042", reason: "Steal" }),
      ).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
      const failedOwn = await executeTool(await asUser("aisha@bellobakery.example"), "request_refund", {
        orderId: "ORD-1044",
        reason: "Card failed",
      });
      expect(failedOwn).toMatchObject({ ok: false, error: { code: "invalid_state" } });
      const refundedAlready = await executeTool(maya, "request_refund", {
        orderId: "ORD-1045",
        reason: "Twice",
      });
      expect(refundedAlready).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    });

    it("lets exactly one of many concurrent requests through", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          executeTool(lucas, "request_refund", { orderId: "ORD-1043", reason: "Race" }),
        ),
      );
      const outcomes = results.map((r) => (r.ok ? "ok" : r.error.code)).sort();
      expect(outcomes).toEqual([
        "conflict",
        "conflict",
        "conflict",
        "conflict",
        "conflict",
        "conflict",
        "conflict",
        "ok",
      ]);
      const rows = await db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.subjectKey, "order:ORD-1043"));
      expect(rows).toHaveLength(1);
      const audit = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(and(eq(auditLog.targetType, "pending_action"), eq(auditLog.targetId, String(rows[0]!.id))));
      expect(audit[0]!.n).toBe(1);
    });
  });
});
