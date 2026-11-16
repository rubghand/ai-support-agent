import { describe, expect, it } from "vitest";
import { type ChatEvent, encodeSse, parseSse } from "./events";

function streamOf(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: ChatEvent[] = [];
  for await (const event of parseSse(stream)) events.push(event);
  return events;
}

describe("SSE encode/parse", () => {
  const events: ChatEvent[] = [
    { type: "meta", conversationId: "c1" },
    { type: "token", text: "Héllo\nworld 👋" },
    {
      type: "done",
      confidence: "high",
      needsHuman: false,
      grounded: true,
      model: "m",
      latencyMs: 5,
      messageId: 9,
    },
  ];
  const wire = events.map(encodeSse).join("");

  it.each([1, 3, 7, 1000])("round-trips with %i-byte chunks (incl. split UTF-8)", async (size) => {
    expect(await collect(streamOf(wire, size))).toEqual(events);
  });

  it("handles CRLF framing", async () => {
    expect(await collect(streamOf(wire.replaceAll("\n", "\r\n"), 5))).toEqual(events);
  });
});
