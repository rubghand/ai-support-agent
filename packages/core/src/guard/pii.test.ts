import { describe, expect, it } from "vitest";
import { isLuhnValid, redactPii } from "./pii";

describe("isLuhnValid", () => {
  it("accepts real test card numbers and rejects others", () => {
    expect(isLuhnValid("4242424242424242")).toBe(true);
    expect(isLuhnValid("5555555555554444")).toBe(true);
    expect(isLuhnValid("4242424242424241")).toBe(false);
  });
});

describe("redactPii", () => {
  it("redacts Luhn-valid card numbers with spaces or dashes", () => {
    const out = redactPii("My card is 4242 4242 4242 4242, or 5555-5555-5555-4444.");
    expect(out.text).toBe("My card is [card number removed], or [card number removed].");
    expect(out.found).toEqual(["card"]);
  });

  it("leaves long digit runs that fail the Luhn check", () => {
    expect(redactPii("Reference 1234567890123456").text).toBe("Reference 1234567890123456");
  });

  it("redacts emails and phone numbers", () => {
    const out = redactPii(
      "Reach me at maya@example.com or +1 (555) 123-4567 / 555 123 4567 / +374 91 123456.",
    );
    expect(out.text).toBe(
      "Reach me at [email removed] or [phone removed] / [phone removed] / [phone removed].",
    );
    expect(out.found.sort()).toEqual(["email", "phone"]);
  });

  it("does not touch order ids, invoice numbers, dates, or amounts", () => {
    const text =
      "ORD-1042 for $1,200.00 on 2026-08-25, invoice INV-2026-0042, 14-day trial, 100 days, ticket #57";
    expect(redactPii(text)).toEqual({ text, found: [] });
  });

  it("can redact only selected kinds", () => {
    expect(redactPii("4242424242424242 support@ledgerly.example", ["card"]).text).toBe(
      "[card number removed] support@ledgerly.example",
    );
  });
});
