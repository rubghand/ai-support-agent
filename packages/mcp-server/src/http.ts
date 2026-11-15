import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Db } from "@app/db";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { verifyIdentityToken } from "./identity-token";
import { createMcpServer } from "./server";

const MAX_BODY_BYTES = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Stateless Streamable HTTP endpoint at POST /mcp. Every request must carry a valid identity token
 * (`Authorization: Bearer <token>`); a fresh MCP server bound to that identity handles it.
 */
export function createHttpServer({ db, tokenSecret }: { db: Db; tokenSecret: string }): Server {
  return createServer(async (req, res) => {
    try {
      if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
        return send(res, 404, { error: "Not found" });
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const identity = bearer ? verifyIdentityToken(bearer, tokenSecret) : null;
      if (!identity) {
        return send(
          res,
          401,
          { error: "Missing or invalid identity token" },
          { "WWW-Authenticate": "Bearer" },
        );
      }
      if (req.method !== "POST") {
        return send(res, 405, { error: "Use POST" }, { Allow: "POST" });
      }

      const body = await readJson(req);
      const server = createMcpServer({ db, identity });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("mcp http error", error);
      if (!res.headersSent) send(res, 400, { error: "Bad request" });
    }
  });
}
