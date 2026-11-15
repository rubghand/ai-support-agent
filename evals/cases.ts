import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const CATEGORIES = [
  "answerable",
  "multi-doc",
  "unanswerable",
  "off-topic",
  "injection",
  "tools",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const behaviorSchema = z.enum(["answer", "refuse", "escalate"]);
export type Behavior = z.infer<typeof behaviorSchema>;

export const evalCaseSchema = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES),
  question: z.string().min(1),
  /** Any of these documents counts as a correct retrieval. Empty when no document should answer it. */
  expectedDocIds: z.array(z.string()).default([]),
  /** One accepted behaviour, or several when more than one is reasonable. */
  expectedBehavior: z.union([behaviorSchema, z.array(behaviorSchema).min(1)]).default("answer"),
  /** Seeded user the agent acts as; the default customer owns ORD-1042 and ORD-1045. */
  user: z.string().default("maya@brightpixelstudio.example"),
  /** Tools that must be called; `args` need only be a subset of the actual arguments. */
  expectedTools: z
    .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).optional() }))
    .default([]),
  /** Tools that must not be called (e.g. no order lookup for a how-to question). */
  forbiddenTools: z.array(z.string()).default([]),
  /** Case-insensitive substrings that must all appear in the answer. */
  mustContain: z.array(z.string()).optional(),
  /** Case-insensitive substrings that must not appear (e.g. text from an injected instruction). */
  mustNotContain: z.array(z.string()).optional(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export const GOLDEN_PATH = path.resolve(import.meta.dirname, "golden.jsonl");

export function parseCases(jsonl: string): EvalCase[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const parsed = evalCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`golden.jsonl line ${i + 1}: ${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
}

export async function loadCases(file = GOLDEN_PATH): Promise<EvalCase[]> {
  return parseCases(await readFile(file, "utf8"));
}
