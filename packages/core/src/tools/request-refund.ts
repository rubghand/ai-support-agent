import { type Db, orders, refunds } from "@app/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NOT_FOUND, actingCustomerId, findAccessibleOrder, orderSubjectKey } from "./access";
import { writeAudit } from "./audit";
import { type Identity, defineTool, fail, ok } from "./types";
import { orderIdSchema } from "./lookup-order";

const formatAmount = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

async function refundableOrder(db: Db, identity: Identity, orderId: string) {
  const customerId = actingCustomerId(identity);
  if (!customerId) return fail("forbidden", "Only a customer account can request refunds.");
  const order = await findAccessibleOrder(db, identity, orderId);
  if (!order) return fail("not_found", NOT_FOUND);
  if (order.status !== "paid") {
    return fail("invalid_state", `Order ${order.id} is ${order.status}; only paid orders can be refunded.`);
  }
  return ok({ ...order, customerId });
}

class RefundConflict extends Error {}

/**
 * Refunds a paid order in full. High risk: the agent's call only files a request (`prepare`), and
 * `execute` runs once staff approve it, re-checking the order first.
 */
export const requestRefund = defineTool({
  name: "request_refund",
  description:
    "Request a full refund for one of the signed-in customer's paid orders. Nothing is refunded until staff approve the request; the result says it is pending approval.",
  risk: "high",
  input: z.object({
    orderId: orderIdSchema,
    reason: z.string().trim().min(3).max(500),
  }),
  output: z.object({
    refundId: z.number().int(),
    status: z.literal("approved"),
    amountCents: z.number().int(),
  }),
  async prepare({ db, identity }, { orderId }) {
    const order = await refundableOrder(db, identity, orderId);
    if (!order.ok) return order;
    const { id, item, amountCents, currency } = order.data;
    return ok({
      summary: `Refund ${formatAmount(amountCents, currency)} for order ${id} (${item})`,
      subjectKey: orderSubjectKey(id),
    });
  },
  async execute({ db, identity, approval }, { orderId, reason }) {
    if (!approval) return fail("forbidden", "Refunds need staff approval first.");
    const checked = await refundableOrder(db, identity, orderId);
    if (!checked.ok) return checked;
    const order = checked.data;

    let refundId: number;
    try {
      refundId = await db.transaction(async (tx) => {
        // The partial unique index and the paid->refunded transition both stop a second refund.
        const [refund] = await tx
          .insert(refunds)
          .values({
            orderId: order.id,
            customerId: order.customerId,
            amountCents: order.amountCents,
            reason,
            status: "approved",
            requestedByUserId: identity.userId,
            decidedByUserId: approval.approverUserId,
            decidedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: refunds.id });
        if (!refund) throw new RefundConflict();
        const updated = await tx
          .update(orders)
          .set({ status: "refunded" })
          .where(and(eq(orders.id, order.id), eq(orders.status, "paid")))
          .returning({ id: orders.id });
        if (updated.length === 0) throw new RefundConflict();
        await writeAudit(
          tx,
          { userId: approval.approverUserId },
          {
            action: "refund.issued",
            targetType: "refund",
            targetId: String(refund.id),
            details: { orderId: order.id, amountCents: order.amountCents, actionId: approval.actionId },
          },
        );
        return refund.id;
      });
    } catch (error) {
      if (error instanceof RefundConflict) {
        return fail("conflict", `Order ${order.id} has already been refunded.`);
      }
      throw error;
    }
    return ok({ refundId, status: "approved" as const, amountCents: order.amountCents });
  },
});
