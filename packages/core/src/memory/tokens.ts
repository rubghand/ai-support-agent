import { type Tiktoken, getEncoding } from "js-tiktoken";

/** Chat-format overhead per message (role and separators), as in OpenAI's counting guide. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

let encoder: Tiktoken | undefined;

/**
 * cl100k_base token count. Qwen, Gemini and Claude use other tokenizers, so this is an estimate
 * (within roughly 10-20% for English), which is enough for a history budget with headroom.
 */
export function countTokens(text: string): number {
  encoder ??= getEncoding("cl100k_base");
  return encoder.encode(text).length;
}

export function truncateToTokens(text: string, maxTokens: number): string {
  encoder ??= getEncoding("cl100k_base");
  const tokens = encoder.encode(text);
  return tokens.length <= maxTokens ? text : encoder.decode(tokens.slice(0, maxTokens)).trimEnd();
}
