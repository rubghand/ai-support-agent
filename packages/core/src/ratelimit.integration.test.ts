import { type Db, createDb, runMigrations } from "@app/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consume } from "./ratelimit";
import { TEST_DATABASE_URL } from "./testing/fake-embedder";

describe("consume (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await db.execute(sql`TRUNCATE rate_limits`);
  });
  afterAll(() => close());

  it("never lets concurrent requests overspend the bucket", async () => {
    const config = { capacity: 5, refillPerSecond: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(db, "chat:test:burst", config)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.find((r) => !r.allowed)?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate buckets per key", async () => {
    const config = { capacity: 1, refillPerSecond: 0.001 };
    expect((await consume(db, "chat:test:a", config)).allowed).toBe(true);
    expect((await consume(db, "chat:test:a", config)).allowed).toBe(false);
    expect((await consume(db, "chat:test:b", config)).allowed).toBe(true);
  });
});
