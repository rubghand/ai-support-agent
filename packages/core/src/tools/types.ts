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
}

export type ToolErrorCode = "invalid_input" | "not_found" | "forbidden" | "invalid_state" | "conflict";

export type ToolResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ToolErrorCode; message: string } };

export const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });
export const fail = (code: ToolErrorCode, message: string): ToolResult<never> => ({
  ok: false,
  error: { code, message },
});

export interface ToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** "high" tools change money or accounts and must be approved by a human before taking effect. */
  risk: "low" | "high";
  input: I;
  output: O;
  execute(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult<z.infer<O>>>;
}

/** Keeps the generic parameters inferred at the call site. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return tool;
}
