import { type ActionStatus, listActions } from "@app/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";
import { decide } from "./actions";

const STATUS_STYLE: Record<ActionStatus, string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-sky-100 text-sky-900",
  executed: "bg-emerald-100 text-emerald-900",
  rejected: "bg-zinc-200 text-zinc-800",
  failed: "bg-red-100 text-red-900",
};

const formatTime = (date: Date | null) =>
  date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "";

export default function ApprovalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <Link href="/" className="text-sm text-zinc-600 underline">
          Back to chat
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Approvals />
      </Suspense>
    </main>
  );
}

async function Approvals() {
  // auth() uses crypto.getRandomValues, which Next refuses during prerender; render per request.
  await connection();
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/");
  const { db } = getServices();
  const [open, decided] = await Promise.all([listActions(db, "open"), listActions(db, "decided", 20)]);

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">Waiting for a decision ({open.length})</h2>
        {open.length === 0 && <p className="text-sm text-zinc-500">Nothing to review.</p>}
        {open.map((a) => (
          <article key={a.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{a.summary}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  #{a.id} · {a.toolName} · requested by {a.requesterEmail} · {formatTime(a.createdAt)}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>{a.status}</span>
            </div>
            {typeof a.args.reason === "string" && (
              <p className="mt-3 text-sm text-zinc-700">
                <span className="text-zinc-500">Customer&apos;s reason:</span> {a.args.reason}
              </p>
            )}
            <form action={decide} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="actionId" value={a.id} />
              <input
                name="note"
                maxLength={500}
                placeholder="Note to the customer (optional)"
                aria-label="Note to the customer"
                className="min-w-64 flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                name="decision"
                value="approve"
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800"
              >
                Approve
              </button>
              <button
                type="submit"
                name="decision"
                value="reject"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Reject
              </button>
            </form>
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Recent decisions</h2>
        {decided.length === 0 && <p className="text-sm text-zinc-500">No decisions yet.</p>}
        {decided.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Request</th>
                <th className="py-1 font-normal">Status</th>
                <th className="py-1 font-normal">Decided by</th>
                <th className="py-1 font-normal">When</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((a) => (
                <tr key={a.id} className="border-t border-zinc-200 align-top">
                  <td className="py-2 pr-4">
                    {a.summary}
                    {a.decisionNote && <p className="text-xs text-zinc-500">Note: {a.decisionNote}</p>}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-600">{a.deciderEmail ?? "—"}</td>
                  <td className="py-2 text-zinc-600">{formatTime(a.decidedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
