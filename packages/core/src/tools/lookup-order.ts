import { pendingActions } from "@app/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { NOT_FOUND, findAccessibleOrder, orderSubjectKey } from "./access";
import { defineTool, fail, ok } from "./types";

export const orderIdSchema = z
  .string()
  .regex(/^ORD-\d{4,}$/, "Order ids look like ORD-1042")
  .describe("Order id, e.g. ORD-1042");

const REFUND_REQUEST_STATUS = {
  pending: "pending_approval",
  approved: "pending_approval",
  executed: "approved",
  rejected: "rejected",
  failed: "failed",
} as const;

export const lookupOrder = defineTool({
  name: "lookup_order",
  description:
    "Look up one of the signed-in customer's orders by id: item, amount, status, and the latest refund request on it.",
  risk: "low",
  input: z.object({ orderId: orderIdSchema }),
  output: z.object({
    id: z.string(),
    kind: z.enum(["plan", "addon"]),
    item: z.string(),
    amountCents: z.number().int(),
    currency: z.string(),
    status: z.enum(["paid", "pending", "failed", "refunded"]),
    createdAt: z.string(),
    refundRequest: z
      .object({
        id: z.number().int(),
        status: z.enum(["pending_approval", "approved", "rejected", "failed"]),
      })
      .nullable(),
  }),
  async execute({ db, identity }, { orderId }) {
    const order = await findAccessibleOrder(db, identity, orderId);
    if (!order) return fail("not_found", NOT_FOUND);
    const [request] = await db
      .select({ id: pendingActions.id, status: pendingActions.status })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.toolName, "request_refund"),
          eq(pendingActions.subjectKey, orderSubjectKey(order.id)),
        ),
      )
      .orderBy(desc(pendingActions.id))
      .limit(1);
    return ok({
      id: order.id,
      kind: order.kind,
      item: order.item,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      refundRequest: request ? { id: request.id, status: REFUND_REQUEST_STATUS[request.status] } : null,
    });
  },
});
