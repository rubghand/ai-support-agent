import { listConversations } from "@app/core";
import Link from "next/link";
import { Suspense } from "react";
import { formatTime, formatUsd, requireAdmin } from "@/lib/admin";
import { getServices } from "@/lib/services";

export default function ConversationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Conversations</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Conversations />
      </Suspense>
    </main>
  );
}

async function Conversations() {
  await requireAdmin();
  const rows = await listConversations(getServices().db, { limit: 100 });
  if (rows.length === 0) return <p className="text-sm text-zinc-500">No conversations yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500">
        <tr>
          <th className="py-1 font-normal">First question</th>
          <th className="py-1 font-normal">Customer</th>
          <th className="py-1 font-normal">Msgs</th>
          <th className="py-1 font-normal">Feedback</th>
          <th className="py-1 font-normal">Cost</th>
          <th className="py-1 font-normal">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-zinc-200 align-top">
            <td className="max-w-xs py-2 pr-4">
              <Link href={`/admin/conversations/${c.id}`} className="underline">
                {c.firstQuestion?.slice(0, 80) ?? "(empty)"}
              </Link>
            </td>
            <td className="py-2 pr-4 text-zinc-600">{c.userEmail}</td>
            <td className="py-2 pr-4 text-zinc-600">{c.messageCount}</td>
            <td className="py-2 pr-4 text-zinc-600">
              {c.thumbsUp > 0 && `👍 ${c.thumbsUp} `}
              {c.thumbsDown > 0 && `👎 ${c.thumbsDown}`}
              {c.thumbsUp + c.thumbsDown === 0 && "—"}
            </td>
            <td className="py-2 pr-4 text-zinc-600">{formatUsd(c.projectedCostUsd)}</td>
            <td className="py-2 text-zinc-600">{formatTime(c.lastMessageAt ?? c.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
