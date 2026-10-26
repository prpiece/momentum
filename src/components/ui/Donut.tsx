import { useState } from "react";

export type Slice = { label: string; value: number; color: string };

/** Part-to-whole ring with a legend (labels + values, so identity never rests on color alone). */
export function Donut({ data, title, center }: { data: Slice[]; title: string; center: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((n, s) => n + s.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const gap = total && data.filter((s) => s.value).length > 1 ? 3 : 0;
  let offset = 0;
  const shown = hover !== null ? data[hover] : null;

  return (
    <figure className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 128 128" className="size-36 shrink-0 -rotate-90" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        <circle cx={64} cy={64} r={R} fill="none" stroke="var(--hover)" strokeWidth={14} />
        {data.map((s, i) => {
          const len = total ? (s.value / total) * C : 0;
          const dash = Math.max(0, len - gap);
          const el = s.value ? (
            <circle
              key={s.label}
              cx={64}
              cy={64}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? 18 : 14}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              onMouseEnter={() => setHover(i)}
              className="transition-[stroke-width,opacity] duration-[var(--dur)]"
              opacity={hover === null || hover === i ? 1 : 0.4}
            />
          ) : null;
          offset += len;
          return el;
        })}
        <g className="rotate-90" style={{ transformOrigin: "64px 64px" }}>
          <text x={64} y={62} textAnchor="middle" className="fill-[var(--fg)] font-mono text-[22px] font-semibold">
            {shown ? shown.value : total}
          </text>
          <text x={64} y={80} textAnchor="middle" className="fill-[var(--fg-muted)] text-[10px]">
            {shown ? shown.label : center}
          </text>
        </g>
      </svg>
      <ul className="min-w-36 flex-1 space-y-1.5 text-sm">
        {data.map((s, i) => (
          <li key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={`flex items-center gap-2 rounded-sm px-1.5 py-0.5 transition-colors ${hover === i ? "bg-hover" : ""}`}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 text-fg-2">{s.label}</span>
            <span className="font-mono text-xs text-fg">{s.value}</span>
            <span className="w-9 text-right font-mono text-[0.7rem] text-muted">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
