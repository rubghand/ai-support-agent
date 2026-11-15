import type { ToolContext } from "@app/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";

/**
 * Connects an MCP client to a server bound to `ctx.identity`, inside the same process. It speaks the
 * real protocol (same schemas, same results as stdio/HTTP) without a second process or a token: the
 * identity comes from the session the caller already verified.
 */
export async function createInProcessClient(
  ctx: ToolContext,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(ctx);
  await server.connect(serverTransport);
  const client = new Client({ name: "ledgerly-agent", version: "0.1.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
