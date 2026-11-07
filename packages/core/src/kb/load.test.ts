import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type KbDocument, loadKnowledgeBase, validateKnowledgeBase } from "./load";

function doc(overrides: Partial<KbDocument>): KbDocument {
  return {
    id: "a",
    title: "A",
    url: "https://docs.ledgerly.example/a",
    category: "faq",
    updated: new Date("2026-01-01"),
    filePath: "a.md",
    body: "Body",
    ...overrides,
  };
}

describe("loadKnowledgeBase", () => {
  it("parses frontmatter from nested markdown files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kb-"));
    await mkdir(path.join(dir, "billing"));
    await writeFile(
      path.join(dir, "billing", "refunds.md"),
      "---\nid: refunds\ntitle: Refunds\nurl: https://docs.ledgerly.example/billing/refunds\ncategory: billing\nupdated: 2026-10-01\n---\n\n# Refunds\n",
    );

    const [loaded] = await loadKnowledgeBase(dir);
    expect(loaded?.id).toBe("refunds");
    expect(loaded?.updated.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(loaded?.body).toBe("# Refunds");
  });

  it("rejects invalid frontmatter with the file path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kb-"));
    await writeFile(path.join(dir, "bad.md"), "---\nid: Bad Id\n---\nx");
    await expect(loadKnowledgeBase(dir)).rejects.toThrow(/bad\.md: invalid frontmatter/);
  });
});

describe("validateKnowledgeBase", () => {
  it("accepts a consistent set of docs", () => {
    const b = doc({
      id: "b",
      url: "https://docs.ledgerly.example/b",
      body: "See https://docs.ledgerly.example/a",
    });
    expect(validateKnowledgeBase([doc({}), b])).toEqual([]);
  });

  it("reports duplicate ids and broken internal links", () => {
    const problems = validateKnowledgeBase([
      doc({}),
      doc({ url: "https://docs.ledgerly.example/other", body: "[x](https://docs.ledgerly.example/missing)" }),
    ]);
    expect(problems).toEqual([
      'duplicate id "a" in a.md',
      "a.md: broken link https://docs.ledgerly.example/missing",
    ]);
  });
});
