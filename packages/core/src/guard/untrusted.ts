const escapeAttr = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("\n", " ");

/**
 * Wraps text that did not come from us (doc chunks, tool results, conversation summaries) in a tag
 * the system prompt describes as data. Any closing tag inside the text is broken up, so the content
 * can't end the block early and pose as instructions.
 */
export function wrapUntrusted(tag: string, content: string, attrs: Record<string, string> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join("");
  const closing = new RegExp(`</(\\s*${tag})`, "gi");
  return `<${tag}${attrText}>\n${content.replace(closing, "</ $1")}\n</${tag}>`;
}
