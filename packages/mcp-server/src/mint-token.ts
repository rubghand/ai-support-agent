import { loadConfig } from "@app/core";
import { createDb, users } from "@app/db";
import { eq } from "drizzle-orm";
import { mintIdentityToken } from "./identity-token";

/** Dev helper: prints a 1-hour token for a seeded user, for MCP Inspector or curl. */
const secret = process.env.MCP_TOKEN_SECRET;
const email = process.argv[2];
if (!secret || !email) {
  console.error("Usage: MCP_TOKEN_SECRET=... npm run mcp:token -- user@example.com");
  process.exit(1);
}
const { db, close } = createDb(loadConfig().DATABASE_URL);
const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
await close();
if (!user) {
  console.error(`No user ${email}`);
  process.exit(1);
}
console.log(
  mintIdentityToken({ userId: user.id, role: user.role, customerId: user.customerId }, secret, {
    ttlSeconds: 3600,
  }),
);
