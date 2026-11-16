import { getConversationDetail } from "@app/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatTime, requireAdmin } from "@/lib/admin";
import { getServices } from "@/lib/services";

interface CitationMeta {
  label: string;
  title: string;
  url: string;
}
interface ToolCallMeta {
  name: string;
  ok: boolean;
}

/** Message metadata is JSON written by the chat route; read only the fields shown, tolerating older rows. */
function readMeta(metadata: Record<string, unknown> | null) {
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    citations: list<CitationMeta>(metadata?.citations),
    toolCalls: list<ToolCallMeta>(metadata?.toolCalls),
    guardFlags: list<string>(metadata?.guardFlags),
    model: typeof metadata?.model === "string" ? metadata.model : null,
    confidence: typeof metadata?.confidence === "string" ? metadata.confidence : null,
    needsHuman: metadata?.needsHuman === true,
    latencyMs: typeof metadata?.latencyMs === "number" ? metadata.latencyMs : null,
    cost: typeof metadata?.projectedCostUsd === "number" ? metadata.projectedCostUsd : null,
    route:
      metadata?.route && typeof metadata.route === "object"
        ? (metadata.route as { tier?: string; source?: string })
        : null,
  };
}

export default function ConversationPage(props: PageProps<"/admin/conversations/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8">
      <Link href="/admin/conversations" className="text-sm text-zinc-600 underline">
        All conversations
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/conversations/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  const convo = await getConversationDetail(getServices().db, id);
  if (!convo) notFound();

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold">{convo.userEmail}</h1>
        <p className="text-xs text-zinc-500">
          {convo.id} · started {formatTime(convo.createdAt)}
        </p>
        {convo.summary && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-100 p-3 text-xs text-zinc-700">
            <span className="font-medium">Rolling summary:</span> {convo.summary}
          </p>
        )}
      </header>
      <ol className="flex flex-col gap-3">
        {convo.messages.map((m) => {
          const meta = readMeta(m.metadata);
          return (
            <li key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900"
                }`}
              >
                {m.content}
              </div>
              {m.role === "assistant" && (
                <div className="mt-1 flex max-w-[85%] flex-col gap-1 text-xs text-zinc-500">
                  <p>
                    {meta.model ?? "no model"}
                    {meta.route && ` · routed ${meta.route.tier} (${meta.route.source})`}
                    {meta.confidence && ` · confidence ${meta.confidence}`}
                    {meta.latencyMs !== null && ` · ${meta.latencyMs}ms`}
                    {meta.cost !== null && ` · $${meta.cost.toFixed(4)}`}
                    {meta.needsHuman && " · needs human"}
                    {m.rating && ` · ${m.rating === "up" ? "👍" : "👎"}`}
                  </p>
                  {meta.guardFlags.length > 0 && (
                    <p className="text-amber-700">Guard: {meta.guardFlags.join(", ")}</p>
                  )}
                  {meta.toolCalls.length > 0 && (
                    <p>
                      Tools: {meta.toolCalls.map((t) => `${t.name}${t.ok ? "" : " (failed)"}`).join(", ")}
                    </p>
                  )}
                  {meta.citations.length > 0 && (
                    <p>
                      Sources:{" "}
                      {meta.citations.map((c, i) => (
                        <span key={`${c.label}-${i}`}>
                          {i > 0 && ", "}
                          <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                            [{c.label}] {c.title}
                          </a>
                        </span>
                      ))}
                    </p>
                  )}
                  {m.traceId && (
                    <Link href={`/admin/traces/${m.traceId}`} className="underline">
                      View trace
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
