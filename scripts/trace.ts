import { createDb, spans, traces } from "@app/db";
import { desc, eq } from "drizzle-orm";
import { loadConfig } from "@app/core";

/** Prints a trace as a tree: `npm run trace [-- <traceId>]` (default: the latest). */
const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const wanted = process.argv[2];

const [trace] = wanted
  ? await db.select().from(traces).where(eq(traces.id, wanted))
  : await db.select().from(traces).orderBy(desc(traces.startedAt)).limit(1);
if (!trace) {
  console.error("No trace found");
  await close();
  process.exit(1);
}
const rows = await db.select().from(spans).where(eq(spans.traceId, trace.id));
rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

console.log(
  `trace ${trace.id}  ${trace.name}  ${trace.status}  ${trace.durationMs}ms  conversation=${trace.conversationId}`,
);
const print = (parentId: string | null, depth: number) => {
  for (const span of rows.filter((s) => s.parentId === parentId)) {
    const mark = span.status === "error" ? " !" : "";
    const a = span.attributes;
    const detail =
      span.kind === "generation"
        ? `  ${String(a.model)} in=${String(a.inputTokens)} out=${String(a.outputTokens)}`
        : "";
    console.log(`${"  ".repeat(depth)}- ${span.name} [${span.kind}] ${span.durationMs}ms${mark}${detail}`);
    print(span.id, depth + 1);
  }
};
print(null, 1);
await close();
