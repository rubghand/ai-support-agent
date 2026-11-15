import type { Db } from "@app/db";
import type { z } from "zod";

/**
 * Who is calling, taken from the verified session by the host (web app, MCP server).
 * Tools never accept an identity from their input, so a model can't pick whose data to touch.
 */
export interface Identity {
  userId: number;
  role: "customer" | "admin";
  customerId: string | null;
}

export interface ToolContext {
  db: Db;
  identity: Identity;
  /** The chat a call came from, so staff decisions on high-risk actions can be reported back there. */
  conversationId?: string;
  /** Set only when a high-risk tool runs after a staff member approved it. */
  approval?: { actionId: number; approverUserId: number };
}

export type ToolErrorCode = "invalid_input" | "not_found" | "forbidden" | "invalid_state" | "conflict";

export type ToolResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ToolErrorCode; message: string } };

export const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });
export const fail = (code: ToolErrorCode, message: string): ToolResult<never> => ({
  ok: false,
  error: { code, message },
});

/** What a high-risk tool asks a human to approve. */
export interface ApprovalRequest {
  /** One line for the approver and the customer, e.g. "Refund $29.00 for order ORD-1042 (Priority support)". */
  summary: string;
  /** What the action targets (`order:ORD-1042`); only one open action per tool and subject. */
  subjectKey: string;
}

interface ToolBase<I extends z.ZodType, O extends z.ZodType> {
  name: string;
  description: string;
  input: I;
  output: O;
  execute(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult<z.infer<O>>>;
}

export type ToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> =
  | (ToolBase<I, O> & { risk: "low" })
  | (ToolBase<I, O> & {
      /** Changes money or accounts: `execute` runs only after a human approves the request. */
      risk: "high";
      /**
       * Checks, without side effects, that the action is allowed right now and describes it.
       * Runs when the request is filed and again on approval, since state may change in between.
       */
      prepare(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult<ApprovalRequest>>;
    });

export type HighRiskTool = Extract<ToolDefinition, { risk: "high" }>;

/** Keeps the generic parameters inferred at the call site. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return tool;
}
