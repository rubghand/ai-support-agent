import { type Db, conversations, messages } from "@app/db";
import { and, asc, eq } from "drizzle-orm";
import type { CitedAnswer } from "../rag/answer";

/** Creates a conversation, or returns the given one only if `userId` owns it (null otherwise). */
export async function ensureConversation(db: Db, userId: number, id?: string): Promise<string | null> {
  if (id) {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    return existing?.id ?? null;
  }
  const newId = crypto.randomUUID();
  await db.insert(conversations).values({ id: newId, userId });
  return newId;
}

export async function saveUserMessage(db: Db, conversationId: string, content: string) {
  await db.insert(messages).values({ conversationId, role: "user", content });
}

export async function saveAssistantMessage(db: Db, conversationId: string, answer: CitedAnswer) {
  const { answer: content, ...metadata } = answer;
  await db.insert(messages).values({ conversationId, role: "assistant", content, metadata });
}

export async function listMessages(db: Db, conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
}
