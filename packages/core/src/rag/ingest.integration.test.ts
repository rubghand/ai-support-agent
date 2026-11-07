import { createHash } from "node:crypto";
import { type Db, chunks, createDb, documents, runMigrations } from "@app/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KbDocument } from "../kb/load";
import type { Embedder } from "./embed";
import { ingestKnowledgeBase } from "./ingest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://agent:agent@localhost:5455/agent_test";

/** Deterministic fake embedder: no model download, counts how many texts it embedded. */
function fakeEmbedder(): Embedder & { calls: number } {
  const vectorFor = (text: string) => {
    const bytes = createHash("sha256").update(text).digest();
    const raw = Array.from({ length: 384 }, (_, i) => bytes[i % bytes.length]! - 128);
    const norm = Math.hypot(...raw);
    return raw.map((v) => v / norm);
  };
  const embedder = {
    model: "fake",
    dimensions: 384,
    calls: 0,
    embedDocuments: async (texts: string[]) => {
      embedder.calls += texts.length;
      return texts.map(vectorFor);
    },
    embedQuery: async (text: string) => vectorFor(text),
  };
  return embedder;
}

const doc = (id: string, body: string): KbDocument => ({
  id,
  title: id,
  url: `https://docs.ledgerly.example/${id}`,
  category: "faq",
  updated: new Date("2026-01-01"),
  filePath: `${id}.md`,
  body,
});

const longSection = (topic: string) => `## ${topic}\n${`${topic} details. `.repeat(40)}`;

describe("ingestKnowledgeBase (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await db.execute(sql`TRUNCATE documents CASCADE`);
  });

  afterAll(() => close());

  it("writes chunks, skips unchanged docs, and reuses embeddings", async () => {
    const embedder = fakeEmbedder();
    const kb = [doc("alpha", `# Alpha\n\n${longSection("Refunds")}\n\n${longSection("Payouts")}`)];

    const first = await ingestKnowledgeBase(db, kb, embedder);
    expect(first).toMatchObject({ changed: 1, unchanged: 0, chunksWritten: 2, embedded: 2 });

    const second = await ingestKnowledgeBase(db, kb, embedder);
    expect(second).toMatchObject({ changed: 0, unchanged: 1, chunksWritten: 0, embedded: 0 });

    const edited = [doc("alpha", `# Alpha\n\n${longSection("Refunds")}\n\n${longSection("Taxes")}`)];
    const third = await ingestKnowledgeBase(db, edited, embedder);
    expect(third).toMatchObject({ changed: 1, embedded: 1, reusedEmbeddings: 1 });
    expect(embedder.calls).toBe(3);

    const rows = await db.select({ id: chunks.id, headingPath: chunks.headingPath }).from(chunks);
    expect(rows.map((r) => r.headingPath).sort()).toEqual(["Alpha > Refunds", "Alpha > Taxes"]);
  });

  it("populates the generated full-text column and deletes removed docs", async () => {
    const [match] = await db
      .execute<{ id: string }>(
        sql`SELECT id FROM chunks WHERE tsv @@ websearch_to_tsquery('english', 'taxes') LIMIT 1`,
      )
      .then((r) => r.rows);
    expect(match?.id).toMatch(/^alpha:/);

    const stats = await ingestKnowledgeBase(db, [], fakeEmbedder());
    expect(stats.deleted).toBe(1);
    expect(await db.$count(documents)).toBe(0);
    expect(await db.$count(chunks)).toBe(0);
  });
});
