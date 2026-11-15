import { loadConfig } from "@app/core";
import { createDb, users } from "@app/db";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { eq } from "drizzle-orm";
import { createMcpServer } from "./server";

/**
 * Local stdio entry for MCP clients such as Cursor or Claude Desktop. The caller is whoever
 * MCP_USER_EMAIL names: the process is trusted because you launched it. Never log to stdout here;
 * it carries the protocol.
 */
const email = process.env.MCP_USER_EMAIL;
if (!email) {
  console.error("Set MCP_USER_EMAIL to a seeded user, e.g. maya@brightpixelstudio.example");
  process.exit(1);
}

const { db } = createDb(loadConfig().DATABASE_URL);
const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
if (!user) {
  console.error(`No user with email ${email}. Run npm run db:seed first.`);
  process.exit(1);
}

const server = createMcpServer({
  db,
  identity: { userId: user.id, role: user.role, customerId: user.customerId },
});
await server.connect(new StdioServerTransport());
console.error(`ledgerly MCP server (stdio) running as ${user.email} (${user.role})`);
