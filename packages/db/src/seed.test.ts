import { describe, expect, it } from "vitest";
import { ADDON_PRICES, PLAN_PRICES, generateSeedData } from "./seed";

describe("generateSeedData", () => {
  const data = generateSeedData();

  it("is deterministic", () => {
    expect(generateSeedData()).toEqual(data);
  });

  it("produces the expected volumes with unique ids", () => {
    expect(data.customers).toHaveLength(20);
    expect(data.orders).toHaveLength(100);
    expect(new Set(data.orders.map((o) => o.id)).size).toBe(100);
    expect(new Set(data.customers.map((c) => c.email)).size).toBe(20);
  });

  it("keeps the fixture orders that evals rely on", () => {
    const order = data.orders.find((o) => o.id === "ORD-1042");
    expect(order).toMatchObject({ customerId: "CUS-001", item: "Priority support", status: "paid" });
  });

  it("only references existing customers and documented prices", () => {
    const customerIds = new Set(data.customers.map((c) => c.id));
    const validPrices = new Set<number>([
      ...Object.values(ADDON_PRICES),
      ...Object.values(PLAN_PRICES).flatMap((p) => [p.monthly, p.annual]),
    ]);
    for (const order of data.orders) {
      expect(customerIds.has(order.customerId)).toBe(true);
      expect(validPrices.has(order.amountCents)).toBe(true);
    }
    for (const ticket of data.tickets) {
      expect(customerIds.has(ticket.customerId)).toBe(true);
    }
  });
});
