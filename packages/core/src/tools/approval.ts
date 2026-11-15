import { type Db, messages, pendingActions, users } from "@app/db";
import { and, asc, desc, eq, getTableColumns, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { ActionUpdate } from "../chat/events";
import { writeAudit } from "./audit";
import { getTool } from "./registry";
import { type HighRiskTool, type Identity, type ToolContext, type ToolResult, fail, ok } from "./types";

/** What a high-risk tool call returns to the caller (agent or MCP client) instead of running. */
export const approvalPendingSchema = z.object({
  status: z.literal("pending_approval"),
  actionId: z.number().int(),
  summary: z.string(),
  message: z.string(),
});
export type ApprovalPending = z.infer<typeof approvalPendingSchema>;

type PendingAction = typeof pendingActions.$inferSelect;
type Writer = Pick<Db, "insert">;

/**
 * Files a high-risk tool call for staff review. The tool's `prepare` rejects calls that could never
 * be approved (someone else's order, an unpaid order), so staff only see actionable requests.
 */
export async function requestApproval(
  ctx: ToolContext,
  tool: HighRiskTool,
  input: unknown,
): Promise<ToolResult<ApprovalPending>> {
  const prepared = await tool.prepare(ctx, input);
  if (!prepared.ok) return prepared;
  const { summary, subjectKey } = prepared.data;
  const actionId = await ctx.db.transaction(async (tx) => {
    // The partial unique index decides races: a second open request for the subject inserts nothing.
    const [row] = await tx
      .insert(pendingActions)
      .values({
        toolName: tool.name,
        args: input as Record<string, unknown>,
        summary,
        subjectKey,
        requestedByUserId: ctx.identity.userId,
        conversationId: ctx.conversationId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: pendingActions.id });
    if (!row) return null;
    await writeAudit(tx, ctx.identity, {
      action: "action.requested",
      targetType: "pending_action",
      targetId: String(row.id),
      details: { tool: tool.name, subjectKey },
    });
    return row.id;
  });
  if (actionId === null) return fail("conflict", `${summary} is already waiting for staff review.`);
  return ok({
    status: "pending_approval" as const,
    actionId,
    summary,
    message: "Filed for staff review. Nothing has happened yet; it takes effect only if staff approve it.",
  });
}

/** Customer-facing outcome of a decided action; null while it is still waiting or executing. */
export function customerUpdate(
  action: Pick<PendingAction, "status" | "summary" | "decisionNote" | "result">,
): string | null {
  const note = action.decisionNote ? ` Note from our team: ${action.decisionNote}` : "";
  switch (action.status) {
    case "pending":
    case "approved":
      return null;
    case "executed":
      return `Staff approved your request: ${action.summary}. It has been processed.${note}`;
    case "rejected":
      return `Staff declined your request: ${action.summary}.${note}`;
    case "failed": {
      const error = (action.result as { error?: { message?: string } } | null)?.error?.message;
      return `Staff approved your request (${action.summary}), but it couldn't be completed${error ? `: ${error}` : "."} Our team will follow up.${note}`;
    }
    default: {
      const unhandled: never = action.status;
      throw new Error(`Unhandled action status: ${String(unhandled)}`);
    }
  }
}

/** Posts the decision into the conversation the request came from, so the customer sees it there. */
async function notifyCustomer(db: Writer, action: PendingAction) {
  const content = customerUpdate(action);
  if (!action.conversationId || !content) return;
  await db.insert(messages).values({
    conversationId: action.conversationId,
    role: "assistant",
    content,
    metadata: { kind: "action_update", actionId: action.id, status: action.status },
  });
}

/** Replays the approved call as the customer who asked for it, after re-checking it is still allowed. */
async function runApproved(db: Db, action: PendingAction, approver: Identity): Promise<ToolResult<unknown>> {
  const tool = getTool(action.toolName);
  if (tool?.risk !== "high") return fail("invalid_state", `${action.toolName} is not an approvable action.`);
  const [requester] = await db.select().from(users).where(eq(users.id, action.requestedByUserId));
  if (!requester) return fail("not_found", "The customer who asked for this no longer exists.");
  const input = tool.input.safeParse(action.args);
  if (!input.success) return fail("invalid_input", z.prettifyError(input.error));
  const ctx: ToolContext = {
    db,
    identity: { userId: requester.id, role: requester.role, customerId: requester.customerId },
    conversationId: action.conversationId ?? undefined,
    approval: { actionId: action.id, approverUserId: approver.userId },
  };
  const check = await tool.prepare(ctx, input.data);
  if (!check.ok) return check;
  const result = await tool.execute(ctx, input.data);
  return result.ok ? ok(tool.output.parse(result.data)) : result;
}

async function finish(db: Db, action: PendingAction, approver: Identity, result: ToolResult<unknown>) {
  const status = result.ok ? "executed" : "failed";
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(pendingActions)
      .set({ status, result })
      .where(eq(pendingActions.id, action.id))
      .returning();
    await writeAudit(tx, approver, {
      action: `action.${status}`,
      targetType: "pending_action",
      targetId: String(action.id),
      details: result.ok ? { tool: action.toolName } : { tool: action.toolName, error: result.error },
    });
    await notifyCustomer(tx, done!);
  });
  return status;
}

