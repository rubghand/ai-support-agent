"use client";

import { type ChatEvent, type Citation, parseSse } from "@app/core/client";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

interface UiMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  needsHuman?: boolean;
  grounded?: boolean;
  streaming?: boolean;
  error?: boolean;
}

export function ChatWidget() {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);
  const nextId = useRef(1);

  const patchLast = (patch: (m: UiMessage) => UiMessage) =>
    setMessages((all) => all.map((m, i) => (i === all.length - 1 ? patch(m) : m)));

  const apply = (event: ChatEvent) => {
    switch (event.type) {
      case "meta":
        conversationId.current = event.conversationId;
        break;
      case "token":
        patchLast((m) => ({ ...m, text: m.text + event.text }));
        break;
      case "citations":
        patchLast((m) => ({ ...m, text: event.answer, citations: event.citations }));
        break;
      case "done":
        patchLast((m) => ({
          ...m,
          streaming: false,
          needsHuman: event.needsHuman,
          grounded: event.grounded,
        }));
        break;
      case "error":
        patchLast((m) => ({ ...m, streaming: false, error: true, text: event.message }));
        break;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled chat event: ${JSON.stringify(unhandled)}`);
      }
    }
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((all) => [
      ...all,
      { id: nextId.current++, role: "user", text: message, citations: [] },
      { id: nextId.current++, role: "assistant", text: "", citations: [], streaming: true },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: conversationId.current }),
      });
      if (res.status === 429) {
        const { retryAfterSeconds } = (await res.json()) as { retryAfterSeconds: number };
        apply({
          type: "error",
          message: `You're sending messages too fast. Try again in ${retryAfterSeconds}s.`,
        });
        return;
      }
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      for await (const event of parseSse(res.body)) apply(event);
    } catch {
      apply({ type: "error", message: "Couldn't reach support. Please try again." });
    } finally {
      patchLast((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  }

  return (
    <section className="flex h-[36rem] w-full max-w-xl flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-200 px-4 py-3 font-medium">Ledgerly Support</header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">Ask about billing, invoices, integrations, or your account.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end" : "self-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-zinc-900 text-white"
                  : m.error
                    ? "bg-red-50 text-red-700"
                    : "bg-zinc-100 text-zinc-900"
              }`}
            >
              {m.text || (m.streaming ? "…" : "")}
            </div>
            {m.citations.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1">
                {m.citations.map((c) => (
                  <li key={c.chunkId}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      [{c.label}] {c.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {m.needsHuman && (
              <p className="mt-1 text-xs text-amber-700">A human agent should follow up on this one.</p>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-zinc-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          maxLength={2000}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <button
        type="button"
        onClick={() =>
          setMessages((all) => [
            ...all,
            {
              id: nextId.current++,
              role: "assistant",
              text: "A human agent will be with you soon. (Stub: handoff is wired up in a later phase.)",
              citations: [],
            },
          ])
        }
        className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
      >
        Talk to a human
      </button>
    </section>
  );
}
