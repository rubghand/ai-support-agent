import {
  CHAT_LIMITS,
  type ChatEvent,
  consume,
  encodeSse,
  ensureConversation,
  retrieve,
  saveAssistantMessage,
  saveUserMessage,
  streamCitedAnswer,
} from "@app/core";
import { z } from "zod";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.uuid().optional(),
  tier: z.enum(["small", "large"]).default("large"),
});

/** Behind a proxy the first X-Forwarded-For entry is the client; without one, requests share the "unknown" bucket. */
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = session.user;
  const { db, embedder, llm } = getServices();

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
  const { message, conversationId: requestedId, tier } = parsed.data;
  const conversationId = await ensureConversation(db, userId, requestedId);
  if (!conversationId) return Response.json({ error: "Conversation not found" }, { status: 404 });
  await saveUserMessage(db, conversationId, message);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(encodeSse(event)));
      try {
        send({ type: "meta", conversationId });
        const retrieved = await retrieve(db, embedder, message, { k: 5 });
        for await (const event of streamCitedAnswer(llm, message, retrieved, { tier }, request.signal)) {
          if (event.type === "token") {
            send(event);
            continue;
          }
          const { answer } = event;
          await saveAssistantMessage(db, conversationId, answer);
          send({ type: "citations", citations: answer.citations, answer: answer.answer });
          send({
            type: "done",
            confidence: answer.confidence,
            needsHuman: answer.needsHuman,
            grounded: answer.grounded,
            model: answer.model,
            latencyMs: answer.latencyMs,
          });
        }
      } catch (error) {
        console.error("chat failed", error);
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
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
