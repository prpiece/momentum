import { useState } from "react";
import { niceScale, type Bucket } from "../../domain/stats";

/**
 * Single-series column chart: thin bars with rounded data-ends on a recessive grid, a hover
 * tooltip per bar (big hit targets), sparse x labels, and a visually hidden table for
 * screen readers. One series, so no legend: the section title names it.
 */
export function BarChart(props: {
  data: Bucket[];
  label: (b: Bucket) => string;
  /** Short x-axis tick text; return "" to skip a tick. */
  tick: (b: Bucket, i: number) => string;
  format?: (v: number) => string;
  color?: string;
  title: string;
  height?: number;
  /** viewBox width: narrower for half-width cards so text keeps its size. */
  width?: number;
}) {
  const { data, format = String, color = "var(--accent)", height = 180 } = props;
  const [hover, setHover] = useState<number | null>(null);
  const W = props.width ?? 640;
  const H = height;
  const padL = 28;
  const padB = 20;
  const plotW = W - padL;
  const plotH = H - padB - 8;
  const { top, step } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const slot = plotW / data.length;
  const barW = Math.max(4, Math.min(18, slot * 0.5));
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={props.title} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--fg-muted)] font-mono text-[10px]">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.start} onMouseEnter={() => setHover(i)}>
              {/* Full-height hit target, larger than the mark. */}
              <rect x={padL + i * slot} y={8} width={slot} height={plotH} fill="transparent" />
              {d.value > 0 && (
                <path
                  d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  className="anim-grow-y transition-opacity duration-[var(--dur)]"
                  style={{ animationDelay: `${i * 25}ms` }}
                />
              )}
              <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-[var(--fg-muted)] text-[10px]">
                {props.tick(d, i)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          role="tooltip"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-xs text-bg shadow-lg"
          style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }}
        >
          <span className="font-semibold">{format(data[hover].value)}</span> · {props.label(data[hover])}
        </div>
      )}
      {/* A table ignores sr-only's 1px height and would stretch the page; the wrapping div clips it. */}
      <div className="sr-only">
        <table>
          <caption>{props.title}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.start}>
                <th scope="row">{props.label(d)}</th>
                <td>{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
