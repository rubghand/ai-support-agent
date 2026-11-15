import { type Db, conversations, messages } from "@app/db";
import type { ModelMessage } from "ai";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { Llm } from "../llm/provider";
import {
  type HistoryMessage,
  MEMORY_DEFAULTS,
  type MemoryOptions,
  messageTokens,
  planContext,
  toModelMessages,
} from "./context";
import { summarizeConversation } from "./summarize";
import { countTokens } from "./tokens";

export interface ConversationHistory {
  /** Prior turns for the agent prompt: the summary (if any) followed by recent messages verbatim. */
  messages: ModelMessage[];
  summary: string | null;
  /** The messages sent verbatim (oldest first). */
  recent: HistoryMessage[];
  /** Estimated tokens of `messages`. */
  tokens: number;
  /** Messages folded into the summary during this call (0 if none, or if summarizing failed). */
  summarizedNow: number;
}

export interface LoadHistoryOptions extends Partial<MemoryOptions> {
  /** Only messages with a smaller id are history (excludes the message being answered). */
  beforeId?: number;
  signal?: AbortSignal;
}

/**
 * Loads a conversation's history within the token budget, updating the stored rolling summary when
 * older messages no longer fit. A failed summary never fails the chat: the turn just goes ahead with
 * the previous summary and the recent messages.
 */
export async function loadConversationHistory(
  { db, llm }: { db: Db; llm: Llm },
  conversationId: string,
  { beforeId, signal, ...overrides }: LoadHistoryOptions = {},
): Promise<ConversationHistory> {
  const options = { ...MEMORY_DEFAULTS, ...overrides };
  const [stored] = await db
    .select({ summary: conversations.summary, summarizedThroughId: conversations.summarizedThroughId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!stored) throw new Error(`Conversation ${conversationId} not found`);

  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(
      beforeId === undefined
        ? eq(messages.conversationId, conversationId)
        : and(eq(messages.conversationId, conversationId), lt(messages.id, beforeId)),
    )
    .orderBy(asc(messages.id));

  const plan = planContext(rows, stored, options);
  let summary = stored.summary;
  let summarizedNow = 0;
  if (plan.toSummarize.length > 0) {
    try {
      summary = await summarizeConversation(llm, {
        previousSummary: stored.summary,
        messages: plan.toSummarize,
        maxTokens: options.summaryMaxTokens,
        signal,
      });
      summarizedNow = plan.toSummarize.length;
      // Compare-and-set: if a concurrent turn already moved the summary on, keep theirs in the DB.
      await db
        .update(conversations)
        .set({ summary, summarizedThroughId: plan.toSummarize.at(-1)!.id })
        .where(
          and(
            eq(conversations.id, conversationId),
            stored.summarizedThroughId === null
              ? isNull(conversations.summarizedThroughId)
              : eq(conversations.summarizedThroughId, stored.summarizedThroughId),
          ),
        );
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("conversation summary failed; continuing with recent messages only", error);
    }
  }

  const tokens = (summary ? countTokens(summary) : 0) + plan.recent.reduce((n, m) => n + messageTokens(m), 0);
  return {
    messages: toModelMessages(summary, plan.recent),
    summary,
    recent: plan.recent,
    tokens,
    summarizedNow,
  };
}
