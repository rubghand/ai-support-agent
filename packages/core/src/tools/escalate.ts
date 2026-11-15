import { tickets } from "@app/db";
import { z } from "zod";
import { actingCustomerId } from "./access";
import { writeAudit } from "./audit";
import { defineTool, fail, ok } from "./types";

export const escalateToHuman = defineTool({
  name: "escalate_to_human",
  description:
    "Hand the conversation to a human agent (angry customer, account-specific problem, anything the assistant can't or shouldn't handle).",
  risk: "low",
  input: z.object({
    reason: z.string().trim().min(3).max(500).describe("Why a human is needed, in one or two sentences."),
    conversationId: z.uuid().optional(),
  }),
  output: z.object({ ticketId: z.number().int(), status: z.literal("escalated") }),
  async execute({ db, identity }, { reason, conversationId }) {
    const customerId = actingCustomerId(identity);
    if (!customerId) return fail("forbidden", "Only a customer account can be escalated.");
    const ticketId = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .insert(tickets)
        .values({
          customerId,
          subject: "[Escalation] Customer needs a human agent",
          body: conversationId ? `${reason}\n\nConversation: ${conversationId}` : reason,
          priority: "high",
        })
        .returning({ id: tickets.id });
      await writeAudit(tx, identity, {
        action: "conversation.escalated",
        targetType: "ticket",
        targetId: String(ticket!.id),
        details: { conversationId: conversationId ?? null },
      });
      return ticket!.id;
    });
    return ok({ ticketId, status: "escalated" as const });
  },
});
