import { redactPii } from "./pii";

export type OutputViolation = "uncited" | "prompt_leak" | "credential_request" | "false_approval";

export interface OutputCheckInput {
  answer: string;
  kind: "answer" | "clarify" | "refuse";
  grounded: boolean;
  /** A tool result this turn shows an approved refund (then saying so is true, not a hallucination). */
  approvalConfirmed?: boolean;
  /** Text that must never be repeated to the customer (system prompts). */
  protectedTexts: readonly string[];
}

export interface OutputCheck {
  violations: OutputViolation[];
  /** The text to send: the original (with card numbers redacted), or a safe replacement. */
  answer: string;
  /** Set when the replacement needs staff to follow up. */
  needsHuman: boolean;
  /** True when the model's text was replaced. */
  replaced: boolean;
}

const SHINGLE = 8;
/** Copied words needed to count as a leak; one shared safety sentence ("never share your password...") is fine. */
const LEAK_MIN_COPIED_WORDS = 20;
const INTERNAL_TOOL_NAMES = [
  "search_docs",
  "lookup_order",
  "create_ticket",
  "escalate_to_human",
  "request_refund",
];

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function copiedWordCount(answer: string, protectedTexts: readonly string[]): number {
  const shingles = new Set<string>();
  for (const text of protectedTexts) {
    const w = words(text);
    for (let i = 0; i + SHINGLE <= w.length; i++) shingles.add(w.slice(i, i + SHINGLE).join(" "));
  }
  const a = words(answer);
  const copied = new Array<boolean>(a.length).fill(false);
  for (let i = 0; i + SHINGLE <= a.length; i++) {
    if (shingles.has(a.slice(i, i + SHINGLE).join(" "))) copied.fill(true, i, i + SHINGLE);
  }
  return copied.filter(Boolean).length;
}

export function leaksPrompt(answer: string, protectedTexts: readonly string[]): boolean {
  const toolNames = INTERNAL_TOOL_NAMES.filter((name) => answer.includes(name)).length;
  return toolNames >= 2 || copiedWordCount(answer, protectedTexts) >= LEAK_MIN_COPIED_WORDS;
}

const CREDENTIAL_ASK =
  /\b(send|email|e-mail|share|provide|give|enter|type|reply\s+with|confirm|verify)\b[^.?!\n]{0,60}\b(passwords?|passcodes?|card\s+numbers?|cvv|cvc|security\s+codes?)\b/gi;
const NEGATION = /\b(never|not|don't|do\s+not|no\s+one|nobody|won't|will\s+not)\b/i;

/** Asking the customer for secrets is what a successful indirect injection looks like (see the poisoned sync doc). */
export function requestsCredentials(answer: string): boolean {
  for (const match of answer.matchAll(CREDENTIAL_ASK)) {
    const before = answer.slice(Math.max(0, match.index - 30), match.index);
    if (!NEGATION.test(before) && !NEGATION.test(match[0])) return true;
  }
  return false;
}

/** The agent never approves anything itself; refunds are decided by staff, so only a tool result can confirm one. */
const APPROVAL_CLAIM =
  /\brefund\b[^.?!\n]{0,40}?\b(has\s+been|was|is\s+now|is)\s+(approved|issued|processed|completed)\b|\b(i\s+have|i've|we\s+have|we've)\s+(approved|issued)\b/i;

export function claimsApproval(answer: string): boolean {
  return APPROVAL_CLAIM.test(answer);
}

export const OUTPUT_REPLACEMENTS: Record<OutputViolation, { text: string; needsHuman: boolean }> = {
  uncited: {
    text: "I couldn't find a reliable answer to that in our help docs, so I won't guess. I've flagged this for our support team to follow up.",
    needsHuman: true,
  },
  prompt_leak: {
    text: "Sorry, I can't share details about how I'm set up. I'm happy to help with any Ledgerly question.",
    needsHuman: false,
  },
  credential_request: {
    text: "Sorry, something went wrong with my reply. Ledgerly will never ask you for your password or full card number. I've flagged this for our support team.",
    needsHuman: true,
  },
  false_approval: {
    text: "Refunds are always reviewed by our staff, so I can't approve one myself. I've flagged this for our support team, and you'll be notified here once they decide.",
    needsHuman: true,
  },
};

/** Most severe first: that one picks the replacement text. */
const SEVERITY: OutputViolation[] = ["credential_request", "prompt_leak", "false_approval", "uncited"];

/**
 * Last check before the customer sees a reply: it must cite (or come from a tool) unless it is an
 * explicit refusal or clarifying question, must not repeat the system prompt, ask for secrets, or
 * claim an approval that only staff can give. Violations replace the text with a fixed safe reply.
 */
export function checkOutput({
  answer,
  kind,
  grounded,
  approvalConfirmed = false,
  protectedTexts,
}: OutputCheckInput): OutputCheck {
  const found = new Set<OutputViolation>();
  if (kind === "answer" && !grounded) found.add("uncited");
  if (leaksPrompt(answer, protectedTexts)) found.add("prompt_leak");
  if (requestsCredentials(answer)) found.add("credential_request");
  if (!approvalConfirmed && claimsApproval(answer)) found.add("false_approval");
  const violations = SEVERITY.filter((v) => found.has(v));
  const worst = violations[0];
  if (worst) {
    const replacement = OUTPUT_REPLACEMENTS[worst];
    return { violations, answer: replacement.text, needsHuman: replacement.needsHuman, replaced: true };
  }
  return { violations, answer: redactPii(answer, ["card"]).text, needsHuman: false, replaced: false };
}
