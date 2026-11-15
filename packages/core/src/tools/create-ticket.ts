import { tickets } from "@app/db";
import { z } from "zod";
import { writeAudit } from "./audit";
import { actingCustomerId } from "./access";
import { defineTool, fail, ok } from "./types";

export const createTicket = defineTool({
  name: "create_ticket",
  description: "Open a support ticket for the signed-in customer when the docs can't resolve their problem.",
  risk: "low",
  input: z.object({
    subject: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(2000),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
  }),
  output: z.object({ ticketId: z.number().int(), status: z.literal("open") }),
  async execute({ db, identity }, input) {
    const customerId = actingCustomerId(identity);
    if (!customerId) return fail("forbidden", "Only a customer account can open tickets.");
    const ticketId = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .insert(tickets)
        .values({ customerId, subject: input.subject, body: input.body, priority: input.priority })
        .returning({ id: tickets.id });
      await writeAudit(tx, identity, {
        action: "ticket.created",
        targetType: "ticket",
        targetId: String(ticket!.id),
        details: { priority: input.priority },
      });
      return ticket!.id;
    });
    return ok({ ticketId, status: "open" as const });
  },
});
