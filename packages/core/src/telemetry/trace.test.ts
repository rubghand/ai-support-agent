import { describe, expect, it, vi } from "vitest";
import { exportToLangfuse, toLangfuseEvents } from "./langfuse";
import { createTracer } from "./trace";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("createTracer", () => {
  it("nests spans by explicit parent and defaults to the root", async () => {
    const c = clock();
    const tracer = createTracer({ name: "chat", now: c.now });
    await tracer.span("retrieve", async (parentId) => {
      c.tick(10);
      await tracer.span("rerank", async () => c.tick(40), { parentId });
    });
    const trace = tracer.finish();
    const retrieve = trace.spans.find((s) => s.name === "retrieve")!;
    const rerank = trace.spans.find((s) => s.name === "rerank")!;
    expect(retrieve.parentId).toBe(tracer.rootId);
    expect(rerank.parentId).toBe(retrieve.id);
    expect([retrieve.durationMs, rerank.durationMs]).toEqual([50, 40]);
  });

  it("marks a failed span as error and rethrows", async () => {
    const tracer = createTracer({ name: "chat" });
    await expect(
      tracer.span("guard", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(tracer.finish("error").spans[0]).toMatchObject({
      status: "error",
      attributes: { error: "boom" },
    });
  });

  it("finish is idempotent and orders spans by start time", () => {
    const tracer = createTracer({ name: "chat" });
    tracer.add({ name: "late", startedAt: 200, endedAt: 250 });
    tracer.add({ name: "early", startedAt: 100, endedAt: 150 });
    const first = tracer.finish();
    expect(first.spans.map((s) => s.name)).toEqual(["early", "late"]);
    expect(tracer.finish("error")).toBe(first);
  });
});

describe("langfuse export", () => {
  const tracer = createTracer({ name: "chat", conversationId: "c1", userId: "7" });
  const parent = tracer.add({ name: "route", startedAt: 0, endedAt: 5 });
  tracer.add({
    name: "llm:route",
    kind: "generation",
    parentId: parent,
    startedAt: 1,
    endedAt: 4,
    attributes: { model: "qwen3:4b", inputTokens: 10, outputTokens: 2 },
  });
  const trace = tracer.finish();

  it("maps a trace, spans and generations to ingestion events", () => {
    const events = toLangfuseEvents(trace);
    expect(events.map((e) => e.type)).toEqual(["trace-create", "span-create", "generation-create"]);
    expect(events[0]!.body).toMatchObject({ id: trace.id, sessionId: "c1", userId: "7" });
    expect(events[2]!.body).toMatchObject({
      parentObservationId: parent,
      model: "qwen3:4b",
      usage: { input: 10, output: 2, unit: "TOKENS" },
    });
    expect(events[1]!.body.parentObservationId).toBeUndefined();
  });

  it("posts with basic auth and never throws", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 207 }));
    await exportToLangfuse({ publicKey: "pk", secretKey: "sk", baseUrl: "https://x.test/" }, trace, ok);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/public/ingestion");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("pk:sk")}`);

    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      exportToLangfuse({ publicKey: "pk", secretKey: "sk", baseUrl: "https://x.test" }, trace, failing),
    ).resolves.toBeUndefined();
  });
});
