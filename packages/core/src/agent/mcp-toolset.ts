import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { type Tool, jsonSchema, tool } from "ai";

/** The slice of the MCP client the agent needs; lets tests pass a fake. */
export type McpClientLike = Pick<Client, "listTools" | "callTool">;

export interface McpToolset {
  /** AI SDK tool definitions without `execute`: the loop runs them itself, through MCP. */
  definitions: Record<string, Tool>;
  /** Tools the server marks `_meta.risk = "high"`: they change money or accounts and always involve staff. */
  highRisk: ReadonlySet<string>;
  call(
    name: string,
    args: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ ok: boolean; text: string }>;
}

export async function loadMcpToolset(client: McpClientLike): Promise<McpToolset> {
  const { tools } = await client.listTools();
  const definitions: Record<string, Tool> = {};
  const highRisk = new Set<string>();
  for (const t of tools) {
    if (t._meta?.risk === "high") highRisk.add(t.name);
    definitions[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
    });
  }
  return {
    definitions,
    highRisk,
    async call(name, args, { timeoutMs, signal } = {}) {
      const result = await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: timeoutMs, signal },
      );
      const content = Array.isArray(result.content)
        ? (result.content as Array<{ type: string; text?: string }>)
        : [];
      const text = content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
      return { ok: !result.isError, text };
    },
  };
}
