import { createHash, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

/** Deterministic salt (derived from `saltSeed`) so seeded demo hashes are reproducible; use a random seed for real users. */
export function hashPassword(password: string, saltSeed: string): string {
  const salt = createHash("sha256").update(saltSeed).digest().subarray(0, 16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, KEY_LENGTH).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
