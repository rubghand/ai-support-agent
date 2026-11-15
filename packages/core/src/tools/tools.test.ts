import type { Db } from "@app/db";
import { describe, expect, it } from "vitest";
import { executeTool, getTool, tools } from "./index";

// Input validation happens before any database access, so no DB is needed here.
const ctx = { db: {} as Db, identity: { userId: 1, role: "customer" as const, customerId: "CUS-001" } };

describe("tool registry", () => {
  it("exposes the four tools with unique names", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "lookup_order",
      "create_ticket",
      "escalate_to_human",
      "request_refund",
    ]);
  });

  it("declares only the refund as high risk", () => {
    expect(tools.filter((t) => t.risk === "high").map((t) => t.name)).toEqual(["request_refund"]);
  });

  it("never accepts an identity or customer id from the model", () => {
    for (const tool of tools) {
      const accepted = Object.keys((tool.input as unknown as { shape: Record<string, unknown> }).shape);
      expect(accepted).not.toContain("customerId");
      expect(accepted).not.toContain("userId");
    }
  });

  it("finds tools by name", () => {
    expect(getTool("request_refund")?.risk).toBe("high");
    expect(getTool("nope")).toBeUndefined();
  });
});

describe("executeTool validation", () => {
  it("rejects malformed order ids before touching the database", async () => {
    const result = await executeTool(ctx, "lookup_order", { orderId: "1042; DROP TABLE orders" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("rejects missing fields and unknown tools", async () => {
    expect(await executeTool(ctx, "request_refund", { orderId: "ORD-1042" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(await executeTool(ctx, "delete_everything", {})).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
