import { loadConfig } from "@app/core";
import { createDb } from "@app/db";
import { createHttpServer } from "./http";

const secret = process.env.MCP_TOKEN_SECRET;
if (!secret || secret.length < 16) {
  console.error("Set MCP_TOKEN_SECRET (at least 16 characters): openssl rand -base64 32");
  process.exit(1);
}
const port = Number(process.env.MCP_PORT ?? 3333);
// Loopback by default. Containers set MCP_HOST=0.0.0.0 and publish the port on the host's loopback only;
// expose it beyond that deliberately, behind TLS.
const host = process.env.MCP_HOST ?? "127.0.0.1";
const { db } = createDb(loadConfig().DATABASE_URL);
createHttpServer({ db, tokenSecret: secret }).listen(port, host, () => {
  console.log(`MCP server listening on http://${host}:${port}/mcp`);
});
