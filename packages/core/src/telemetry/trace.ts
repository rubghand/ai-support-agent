import { randomUUID } from "node:crypto";
import { type Db, spans, traces } from "@app/db";

export type SpanKind = "span" | "generation" | "tool";
export type SpanStatus = "ok" | "error";

export interface SpanRecord {
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startedAt: Date;
  durationMs: number;
  attributes: Record<string, unknown>;
}

export interface TraceRecord {
  id: string;
  rootId: string;
  name: string;
  conversationId: string | null;
  userId: string | null;
  status: SpanStatus;
  startedAt: Date;
  durationMs: number;
  attributes: Record<string, unknown>;
  spans: SpanRecord[];
}

export interface AddSpan {
  name: string;
  kind?: SpanKind;
  parentId?: string;
  startedAt: number;
  endedAt: number;
  status?: SpanStatus;
  attributes?: Record<string, unknown>;
}

export interface Tracer {
  traceId: string;
  /** Id of the root of the trace; the default parent of every span. */
  rootId: string;
  /** Runs `fn` as a span. Errors mark it failed and are rethrown. `fn` gets the span id to parent children. */
  span<T>(
    name: string,
    fn: (spanId: string) => Promise<T>,
    options?: { kind?: SpanKind; parentId?: string; attributes?: Record<string, unknown> },
  ): Promise<T>;
  /** Records a step that already happened (model call, tool call). */
  add(span: AddSpan): string;
  setAttributes(attributes: Record<string, unknown>): void;
  /** Closes the trace. Idempotent; the first call wins. */
  finish(status?: SpanStatus): TraceRecord;
}

export interface TracerOptions {
  name: string;
  conversationId?: string | null;
  userId?: string | null;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * Collects the spans of one request in memory. Parents are explicit (not ambient context) because the
 * agent runs inside an async generator, where an implicit "current span" would point at the wrong step.
 */
export function createTracer({ name, conversationId, userId, now = Date.now }: TracerOptions): Tracer {
  const traceId = randomUUID();
  const rootId = randomUUID();
  const started = now();
  const collected: SpanRecord[] = [];
  const attributes: Record<string, unknown> = {};
  let finished: TraceRecord | undefined;

  const add: Tracer["add"] = (input) => {
    const id = randomUUID();
    collected.push({
      id,
      parentId: input.parentId ?? rootId,
      name: input.name,
      kind: input.kind ?? "span",
      status: input.status ?? "ok",
      startedAt: new Date(input.startedAt),
      durationMs: Math.max(0, Math.round(input.endedAt - input.startedAt)),
      attributes: input.attributes ?? {},
    });
    return id;
  };

  return {
    traceId,
    rootId,
    async span(spanName, fn, options = {}) {
      const id = randomUUID();
      const startedAt = now();
      let status: SpanStatus = "ok";
      const extra: Record<string, unknown> = { ...options.attributes };
      try {
        return await fn(id);
      } catch (error) {
        status = "error";
        extra.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        collected.push({
          id,
          parentId: options.parentId ?? rootId,
          name: spanName,
          kind: options.kind ?? "span",
          status,
          startedAt: new Date(startedAt),
          durationMs: Math.max(0, Math.round(now() - startedAt)),
          attributes: extra,
        });
      }
    },
    add,
    setAttributes(extra) {
      Object.assign(attributes, extra);
    },
    finish(status = "ok") {
      finished ??= {
        id: traceId,
        rootId,
        name,
        conversationId: conversationId ?? null,
        userId: userId ?? null,
        status,
        startedAt: new Date(started),
        durationMs: Math.max(0, Math.round(now() - started)),
        attributes,
        spans: [...collected].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
      };
      return finished;
    },
  };
}

/** Stores a finished trace. The root span exists only in the `traces` row; top-level spans have a null parent. */
export async function saveTrace(db: Db, trace: TraceRecord) {
  await db.transaction(async (tx) => {
    await tx.insert(traces).values({
      id: trace.id,
      conversationId: trace.conversationId,
      userId: trace.userId,
      name: trace.name,
      status: trace.status,
      startedAt: trace.startedAt,
      durationMs: trace.durationMs,
      attributes: trace.attributes,
    });
    if (trace.spans.length === 0) return;
    await tx.insert(spans).values(
      trace.spans.map((s) => ({
        id: s.id,
        traceId: trace.id,
        parentId: s.parentId === trace.rootId ? null : s.parentId,
        name: s.name,
        kind: s.kind,
        status: s.status,
        startedAt: s.startedAt,
        durationMs: s.durationMs,
        attributes: s.attributes,
      })),
    );
  });
}
