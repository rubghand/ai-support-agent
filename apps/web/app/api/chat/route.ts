import {
  type ChatEvent,
  encodeSse,
  ensureConversation,
  retrieve,
  saveAssistantMessage,
  saveUserMessage,
  streamCitedAnswer,
} from "@app/core";
import { z } from "zod";
import { getServices } from "@/lib/services";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.uuid().optional(),
  tier: z.enum(["small", "large"]).default("large"),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const { message, conversationId: requestedId, tier } = parsed.data;
  const { db, embedder, llm } = getServices();

  const conversationId = await ensureConversation(db, requestedId);
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
