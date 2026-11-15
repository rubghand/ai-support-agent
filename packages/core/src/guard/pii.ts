export type PiiKind = "card" | "email" | "phone";

export const PII_PLACEHOLDERS: Record<PiiKind, string> = {
  card: "[card number removed]",
  email: "[email removed]",
  phone: "[phone removed]",
};

/** Luhn checksum, so order numbers and other long digit runs are not mistaken for cards. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD = /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Grouped digits with separators, optionally with a +country code: "555 123 4567", "+1 (555) 123-4567".
// The lookbehind skips ids such as ORD-1042; dates and amounts don't fit the group sizes.
const PHONE =
  /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?![\w-])/g;

export interface Redaction {
  text: string;
  found: PiiKind[];
}

/** Replaces card numbers (Luhn-checked), emails and phone numbers with placeholders. */
export function redactPii(text: string, kinds: readonly PiiKind[] = ["card", "email", "phone"]): Redaction {
  const found = new Set<PiiKind>();
  let out = text;
  if (kinds.includes("card")) {
    out = out.replace(CARD, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19 || !isLuhnValid(digits)) return match;
      found.add("card");
      return PII_PLACEHOLDERS.card;
    });
  }
  if (kinds.includes("email")) {
    out = out.replace(EMAIL, () => {
      found.add("email");
      return PII_PLACEHOLDERS.email;
    });
  }
  if (kinds.includes("phone")) {
    out = out.replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, "").length;
      if (digits < 9 || digits > 15) return match;
      found.add("phone");
      return PII_PLACEHOLDERS.phone;
    });
  }
  return { text: out, found: [...found] };
}
