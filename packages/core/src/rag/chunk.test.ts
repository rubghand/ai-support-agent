import { describe, expect, it } from "vitest";
import { chunkMarkdown, estimateTokens, splitSections } from "./chunk";

const words = (n: number, word = "lorem") => Array.from({ length: n }, () => word).join(" ");

describe("splitSections", () => {
  it("tracks the heading trail and drops heading-only sections", () => {
    const sections = splitSections(
      ["# Refunds", "", "## Monthly plans", "Not refundable.", "", "## Annual plans", "Prorated."].join("\n"),
    );
    expect(sections.map((s) => s.headingPath)).toEqual([
      ["Refunds", "Monthly plans"],
      ["Refunds", "Annual plans"],
    ]);
    expect(sections[0]?.text).toBe("## Monthly plans\nNot refundable.");
  });

  it("resets deeper headings when a shallower one starts", () => {
    const sections = splitSections("# A\n## B\n### C\ntext c\n## D\ntext d");
    expect(sections.map((s) => s.headingPath)).toEqual([
      ["A", "B", "C"],
      ["A", "D"],
    ]);
  });

  it("ignores '#' lines inside code fences", () => {
    const sections = splitSections("# API\n\n```\n# not a heading\ncurl ...\n```\n");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.text).toContain("# not a heading");
  });
});

describe("chunkMarkdown", () => {
  const options = { maxTokens: 100, minTokens: 20, overlapTokens: 15 };

  it("merges tiny sections into their neighbour", () => {
    const md = `# Doc\n\n## Short\nTiny.\n\n## Long\n${words(40)}`;
    const chunks = chunkMarkdown(md, options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe("Doc > Short");
    expect(chunks[0]?.content).toContain("## Long");
  });

  it("keeps normal-sized sections as separate chunks", () => {
    const md = `# Doc\n\n## One\n${words(30)}\n\n## Two\n${words(30)}`;
    const chunks = chunkMarkdown(md, options);
    expect(chunks.map((c) => c.headingPath)).toEqual(["Doc > One", "Doc > Two"]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it("splits oversized sections into overlapping windows within the limit", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => words(25, `p${i}`)).join("\n\n");
    const chunks = chunkMarkdown(`# Doc\n\n## Big\n${paragraphs}`, { ...options, overlapTokens: 25 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(options.maxTokens);
      expect(chunk.headingPath).toBe("Doc > Big");
    }
    const lastParagraphOfFirst = chunks[0]!.content.split("\n\n").at(-1)!;
    expect(chunks[1]!.content.startsWith(lastParagraphOfFirst)).toBe(true);
  });

  it("estimates tokens at roughly four characters each", () => {
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
  });
});
