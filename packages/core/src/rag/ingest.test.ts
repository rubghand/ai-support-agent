import { describe, expect, it } from "vitest";
import type { KbDocument } from "../kb/load";
import { DEFAULT_CHUNK_OPTIONS } from "./chunk";
import { buildEmbeddingText, documentHash, planIngest } from "./ingest";

const doc = (id: string, body = "Body"): KbDocument => ({
  id,
  title: id.toUpperCase(),
  url: `https://docs.ledgerly.example/${id}`,
  category: "faq",
  updated: new Date("2026-01-01"),
  filePath: `${id}.md`,
  body,
});

describe("planIngest", () => {
  const hashOf = (d: KbDocument) => `h:${d.body}`;

  it("separates changed, unchanged, and deleted documents", () => {
    const existing = new Map([
      ["a", "h:Body"],
      ["b", "h:old body"],
      ["gone", "h:x"],
    ]);
    const plan = planIngest([doc("a"), doc("b"), doc("new")], existing, hashOf);
    expect(plan.unchangedIds).toEqual(["a"]);
    expect(plan.changed.map((d) => d.id)).toEqual(["b", "new"]);
    expect(plan.deletedIds).toEqual(["gone"]);
  });
});

describe("documentHash", () => {
  it("changes when content, chunking options, or embedding model change", () => {
    const base = documentHash(doc("a"), DEFAULT_CHUNK_OPTIONS, "m1");
    expect(documentHash(doc("a"), DEFAULT_CHUNK_OPTIONS, "m1")).toBe(base);
    expect(documentHash(doc("a", "Edited"), DEFAULT_CHUNK_OPTIONS, "m1")).not.toBe(base);
    expect(documentHash(doc("a"), { ...DEFAULT_CHUNK_OPTIONS, maxTokens: 999 }, "m1")).not.toBe(base);
    expect(documentHash(doc("a"), DEFAULT_CHUNK_OPTIONS, "m2")).not.toBe(base);
  });
});

describe("buildEmbeddingText", () => {
  it("prefixes chunk content with title and heading trail", () => {
    expect(buildEmbeddingText("Refund policy", { headingPath: "Refund policy > Annual", content: "x" })).toBe(
      "Refund policy\nRefund policy > Annual\n\nx",
    );
  });
});
