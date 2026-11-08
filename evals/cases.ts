import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const evalCaseSchema = z.object({
  id: z.string(),
  category: z.enum(["answerable"]),
  question: z.string().min(1),
  /** Any of these documents counts as a correct retrieval. */
  expectedDocIds: z.array(z.string()).min(1),
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
