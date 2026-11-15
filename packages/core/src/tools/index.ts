import { z } from "zod";
import { requestApproval } from "./approval";
import { getTool } from "./registry";
import { type ToolContext, type ToolResult, fail } from "./types";

export { createTicket } from "./create-ticket";
export { escalateToHuman } from "./escalate";
export { lookupOrder } from "./lookup-order";
export { requestRefund } from "./request-refund";
export { getTool, tools, type ToolName } from "./registry";
export * from "./approval";
export * from "./types";

/**
 * Single entry point for hosts (agent loop, MCP server): validates the raw input against the tool's
 * schema, runs it with the verified identity, and validates the output. High-risk tools don't run
 * here: they are filed for staff approval and the result says so. Expected failures come back as
 * `{ ok: false }`; only genuine bugs throw.
 */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<ToolResult<unknown>> {
  const tool = getTool(name);
  if (!tool) return fail("not_found", `Unknown tool: ${name}`);
  const input = tool.input.safeParse(rawInput);
  if (!input.success) return fail("invalid_input", z.prettifyError(input.error));
  if (tool.risk === "high") return requestApproval(ctx, tool, input.data);
  const result = await tool.execute(ctx, input.data);
  return result.ok ? { ok: true, data: tool.output.parse(result.data) } : result;
}
