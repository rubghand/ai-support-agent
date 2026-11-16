import {
  CHAT_LIMITS,
  type ChatEvent,
  checkInput,
  consume,
  createCallCollector,
  createTracer,
  exportToLangfuse,
  encodeSse,
  ensureConversation,
  loadConversationHistory,
  redactPii,
  type RouteDecision,
  retrieve,
  routeQuestion,
  runAgent,
  saveAssistantMessage,
  saveLlmCalls,
  saveTrace,
  saveUserMessage,
} from "@app/core";
import { z } from "zod";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";
import { createInProcessClient } from "@app/mcp-server";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.uuid().optional(),
  /** Omitted: MODEL_ROUTING decides (auto = router, off = large). small/large force a tier. */
  tier: z.enum(["auto", "small", "large"]).optional(),
});

/** Behind a proxy the first X-Forwarded-For entry is the client; without one, requests share the "unknown" bucket. */
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = session.user;
  const { db, embedder, llm, reranker, modelRouting, langfuse } = getServices();

  const [byUser, byIp] = await Promise.all([
    consume(db, `chat:user:${userId}`, CHAT_LIMITS.user),
    consume(db, `chat:ip:${clientIp(request)}`, CHAT_LIMITS.ip),
  ]);
  if (!byUser.allowed || !byIp.allowed) {
    const retryAfter = Math.max(byUser.retryAfterSeconds, byIp.retryAfterSeconds);
    return Response.json(
      { error: "Too many requests", retryAfterSeconds: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const { conversationId: requestedId } = parsed.data;
  const requestedTier = parsed.data.tier ?? (modelRouting === "auto" ? "auto" : "large");
  const conversationId = await ensureConversation(db, userId, requestedId);
  if (!conversationId) return Response.json({ error: "Conversation not found" }, { status: 404 });
  // Card numbers, emails and phone numbers are never needed by the agent: drop them before storage and the model.
  const { text: message, found: redacted } = redactPii(parsed.data.message);
  const userMessageId = await saveUserMessage(
    db,
    conversationId,
    message,
    redacted.length > 0 ? { redacted } : undefined,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(encodeSse(event)));
      // One MCP client per request, bound to the verified session's identity.
      const tracer = createTracer({ name: "chat", conversationId, userId: String(userId) });
      const calls = createCallCollector((call, timing) =>
        tracer.add({
          name: `llm:${call.purpose}`,
          kind: "generation",
          parentId: timing.parentId,
          startedAt: timing.startedAt,
          endedAt: timing.endedAt,
          attributes: {
            model: call.model,
            tier: call.tier,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            projectedCostUsd: call.projectedCostUsd,
          },
        }),
      );
      const toolStarts = new Map<string, number>();
      let traceStatus: "ok" | "error" = "ok";
      const mcp = await createInProcessClient({ db, identity: session.user, conversationId });
      try {
        send({ type: "meta", conversationId });
        const history = await tracer.span("history", (spanId) =>
          loadConversationHistory({ db, llm: calls.meter(llm, "summary", spanId) }, conversationId, {
            beforeId: userMessageId,
            signal: request.signal,
          }),
        );
        const context = history.recent
          .slice(-2)
          .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
          .join("\n");
        // The guard runs inside the agent, so the router (a second small-model call) only runs for
        // messages that pass it: blocked messages cost one small call and no large-model tokens.
        let route: RouteDecision | undefined;
        const events = runAgent(
          {
            llm: calls.meter(llm, "agent", tracer.rootId),
            mcp: mcp.client,
            search: (query) =>
              tracer.span(
                "retrieve",
                (spanId) =>
                  retrieve(db, embedder, query, {
                    k: 5,
                    candidates: 20,
                    reranker: {
                      model: reranker.model,
                      score: (q, documents) =>
                        tracer.span("rerank", () => reranker.score(q, documents), {
                          parentId: spanId,
                          attributes: { model: reranker.model, documents: documents.length },
                        }),
                    },
                  }),
                { attributes: { query } },
              ),
            inputGuard: (question) =>
              tracer.span("guard", async (spanId) => {
                const verdict = await checkInput(calls.meter(llm, "guard", spanId), question, {
                  context,
                  signal: request.signal,
                });
                tracer.setAttributes({ guardAllowed: verdict.allowed });
                return verdict;
              }),
            route: (question) =>
              tracer.span(
                "route",
                async (spanId) => {
                  route =
                    requestedTier === "auto"
                      ? await routeQuestion(calls.meter(llm, "route", spanId), question, {
                          hasHistory: history.messages.length > 0,
                          signal: request.signal,
                        })
                      : { tier: requestedTier, source: "forced", reason: "tier set by the request" };
                  tracer.setAttributes({ tier: route.tier, routeSource: route.source });
                  return route.tier;
                },
                {},
              ),
          },
          message,
          { history: history.messages, signal: request.signal },
        );
        for await (const event of events) {
          switch (event.type) {
            case "tool_call":
              toolStarts.set(event.id, Date.now());
              send({ type: "tool", id: event.id, name: event.name, label: event.label, status: "running" });
              break;
            case "tool_result":
              tracer.add({
                name: `tool:${event.name}`,
                kind: "tool",
                startedAt: toolStarts.get(event.id) ?? Date.now(),
                endedAt: Date.now(),
                status: event.ok ? "ok" : "error",
              });
              send({
                type: "tool",
                id: event.id,
                name: event.name,
                label: "",
                status: event.ok ? "done" : "failed",
              });
              break;
            case "approval_pending":
              send({ type: "approval", actionId: event.actionId, summary: event.summary });
              break;
            case "token":
              send(event);
              break;
            case "final": {
              const { answer } = event;
              const messageId = await saveAssistantMessage(db, conversationId, answer, {
                route: route ?? null,
                projectedCostUsd: calls.totals().projectedCostUsd,
                traceId: tracer.traceId,
              });
              send({ type: "citations", citations: answer.citations, answer: answer.answer });
              send({
                type: "done",
                confidence: answer.confidence,
                needsHuman: answer.needsHuman,
                grounded: answer.grounded,
                model: answer.model,
                latencyMs: answer.latencyMs,
                messageId,
              });
              break;
            }
            default: {
              const unhandled: never = event;
              throw new Error(`Unhandled agent event: ${JSON.stringify(unhandled)}`);
            }
          }
        }
      } catch (error) {
        traceStatus = "error";
        console.error("chat failed", error);
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        await saveLlmCalls(db, conversationId, calls.calls).catch((error) =>
          console.error("failed to save llm calls", error),
        );
        const { inputTokens, outputTokens, projectedCostUsd } = calls.totals();
        tracer.setAttributes({ inputTokens, outputTokens, projectedCostUsd });
        const trace = tracer.finish(traceStatus);
        await saveTrace(db, trace).catch((error) => console.error("failed to save trace", error));
        if (langfuse) void exportToLangfuse(langfuse, trace);
        await mcp.close();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
