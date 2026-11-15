import { createTicket } from "./create-ticket";
import { escalateToHuman } from "./escalate";
import { lookupOrder } from "./lookup-order";
import { requestRefund } from "./request-refund";
import type { ToolDefinition } from "./types";

export const tools = [lookupOrder, createTicket, escalateToHuman, requestRefund] as const;
export type ToolName = (typeof tools)[number]["name"];

const byName = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t as unknown as ToolDefinition]));

export function getTool(name: string): ToolDefinition | undefined {
  return byName.get(name);
}
