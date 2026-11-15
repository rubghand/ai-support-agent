"use server";

import { decideAction } from "@app/core";
import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";

const decisionSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

/** Reachable by direct POST, so it checks the role itself (and `decideAction` checks it again). */
export async function decide(formData: FormData) {
  const session = await auth();
  if (session?.user.role !== "admin") throw new Error("Forbidden");
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid decision");
  const { actionId, decision, note } = parsed.data;
  const result = await decideAction(getServices().db, session.user, actionId, decision, note);
  // Another admin deciding first is expected; the refreshed list shows their decision.
  if (!result.ok && result.error.code !== "invalid_state") throw new Error(result.error.message);
  refresh();
}
