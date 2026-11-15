import { createHmac, timingSafeEqual } from "node:crypto";
import type { Identity } from "@app/core";
import { z } from "zod";

const payloadSchema = z.object({
  uid: z.number().int(),
  role: z.enum(["customer", "admin"]),
  cid: z.string().nullable(),
  exp: z.number().int(),
});

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

/**
 * Short-lived, HMAC-signed proof of who is calling. The web app mints one per agent run after it has
 * verified the user's session; the MCP server trusts only this, never tool arguments.
 */
export function mintIdentityToken(
  identity: Identity,
  secret: string,
  { ttlSeconds = 300, now = Date.now() }: { ttlSeconds?: number; now?: number } = {},
): string {
  const body = Buffer.from(
    JSON.stringify({
      uid: identity.userId,
      role: identity.role,
      cid: identity.customerId,
      exp: Math.floor(now / 1000) + ttlSeconds,
    }),
  ).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the identity, or null for anything forged, malformed, or expired. */
export function verifyIdentityToken(token: string, secret: string, now = Date.now()): Identity | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let payload;
  try {
    payload = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    return null;
  }
  if (!payload.success || payload.data.exp * 1000 <= now) return null;
  return { userId: payload.data.uid, role: payload.data.role, customerId: payload.data.cid };
}
