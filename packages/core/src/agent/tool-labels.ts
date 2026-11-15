/** Human-readable status line for a tool call, shown to the customer while it runs. */
export function describeToolCall(name: string, args: unknown): string {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof a[key] === "string" ? (a[key] as string) : null);
  switch (name) {
    case "search_docs": {
      const query = text("query");
      return query ? `Searching the help docs for “${query.slice(0, 60)}”…` : "Searching the help docs…";
    }
    case "lookup_order":
      return text("orderId") ? `Looking up order ${text("orderId")}…` : "Looking up your order…";
    case "create_ticket":
      return "Opening a support ticket…";
    case "escalate_to_human":
      return "Contacting a human agent…";
    case "request_refund":
      return text("orderId") ? `Filing a refund request for ${text("orderId")}…` : "Filing a refund request…";
    default:
      return `Running ${name}…`;
  }
}
