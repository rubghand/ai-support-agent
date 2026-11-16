/** Dependency-free bar chart: one column per label, height relative to the largest value. */
export function BarChart({
  title,
  points,
  format,
}: {
  title: string;
  points: { label: string; value: number }[];
  format: (value: number) => string;
}) {
  const max = Math.max(...points.map((p) => p.value), 0);
  return (
    <figure className="rounded-lg border border-zinc-200 bg-white p-4">
      <figcaption className="mb-3 text-sm font-medium text-zinc-600">{title}</figcaption>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={title}>
        {points.map((p) => (
          <div
            key={p.label}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${p.label}: ${format(p.value)}`}
          >
            <div
              className="min-h-px w-full rounded-t bg-zinc-800"
              style={{
                height: max === 0 ? "1px" : `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>{points[0]?.label.slice(5)}</span>
        <span>peak {format(max)}</span>
        <span>{points.at(-1)?.label.slice(5)}</span>
      </div>
    </figure>
  );
}