export type Decision = "approve" | "reject";

/**
 * Staff decision on a pending action. Claiming the row (`pending` -> `approved`/`rejected`) is a
 * conditional update, so two staff members deciding at once can't both win and the tool runs once.
 * Every step is audited and the outcome is posted to the customer's conversation.
 */
export async function decideAction(
  db: Db,
  approver: Identity,
  actionId: number,
  decision: Decision,
  note?: string,
): Promise<ToolResult<{ actionId: number; status: "rejected" | "executed" | "failed" }>> {
  if (approver.role !== "admin") return fail("forbidden", "Only staff can approve or reject actions.");
  const decisionNote = note?.trim() || null;
  const claimedStatus = decision === "approve" ? "approved" : "rejected";
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(pendingActions)
      .set({ status: claimedStatus, decidedByUserId: approver.userId, decidedAt: new Date(), decisionNote })
      .where(and(eq(pendingActions.id, actionId), eq(pendingActions.status, "pending")))
      .returning();
    if (!row) return null;
    await writeAudit(tx, approver, {
      action: `action.${claimedStatus}`,
      targetType: "pending_action",
      targetId: String(row.id),
      details: { tool: row.toolName, subjectKey: row.subjectKey, note: decisionNote },
    });
    if (claimedStatus === "rejected") await notifyCustomer(tx, row);
    return row;
  });
  if (!claimed) {
    const [existing] = await db
      .select({ status: pendingActions.status })
      .from(pendingActions)
      .where(eq(pendingActions.id, actionId));
    return existing
      ? fail("invalid_state", `Action ${actionId} was already decided (${existing.status}).`)
      : fail("not_found", `No action with id ${actionId}.`);
  }
  if (decision === "reject") return ok({ actionId, status: "rejected" as const });

  let result: ToolResult<unknown>;
  try {
    result = await runApproved(db, claimed, approver);
  } catch (error) {
    // Don't leave the action stuck in `approved` (it would block new requests for the subject).
    await finish(
      db,
      claimed,
      approver,
      fail("invalid_state", "Unexpected error while processing the request."),
    );
    throw error;
  }
  return ok({ actionId, status: await finish(db, claimed, approver, result) });
}

const requester = alias(users, "requester");
const decider = alias(users, "decider");

/** Open actions oldest first (a queue), or decided ones newest first. */
export async function listActions(db: Db, which: "open" | "decided", limit = 50) {
  return db
    .select({
      ...getTableColumns(pendingActions),
      requesterEmail: requester.email,
      deciderEmail: decider.email,
    })
    .from(pendingActions)
    .innerJoin(requester, eq(requester.id, pendingActions.requestedByUserId))
    .leftJoin(decider, eq(decider.id, pendingActions.decidedByUserId))
    .where(which === "open" ? eq(pendingActions.status, "pending") : ne(pendingActions.status, "pending"))
    .orderBy(which === "open" ? asc(pendingActions.createdAt) : desc(pendingActions.decidedAt))
    .limit(limit);
}

/** One action as its requester sees it; null if it doesn't exist or belongs to someone else. */
export async function getActionForUser(
  db: Db,
  userId: number,
  actionId: number,
): Promise<ActionUpdate | null> {
  const [action] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, actionId), eq(pendingActions.requestedByUserId, userId)));
  if (!action) return null;
  return { id: action.id, status: action.status, summary: action.summary, message: customerUpdate(action) };
}
