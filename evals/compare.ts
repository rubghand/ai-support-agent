import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { CaseResult } from "./report";
import { summarize } from "./report";

interface ResultFile {
  label?: string;
  results: CaseResult[];
}

const { positionals } = parseArgs({ allowPositionals: true });
const dir = path.resolve(import.meta.dirname, "results");

/** Files named on the command line; otherwise the newest result file for each label. */
async function pickFiles(): Promise<string[]> {
  if (positionals.length > 0) return positionals.map((p) => path.resolve(p));
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const newest = new Map<string, string>();
  for (const name of names) {
    const file = JSON.parse(await readFile(path.join(dir, name), "utf8")) as ResultFile;
    if (file.label) newest.set(file.label, path.join(dir, name));
  }
  return [...newest.values()];
}

const files = await pickFiles();
if (files.length === 0) {
  console.error("No labelled result files. Run e.g. `npm run eval -- --tier large --label baseline`.");
  process.exit(1);
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const rows: string[] = [];
for (const file of files) {
  const data = JSON.parse(await readFile(file, "utf8")) as ResultFile;
  const row = summarize(data.results, data.label ?? path.basename(file));
  const routed = data.results.filter((r) => r.routedTier);
  const small = routed.filter((r) => r.routedTier === "small").length;
  rows.push(
    `| ${row.label} | ${row.n} | ${pct(row.behavior)} | ${pct(row.tools)} | ${pct(row.hitAt5)} | ${row.mrr === null ? "n/a" : row.mrr.toFixed(2)} | ${pct(row.grounded)} | ${row.latencyMs === null ? "n/a" : (row.latencyMs / 1000).toFixed(1)}s | ${routed.length ? pct(small / routed.length) : "n/a"} | $${(row.costUsd / Math.max(row.n, 1)).toFixed(4)} |`,
  );
}

console.log(
  [
    "| Config | Cases | Behavior | Tools | hit@5 | MRR | Grounded (judge) | Avg latency | Routed small | Projected cost/query |",
    "| ------ | ----- | -------- | ----- | ----- | --- | ---------------- | ----------- | ------------ | -------------------- |",
    ...rows,
  ].join("\n"),
);
