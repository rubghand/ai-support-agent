import { type ToolContext, executeTool, tools } from "@app/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

/**
 * Registers the Phase 9 tools on an MCP server. `ctx` (including the caller's identity) is fixed
 * when the server is created, so no tool call can change who it acts for.
 */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: `${tool.description}${tool.risk === "high" ? " (High risk: needs human approval before it takes effect.)" : ""}`,
        inputSchema: tool.input as unknown as AnySchema,
        _meta: { risk: tool.risk },
      },
      async (args: unknown) => {
        const result = await executeTool(ctx, tool.name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.data : result.error) }],
          isError: !result.ok,
        };
      },
    );
  }
}
