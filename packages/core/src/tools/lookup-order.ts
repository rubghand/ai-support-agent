import { refunds } from "@app/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { NOT_FOUND, findAccessibleOrder } from "./access";
import { defineTool, fail, ok } from "./types";

export const orderIdSchema = z
  .string()
  .regex(/^ORD-\d{4,}$/, "Order ids look like ORD-1042")
  .describe("Order id, e.g. ORD-1042");

export const lookupOrder = defineTool({
  name: "lookup_order",
  description:
    "Look up one of the signed-in customer's orders by id: item, amount, status, and any refund request on it.",
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
      .object({ id: z.number().int(), status: z.enum(["requested", "approved", "rejected"]) })
      .nullable(),
  }),
  async execute({ db, identity }, { orderId }) {
    const order = await findAccessibleOrder(db, identity, orderId);
    if (!order) return fail("not_found", NOT_FOUND);
    const [refund] = await db
      .select({ id: refunds.id, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.orderId, order.id))
      .orderBy(desc(refunds.id))
      .limit(1);
    return ok({
      id: order.id,
      kind: order.kind,
      item: order.item,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      refundRequest: refund ?? null,
    });
  },
});
