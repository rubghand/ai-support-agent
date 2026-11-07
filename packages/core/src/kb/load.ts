import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

export const KB_BASE_URL = "https://docs.ledgerly.example";

export const frontmatterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  title: z.string().min(1),
  url: z.string().url().startsWith(KB_BASE_URL),
  category: z.enum([
    "getting-started",
    "invoices",
    "payments",
    "billing",
    "integrations",
    "api",
    "security",
    "troubleshooting",
    "faq",
  ]),
  updated: z.coerce.date(),
});

export type DocFrontmatter = z.infer<typeof frontmatterSchema>;

export interface KbDocument extends DocFrontmatter {
  filePath: string;
  body: string;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

export async function loadKnowledgeBase(dir: string): Promise<KbDocument[]> {
  const files = await listMarkdownFiles(dir);
  const docs: KbDocument[] = [];
  for (const filePath of files) {
    const { data, content } = matter(await readFile(filePath, "utf8"));
    const parsed = frontmatterSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`${filePath}: invalid frontmatter\n${z.prettifyError(parsed.error)}`);
    }
    docs.push({ ...parsed.data, filePath, body: content.trim() });
  }
  return docs;
}

const internalLinkPattern = new RegExp(`${KB_BASE_URL.replaceAll(".", "\\.")}[^)\\s]*`, "g");

/** Returns human-readable problems; an empty array means the knowledge base is consistent. */
export function validateKnowledgeBase(docs: KbDocument[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();

  for (const doc of docs) {
    if (ids.has(doc.id)) problems.push(`duplicate id "${doc.id}" in ${doc.filePath}`);
    if (urls.has(doc.url)) problems.push(`duplicate url "${doc.url}" in ${doc.filePath}`);
    ids.add(doc.id);
    urls.add(doc.url);
    if (doc.body.length === 0) problems.push(`${doc.filePath}: empty body`);
  }

  for (const doc of docs) {
    for (const link of doc.body.match(internalLinkPattern) ?? []) {
      if (!urls.has(link)) problems.push(`${doc.filePath}: broken link ${link}`);
    }
  }
  return problems;
}
