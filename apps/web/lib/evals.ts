import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { type EvalSummary, summarizeEvalRun } from "@app/core";

/** `next dev`/`next start` run from apps/web; the eval harness writes to <repo>/evals/results. */
const RESULTS_DIR = path.resolve(process.cwd(), "../../evals/results");

/** Latest eval run file, summarized; null when none exists (e.g. a fresh clone or a Docker image without evals). */
export async function latestEvalRun(): Promise<(EvalSummary & { file: string }) | null> {
  const files = await readdir(RESULTS_DIR).catch(() => []);
  // File names are ISO timestamps, so the lexically last .json is the newest. Skip files that don't parse.
  for (const file of files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()) {
    try {
      const raw: unknown = JSON.parse(await readFile(path.join(RESULTS_DIR, file), "utf8"));
      return { ...summarizeEvalRun(raw, file.replace(/\.json$/, "")), file };
    } catch {
      continue;
    }
  }
  return null;
}
