import type { ToolContext } from "@app/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "ledgerly-support-tools", version: "0.1.0" });
  registerTools(server, ctx);
  return server;
}
