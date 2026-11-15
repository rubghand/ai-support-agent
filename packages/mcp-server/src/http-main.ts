import { loadConfig } from "@app/core";
import { createDb } from "@app/db";
import { createHttpServer } from "./http";

const secret = process.env.MCP_TOKEN_SECRET;
if (!secret || secret.length < 16) {
  console.error("Set MCP_TOKEN_SECRET (at least 16 characters): openssl rand -base64 32");
  process.exit(1);
}
const port = Number(process.env.MCP_PORT ?? 3333);
const { db } = createDb(loadConfig().DATABASE_URL);
// Loopback only: the app talks to it locally; expose it deliberately, behind TLS, if ever needed.
createHttpServer({ db, tokenSecret: secret }).listen(port, "127.0.0.1", () => {
  console.log(`MCP server listening on http://127.0.0.1:${port}/mcp`);
});
