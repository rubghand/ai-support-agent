import { describe, expect, it } from "vitest";
import { mintIdentityToken, verifyIdentityToken } from "./identity-token";

const identity = { userId: 7, role: "customer" as const, customerId: "CUS-001" };
const secret = "unit-test-secret-0123456789";
const now = Date.parse("2026-01-01T00:00:00Z");

describe("identity tokens", () => {
  it("round-trips an identity", () => {
    const token = mintIdentityToken(identity, secret, { now });
    expect(verifyIdentityToken(token, secret, now + 1000)).toEqual(identity);
  });

  it("rejects expired tokens", () => {
    const token = mintIdentityToken(identity, secret, { now, ttlSeconds: 60 });
    expect(verifyIdentityToken(token, secret, now + 61_000)).toBeNull();
  });

  it("rejects a wrong secret and tampered payloads (privilege escalation)", () => {
    const token = mintIdentityToken(identity, secret, { now });
    expect(verifyIdentityToken(token, "another-secret-0123456789", now)).toBeNull();
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ uid: 7, role: "admin", cid: null, exp: now / 1000 + 300 }),
    ).toString("base64url");
    expect(verifyIdentityToken(`${forged}.${signature}`, secret, now)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", "a.b.c", "."]) expect(verifyIdentityToken(bad, secret, now)).toBeNull();
  });
});
