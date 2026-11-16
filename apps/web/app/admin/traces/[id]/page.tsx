import { getTraceDetail } from "@app/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatMs, formatTime, requireAdmin } from "@/lib/admin";
import { getServices } from "@/lib/services";

type Span = NonNullable<Awaited<ReturnType<typeof getTraceDetail>>>["spans"][number];

function SpanTree({
  spans,
  parentId,
  total,
  offset,
  depth,
}: {
  spans: Span[];
  parentId: string | null;
  total: number;
  offset: number;
  depth: number;
}) {
  return (
    <>
      {spans
        .filter((s) => s.parentId === parentId)
        .map((s) => {
          const left = total === 0 ? 0 : ((s.startedAt.getTime() - offset) / total) * 100;
          const width = total === 0 ? 100 : Math.max((s.durationMs / total) * 100, 0.5);
          const a = s.attributes;
          return (
            <div key={s.id}>
              <div className="grid grid-cols-[18rem_1fr_4rem] items-center gap-2 border-t border-zinc-100 py-1 text-xs">
                <span className="truncate" style={{ paddingLeft: `${depth * 14}px` }} title={s.name}>
                  {s.name}
                  {s.kind === "generation" && (
                    <span className="text-zinc-400">
                      {" "}
                      {String(a.model)} {String(a.inputTokens)}→{String(a.outputTokens)}
                    </span>
                  )}
                  {s.status === "error" && <span className="text-red-700"> failed</span>}
                </span>
                <div className="relative h-2 rounded bg-zinc-100">
                  <div
                    className={`absolute h-2 rounded ${s.status === "error" ? "bg-red-600" : s.kind === "generation" ? "bg-sky-700" : s.kind === "tool" ? "bg-emerald-700" : "bg-zinc-700"}`}
                    style={{ left: `${Math.min(left, 99.5)}%`, width: `${Math.min(width, 100 - left)}%` }}
                  />
                </div>
                <span className="text-right text-zinc-600">{formatMs(s.durationMs)}</span>
              </div>
              <SpanTree spans={spans} parentId={s.id} total={total} offset={offset} depth={depth + 1} />
            </div>
          );
        })}
    </>
  );
}

export default function TracePage(props: PageProps<"/admin/traces/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-8">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/traces/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getTraceDetail(getServices().db, id);
  if (!detail) notFound();
  const { trace, spans } = detail;

  return (
    <>
      {trace.conversationId && (
        <Link
          href={`/admin/conversations/${trace.conversationId}`}
          className="text-sm text-zinc-600 underline"
        >
          Back to conversation
        </Link>
      )}
      <header>
        <h1 className="text-xl font-semibold">Trace</h1>
        <p className="text-xs text-zinc-500">
          {trace.id} · {trace.status} · {formatMs(trace.durationMs)} · {formatTime(trace.startedAt)}
        </p>
      </header>
      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        {spans.length === 0 && <p className="text-sm text-zinc-500">No spans recorded.</p>}
        <SpanTree
          spans={spans}
          parentId={null}
          total={trace.durationMs}
          offset={trace.startedAt.getTime()}
          depth={0}
        />
      </section>
    </>
  );
}
