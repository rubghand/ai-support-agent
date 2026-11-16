import { randomUUID } from "node:crypto";
import type { SpanRecord, TraceRecord } from "./trace";

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  /** e.g. https://cloud.langfuse.com */
  baseUrl: string;
}

interface IngestionEvent {
  id: string;
  type: "trace-create" | "span-create" | "generation-create";
  timestamp: string;
  body: Record<string, unknown>;
}

const iso = (date: Date) => date.toISOString();
const endOf = (start: Date, durationMs: number) => new Date(start.getTime() + durationMs);

function spanEvent(trace: TraceRecord, span: SpanRecord): IngestionEvent {
  const generation = span.kind === "generation";
  return {
    id: randomUUID(),
    type: generation ? "generation-create" : "span-create",
    timestamp: iso(span.startedAt),
    body: {
      id: span.id,
      traceId: trace.id,
      name: span.name,
      startTime: iso(span.startedAt),
      endTime: iso(endOf(span.startedAt, span.durationMs)),
      parentObservationId: span.parentId === trace.rootId ? undefined : span.parentId,
      level: span.status === "error" ? "ERROR" : "DEFAULT",
      metadata: span.attributes,
      ...(generation
        ? {
            model: span.attributes.model,
            usage: {
              input: span.attributes.inputTokens,
              output: span.attributes.outputTokens,
              unit: "TOKENS",
            },
          }
        : {}),
    },
  };
}

/** Maps a finished trace to Langfuse's batch ingestion events. Exported for tests. */
export function toLangfuseEvents(trace: TraceRecord): IngestionEvent[] {
  return [
    {
      id: randomUUID(),
      type: "trace-create",
      timestamp: iso(trace.startedAt),
      body: {
        id: trace.id,
        name: trace.name,
        userId: trace.userId ?? undefined,
        sessionId: trace.conversationId ?? undefined,
        metadata: { ...trace.attributes, status: trace.status, durationMs: trace.durationMs },
      },
    },
    ...trace.spans.map((span) => spanEvent(trace, span)),
  ];
}

/**
 * Sends a trace to Langfuse through its public batch API (no SDK dependency). Never throws: tracing
 * must not break a chat, and the local `traces` table is the source of truth.
 */
export async function exportToLangfuse(
  config: LangfuseConfig,
  trace: TraceRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
      },
      body: JSON.stringify({ batch: toLangfuseEvents(trace) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error(`langfuse export failed: HTTP ${response.status}`);
  } catch (error) {
    console.error("langfuse export failed", error);
  }
}
