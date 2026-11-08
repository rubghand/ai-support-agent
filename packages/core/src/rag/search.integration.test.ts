import { type Db, createDb, runMigrations } from "@app/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KbDocument } from "../kb/load";
import { TEST_DATABASE_URL, fakeEmbedder } from "../testing/fake-embedder";
import { ingestKnowledgeBase } from "./ingest";
import { retrieve } from "./search";

const doc = (id: string, title: string, body: string): KbDocument => ({
  id,
  title,
  url: `https://docs.ledgerly.example/${id}`,
  category: "payments",
  updated: new Date("2026-01-01"),
  filePath: `${id}.md`,
  body,
});

const filler = (topic: string) => `${topic} information for customers. `.repeat(12);

describe("retrieve (Postgres)", () => {
  const embedder = fakeEmbedder();
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await db.execute(sql`TRUNCATE documents CASCADE`);
    await ingestKnowledgeBase(
      db,
      [
        doc(
          "methods",
          "Payment methods",
          `# Payment methods\n\n## SEPA Direct Debit\n${filler("SEPA mandate")}`,
        ),
        doc("payouts", "Payouts", `# Payouts\n\n## Schedule\n${filler("Daily payout schedule")}`),
        doc("refunds", "Refund policy", `# Refund policy\n\n## Annual plans\n${filler("Prorated refund")}`),
      ],
      embedder,
    );
  });

  afterAll(() => close());

  it("finds exact terms with keyword search, even inside a natural-language question", async () => {
    const results = await retrieve(db, embedder, "how long does a SEPA payment take?", { mode: "keyword" });
    expect(results[0]).toMatchObject({ documentId: "methods", keywordRank: 1, vectorRank: null });
    expect(results[0]?.url).toBe("https://docs.ledgerly.example/methods");
  });

  it("returns nothing from keyword search for a query made only of stop words", async () => {
    expect(await retrieve(db, embedder, "the and of", { mode: "keyword" })).toEqual([]);
  });

  it("fuses both retrievers in hybrid mode and respects k", async () => {
    const results = await retrieve(db, embedder, "refund for annual plans", { k: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.documentId).toBe("refunds");
    expect(results[0]?.keywordRank).toBe(1);
    expect(results[0]?.vectorRank).not.toBeNull();
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });
});
