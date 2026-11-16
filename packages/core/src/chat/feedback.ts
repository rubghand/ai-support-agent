import { type Db, conversations, messageFeedback, messages } from "@app/db";
import { and, eq, sql } from "drizzle-orm";

export type Rating = "up" | "down";

/**
 * Records the user's rating of an assistant message in one of their own conversations. Anyone else's
 * message, a user message and a missing id all give `not_found`, so ids can't be probed.
 */
export async function submitFeedback(
  db: Db,
  userId: number,
  messageId: number,
  rating: Rating,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const [owned] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.role, "assistant"), eq(conversations.userId, userId)));
  if (!owned) return { ok: false, error: "not_found" };
  await db
    .insert(messageFeedback)
    .values({ messageId, userId, rating })
    .onConflictDoUpdate({
      target: [messageFeedback.messageId, messageFeedback.userId],
      set: { rating, updatedAt: sql`now()` },
    });
  return { ok: true };
}
