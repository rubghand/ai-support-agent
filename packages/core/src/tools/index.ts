import { z } from "zod";
import { createTicket } from "./create-ticket";
import { escalateToHuman } from "./escalate";
import { lookupOrder } from "./lookup-order";
import { requestRefund } from "./request-refund";
import { type ToolContext, type ToolDefinition, type ToolResult, fail } from "./types";

export { createTicket, escalateToHuman, lookupOrder, requestRefund };
export * from "./types";

export const tools = [lookupOrder, createTicket, escalateToHuman, requestRefund] as const;
export type ToolName = (typeof tools)[number]["name"];

const byName = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t as unknown as ToolDefinition]));

export function getTool(name: string): ToolDefinition | undefined {
  return byName.get(name);
}

/**
 * Single entry point for hosts (agent loop, MCP server): validates the raw input against the tool's
 * schema, runs it with the verified identity, and validates the output. Expected failures come back
 * as `{ ok: false }`; only genuine bugs throw.
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
  const result = await tool.execute(ctx, input.data);
  return result.ok ? { ok: true, data: tool.output.parse(result.data) } : result;
}
