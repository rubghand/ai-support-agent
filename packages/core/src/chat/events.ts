import type { Citation } from "../rag/answer";

export type ChatTier = "small" | "large";

/** Wire format of `/api/chat`. Client-safe: no server imports besides types. */
export type ChatEvent =
  | { type: "meta"; conversationId: string }
  /** The agent started or finished a tool; `label` is customer-facing ("Looking up order ORD-1042…"). */
  | { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "failed" }
  | { type: "token"; text: string }
  | {
      type: "citations";
      citations: Citation[];
      /** The final text; differs from the streamed tokens when invalid citation markers were removed. */
      answer: string;
    }
  | {
      type: "done";
      confidence: "high" | "medium" | "low";
      needsHuman: boolean;
      grounded: boolean;
      model: string;
      latencyMs: number;
    }
  | { type: "error"; message: string };

export function encodeSse(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parses an SSE byte stream into events; tolerates chunk boundaries anywhere, including mid-frame. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseFrame = (frame: string): ChatEvent | null => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data ? (JSON.parse(data) as ChatEvent) : null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
      }
    }
    const rest = parseFrame(buffer);
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}
