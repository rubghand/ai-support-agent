import { getDashboardStats } from "@app/core";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart } from "@/components/admin/bar-chart";
import { formatMs, formatUsd, requireAdmin } from "@/lib/admin";
import { latestEvalRun } from "@/lib/evals";
import { getServices } from "@/lib/services";

const DAYS = 14;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}

async function Overview() {
  await requireAdmin();
  const [stats, evalRun] = await Promise.all([getDashboardStats(getServices().db, DAYS), latestEvalRun()]);
  const { totals, feedback } = stats;
  const rated = feedback.up + feedback.down;
  const routedTotal = stats.routing.reduce((sum, r) => sum + r.calls, 0);

  return (
    <>
      <p className="-mt-3 text-sm text-zinc-500">
        Last {stats.days} days. Costs are projected at cloud list prices (local models cost $0).
      </p>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Chat requests" value={String(totals.requests)} hint={`${totals.errors} failed`} />
        <Stat label="Conversations" value={String(totals.conversations)} />
        <Stat
          label="Latency (avg / p95)"
          value={formatMs(totals.avgLatencyMs)}
          hint={`p95 ${formatMs(totals.p95LatencyMs)}`}
        />
        <Stat
          label="Projected cost"
          value={formatUsd(totals.projectedCostUsd)}
          hint={`${totals.inputTokens.toLocaleString()} in / ${totals.outputTokens.toLocaleString()} out tokens`}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <BarChart
          title="Requests per day"
          points={stats.daily.map((d) => ({ label: d.day, value: d.requests }))}
          format={String}
        />
        <BarChart
          title="Avg latency per day"
          points={stats.daily.map((d) => ({ label: d.day, value: d.avgLatencyMs }))}
          format={formatMs}
        />
        <BarChart
          title="Projected cost per day"
          points={stats.daily.map((d) => ({ label: d.day, value: d.projectedCostUsd }))}
          format={formatUsd}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-600">Model routing (answer calls)</h2>
          {stats.routing.length === 0 && <p className="text-sm text-zinc-500">No calls yet.</p>}
          <ul className="flex flex-col gap-2">
            {stats.routing.map((r) => (
              <li key={`${r.tier}-${r.model}`} className="text-sm">
                <div className="flex justify-between">
                  <span>
                    {r.tier} <span className="text-zinc-500">({r.model})</span>
                  </span>
                  <span className="text-zinc-600">
                    {r.calls} · {percent(r.calls / routedTotal)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-zinc-100">
                  <div
                    className="h-full rounded bg-zinc-800"
                    style={{ width: percent(r.calls / routedTotal) }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <h3 className="mb-1 mt-4 text-xs font-medium text-zinc-500">All model calls by purpose</h3>
          <table className="w-full text-left text-xs">
            <tbody>
              {stats.purposes.map((p) => (
                <tr key={p.purpose} className="border-t border-zinc-100">
                  <td className="py-1">{p.purpose}</td>
                  <td className="py-1 text-zinc-600">{p.calls} calls</td>
                  <td className="py-1 text-zinc-600">avg {formatMs(p.avgLatencyMs)}</td>
                  <td className="py-1 text-right text-zinc-600">{formatUsd(p.projectedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-600">Quality</h2>
          <p className="text-sm">
            Customer feedback: 👍 {feedback.up} · 👎 {feedback.down}
            {rated > 0 && <span className="text-zinc-500"> ({percent(feedback.up / rated)} positive)</span>}
          </p>
          {evalRun ? (
            <div className="mt-3">
              <p className="text-sm">
                Latest eval: <span className="font-medium">{evalRun.label}</span>{" "}
                <span className="text-zinc-500">
                  ({evalRun.cases} cases, tier {evalRun.tier}
                  {evalRun.rerank ? ", rerank" : ""})
                </span>
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Behavior {percent(evalRun.behaviorRate)}
                {evalRun.groundedRate !== null && <> · Grounded {percent(evalRun.groundedRate)}</>} · avg{" "}
                {formatMs(evalRun.avgLatencyMs)} · {formatUsd(evalRun.totalCostUsd)} projected
              </p>
              <table className="mt-2 w-full text-left text-xs">
                <tbody>
                  {evalRun.categories.map((c) => (
                    <tr key={c.category} className="border-t border-zinc-100">
                      <td className="py-1">{c.category}</td>
                      <td className="py-1 text-zinc-600">
                        {c.behaviorPassed}/{c.cases}
                      </td>
                      <td className="py-1 text-red-700">{c.failedIds.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No eval run found. Run `npm run eval`.</p>
          )}
        </div>
      </section>

      <p className="text-sm">
        <Link href="/admin/conversations" className="underline">
          Browse conversations
        </Link>
      </p>
    </>
  );
}
