"use client";

import {
  type ActionStatus,
  type ActionUpdate,
  type ChatEvent,
  type Citation,
  type Rating,
  parseSse,
} from "@app/core/client";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

const APPROVAL_POLL_MS = 4000;

const APPROVAL_LABEL: Record<ActionStatus, string> = {
  pending: "Waiting for staff approval",
  approved: "Approved, processing…",
  executed: "Approved",
  rejected: "Declined by staff",
  failed: "Approved, but couldn't be completed",
};

const isOpen = (status: ActionStatus) => status === "pending" || status === "approved";

interface ToolStep {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
}

interface UiMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  tools: ToolStep[];
  approval?: { actionId: number; summary: string; status: ActionStatus };
  needsHuman?: boolean;
  grounded?: boolean;
  streaming?: boolean;
  error?: boolean;
  /** Saved assistant message id; feedback can only be given once it exists. */
  serverId?: number;
  rating?: Rating;
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

  // Staff decide asynchronously; poll open requests and post the outcome as a new assistant message.
  const waitingIds = messages
    .flatMap((m) => (m.approval && isOpen(m.approval.status) ? [m.approval.actionId] : []))
    .join(",");
  useEffect(() => {
    if (!waitingIds) return;
    const ids = waitingIds.split(",").map(Number);
    const timer = setInterval(async () => {
      for (const actionId of ids) {
        const res = await fetch(`/api/actions/${actionId}`, { cache: "no-store" }).catch(() => null);
        if (!res?.ok) continue;
        const update = (await res.json()) as ActionUpdate;
        if (update.message === null) continue;
        const text = update.message;
        const id = nextId.current++;
        setMessages((all) => {
          const open = all.some((m) => m.approval?.actionId === actionId && isOpen(m.approval.status));
          if (!open) return all;
          return [
            ...all.map((m) =>
              m.approval?.actionId === actionId
                ? { ...m, approval: { ...m.approval, status: update.status } }
                : m,
            ),
            { id, role: "assistant", text, citations: [], tools: [] },
          ];
        });
      }
    }, APPROVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [waitingIds]);

  const apply = (event: ChatEvent) => {
    switch (event.type) {
      case "meta":
        conversationId.current = event.conversationId;
        break;
      case "tool":
        patchLast((m) => ({
          ...m,
          tools: m.tools.some((t) => t.id === event.id)
            ? m.tools.map((t) => (t.id === event.id ? { ...t, status: event.status } : t))
            : [...m.tools, { id: event.id, label: event.label, status: event.status }],
        }));
        break;
      case "approval":
        patchLast((m) => ({
          ...m,
          approval: { actionId: event.actionId, summary: event.summary, status: "pending" },
        }));
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
          serverId: event.messageId,
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

  async function rate(localId: number, serverId: number, rating: Rating) {
    const previous = messages.find((m) => m.id === localId)?.rating;
    const set = (value: Rating | undefined) =>
      setMessages((all) => all.map((m) => (m.id === localId ? { ...m, rating: value } : m)));
    set(rating);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: serverId, rating }),
    }).catch(() => null);
    if (!res?.ok) set(previous);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((all) => [
      ...all,
      { id: nextId.current++, role: "user", text: message, citations: [], tools: [] },
      { id: nextId.current++, role: "assistant", text: "", citations: [], tools: [], streaming: true },
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
            {m.tools.length > 0 && (
              <ul className="mb-1 flex flex-col gap-0.5 text-xs text-zinc-500">
                {m.tools.map((t) => (
                  <li key={t.id}>
                    {t.status === "running" ? "⏳" : t.status === "done" ? "✓" : "✗"} {t.label}
                  </li>
                ))}
              </ul>
            )}
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
            {m.approval && (
              <div
                className={`mt-1 max-w-[85%] rounded-md border px-3 py-2 text-xs ${
                  m.approval.status === "executed"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : m.approval.status === "rejected" || m.approval.status === "failed"
                      ? "border-red-300 bg-red-50 text-red-900"
                      : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                <p className="font-medium">{APPROVAL_LABEL[m.approval.status]}</p>
                <p>{m.approval.summary}</p>
              </div>
            )}
            {m.serverId !== undefined && !m.streaming && !m.error && (
              <div className="mt-1 flex gap-1 text-xs" role="group" aria-label="Rate this answer">
                {(["up", "down"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={m.rating === value}
                    aria-label={value === "up" ? "Helpful" : "Not helpful"}
                    onClick={() => void rate(m.id, m.serverId!, value)}
                    className={`rounded border px-1.5 py-0.5 ${
                      m.rating === value
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {value === "up" ? "👍" : "👎"}
                  </button>
                ))}
              </div>
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
              tools: [],
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
