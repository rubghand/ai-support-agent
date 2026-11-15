import { type Db, orders } from "@app/db";
import { eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { Identity } from "./types";

export const NOT_FOUND = "No order with that id was found on your account.";

/**
 * Loads an order only if the caller may see it. A missing order and someone else's order are
 * indistinguishable to the caller (same result), so ids can't be probed; the attempt is audited.
 */
export async function findAccessibleOrder(db: Db, identity: Identity, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const allowed = identity.role === "admin" || order.customerId === identity.customerId;
  if (!allowed) {
    await writeAudit(db, identity, {
      action: "order.access_denied",
      targetType: "order",
      targetId: orderId,
    });
    return null;
  }
  return order;
}

/** The customer an action is performed for. Admins act on a customer explicitly, never implicitly. */
export function actingCustomerId(identity: Identity): string | null {
  return identity.role === "customer" ? identity.customerId : null;
}

/** `pending_actions.subject_key` of a refund request for an order. */
export const orderSubjectKey = (orderId: string) => `order:${orderId}`;
