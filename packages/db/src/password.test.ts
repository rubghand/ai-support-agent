import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects others", () => {
    const hash = hashPassword("demo1234", "a@b.example");
    expect(verifyPassword("demo1234", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
  it("is reproducible per salt seed and differs across seeds", () => {
    expect(hashPassword("x", "s1")).toBe(hashPassword("x", "s1"));
    expect(hashPassword("x", "s1")).not.toBe(hashPassword("x", "s2"));
  });
  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "plaintext")).toBe(false);
  });
});
