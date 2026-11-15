import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { type Db, createDb, generateSeedData, runMigrations, seedDatabase, users } from "@app/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "./http";
import { mintIdentityToken } from "./identity-token";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://agent:agent@localhost:5455/agent_test";
const SECRET = "integration-test-secret-0123456789";

describe("MCP server over HTTP", () => {
  let db: Db;
  let close: () => Promise<void>;
  let server: Server;
  let url: URL;

  const tokenFor = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return mintIdentityToken({ userId: u!.id, role: u!.role, customerId: u!.customerId }, SECRET);
  };

  async function connect(token: string) {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const [block] = result.content as Array<{ type: string; text: string }>;
    return { isError: Boolean(result.isError), body: JSON.parse(block!.text) as Record<string, unknown> };
  };

  beforeAll(async () => {
    ({ db, close } = createDb(TEST_DATABASE_URL));
    await runMigrations(db);
    await seedDatabase(db, generateSeedData());
    server = createHttpServer({ db, tokenSecret: SECRET });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  });
  afterAll(async () => {
    server.close();
    await close();
  });

  it("rejects requests without a valid identity token", async () => {
    const noAuth = await fetch(url, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toBe("Bearer");
    const forged = await fetch(url, { method: "POST", headers: { Authorization: "Bearer a.b" }, body: "{}" });
    expect(forged.status).toBe(401);
  });

  it("lists the four tools with risk metadata and no identity parameters", async () => {
    const client = await connect(await tokenFor("maya@brightpixelstudio.example"));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_ticket",
      "escalate_to_human",
      "lookup_order",
      "request_refund",
    ]);
    expect(tools.find((t) => t.name === "request_refund")?._meta).toMatchObject({ risk: "high" });
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("customerId");
    }
    await client.close();
  });

  it("runs lookup_order as the token's identity and hides other customers' orders", async () => {
    const maya = await connect(await tokenFor("maya@brightpixelstudio.example"));
    const own = await call(maya, "lookup_order", { orderId: "ORD-1042" });
    expect(own).toMatchObject({ isError: false, body: { id: "ORD-1042", status: "paid" } });
    await maya.close();

    const lucas = await connect(await tokenFor("lucas@moreauconsulting.example"));
    const other = await call(lucas, "lookup_order", { orderId: "ORD-1042" });
    expect(other).toMatchObject({ isError: true, body: { code: "not_found" } });
    await lucas.close();
  });

  it("files a refund request (high risk) for approval through MCP, and reports domain errors as tool errors", async () => {
    const lucas = await connect(await tokenFor("lucas@moreauconsulting.example"));
    const filed = await call(lucas, "request_refund", { orderId: "ORD-1043", reason: "Test" });
    expect(filed).toMatchObject({
      isError: false,
      body: { status: "pending_approval", summary: "Refund $384.00 for order ORD-1043 (Growth (annual))" },
    });
    const again = await call(lucas, "request_refund", { orderId: "ORD-1043", reason: "Again" });
    expect(again).toMatchObject({ isError: true, body: { code: "conflict" } });
    await lucas.close();
  });
});
