import { refunds } from "@app/db";
import { z } from "zod";
import { NOT_FOUND, actingCustomerId, findAccessibleOrder } from "./access";
import { writeAudit } from "./audit";
import { defineTool, fail, ok } from "./types";
import { orderIdSchema } from "./lookup-order";

/**
 * Records a refund *request* for the full order amount. It never pays anything out: a human must
 * approve it first (Phase 12), which is why this tool is declared high risk.
 */
export const requestRefund = defineTool({
  name: "request_refund",
  description:
    "Request a refund for one of the signed-in customer's paid orders. This only files a request for staff review; it does not refund anything.",
  risk: "high",
  input: z.object({
    orderId: orderIdSchema,
    reason: z.string().trim().min(3).max(500),
  }),
  output: z.object({
    refundId: z.number().int(),
    status: z.literal("requested"),
    amountCents: z.number().int(),
  }),
  async execute({ db, identity }, { orderId, reason }) {
    const customerId = actingCustomerId(identity);
    if (!customerId) return fail("forbidden", "Only a customer account can request refunds.");
    const order = await findAccessibleOrder(db, identity, orderId);
    if (!order) return fail("not_found", NOT_FOUND);
    if (order.status !== "paid") {
      return fail("invalid_state", `Order ${order.id} is ${order.status}; only paid orders can be refunded.`);
    }

    const created = await db.transaction(async (tx) => {
      // The partial unique index decides races: a second live request for the order inserts nothing.
      const [refund] = await tx
        .insert(refunds)
        .values({
          orderId: order.id,
          customerId,
          amountCents: order.amountCents,
          reason,
          requestedByUserId: identity.userId,
        })
        .onConflictDoNothing()
        .returning({ id: refunds.id });
      if (!refund) return null;
      await writeAudit(tx, identity, {
        action: "refund.requested",
        targetType: "refund",
        targetId: String(refund.id),
        details: { orderId: order.id, amountCents: order.amountCents },
      });
      return refund.id;
    });
    if (created === null) {
      return fail("conflict", `Order ${order.id} already has a refund request in progress or approved.`);
    }
    return ok({ refundId: created, status: "requested" as const, amountCents: order.amountCents });
  },
});
