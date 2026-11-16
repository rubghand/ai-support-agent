import { type Db, createDb, runMigrations, spans, traces } from "@app/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../testing/fake-embedder";
import { createTracer, saveTrace } from "./trace";

describe("saveTrace (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await db.execute(sql`TRUNCATE traces CASCADE`);
  });
  afterAll(() => close());

  it("stores the trace and nested spans, with top-level spans parentless", async () => {
    const tracer = createTracer({ name: "chat", userId: "1" });
    await tracer.span("retrieve", (id) => tracer.span("rerank", async () => undefined, { parentId: id }));
    tracer.add({ name: "tool:lookup_order", kind: "tool", startedAt: 1, endedAt: 9, status: "error" });
    const trace = tracer.finish();
    await saveTrace(db, trace);

    const [row] = await db.select().from(traces).where(eq(traces.id, trace.id));
    expect(row).toMatchObject({ name: "chat", status: "ok", userId: "1" });
    const rows = await db.select().from(spans).where(eq(spans.traceId, trace.id));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.retrieve!.parentId).toBeNull();
    expect(byName.rerank!.parentId).toBe(byName.retrieve!.id);
    expect(byName["tool:lookup_order"]).toMatchObject({ kind: "tool", status: "error" });
  });
});
