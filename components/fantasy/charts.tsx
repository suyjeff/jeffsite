import React, { useEffect, useRef, useState } from 'react'
import { cx, fmt, fmtSigned, linePath } from './ui'

// Small SVG charts for the fantasy app. One axis each, hairline grid, thin
// marks with rounded-sm data ends, a 2px surface gap between touching marks, and
// a hover readout on every mark. Text stays in ink; color rides the marks.

/** Categorical slots in fixed order (validated palette, stepped per mode in fantasy.css). */
export const SERIES = ['s1', 's2', 's3', 's4', 's5'] as const
const fill = (slot: string) => `rgb(var(--ff-${slot}))`

/** Width of the chart's container, kept current as it resizes. */
const useWidth = (initial: number) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth && setW(el.clientWidth))
    ro.observe(el)
    if (el.clientWidth) setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const Tip = ({ x, y, children, width }: { x: number; y: number; children: React.ReactNode; width: number }) => (
  <span
    className="pointer-events-none absolute z-30 whitespace-nowrap rounded-sm bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel"
    style={{ left: Math.max(0, Math.min(x, width - 120)), top: Math.max(0, y - 24) }}
  >
    {children}
  </span>
)

export const Legend = ({ items }: { items: { label: string; slot: string; value?: string }[] }) => (
  <div className="flex flex-wrap gap-x-3 gap-y-1">
    {items.map((it) => (
      <span key={it.label} className="flex items-center gap-1.5 text-[11.5px] text-ff-text2">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: fill(it.slot) }} />
        {it.label}
        {it.value && <span className="num text-ff-text">{it.value}</span>}
      </span>
    ))}
  </div>
)

/** Distribution of one measure as columns from a shared baseline. */
export const Histogram = ({
  values,
  bins = 16,
  height = 120,
  format = (v: number) => fmt(v, 2),
  marker,
  markerLabel,
}: {
  values: number[]
  bins?: number
  height?: number
  format?: (v: number) => string
  /** Draw a reference line at this value (your player, the mean...). */
  marker?: number
  markerLabel?: string
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, w] = useWidth(480)
  if (!values.length) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const step = (hi - lo || 1) / bins
  const counts = Array.from({ length: bins }, () => 0)
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]++
  const maxC = Math.max(...counts, 1)
  const pad = { l: 28, r: 6, t: 8, b: 20 }
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const bw = iw / bins
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * iw
  const ticks = [0, Math.round(maxC / 2), maxC]
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} className="block" role="img" aria-label={`Histogram of ${values.length} values from ${format(lo)} to ${format(hi)}`}>
        {ticks.map((t) => {
          const y = pad.t + ih - (t / maxC) * ih
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} className="stroke-ff-line" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-ff-muted font-mono text-[9.5px]">
                {t}
              </text>
            </g>
          )
        })}
        {counts.map((c, i) => {
          const h = (c / maxC) * ih
          const bx = pad.l + i * bw + 1
          const width = Math.max(1, Math.min(24, bw - 2))
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
              {c > 0 && (
                <path
                  d={`M${bx},${pad.t + ih} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${Math.max(0, width - 6)} q3,0 3,3 v${Math.max(0, h - 3)} z`}
                  fill={fill('s1')}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
              )}
            </g>
          )
        })}
        <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} className="stroke-ff-line2" strokeWidth={1} />
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <text key={i} x={x(v)} y={height - 5} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="fill-ff-muted font-mono text-[9.5px]">
            {format(v)}
          </text>
        ))}
        {marker !== undefined && marker >= lo && marker <= hi && (
          <g>
            <line x1={x(marker)} x2={x(marker)} y1={pad.t} y2={pad.t + ih} className="stroke-ff-text" strokeWidth={1.5} />
            {markerLabel && (
              <text x={x(marker) + 4} y={pad.t + 9} className="fill-ff-text font-mono text-[10px]">
                {markerLabel}
              </text>
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tip x={pad.l + hover * bw} y={pad.t + ih - (counts[hover] / maxC) * ih} width={w}>
          {format(lo + hover * step)} to {format(lo + (hover + 1) * step)} · {counts[hover]}
        </Tip>
      )}
    </div>
  )
}

/** A few lines over a shared x axis, with end labels and a crosshair readout. */
export const MiniLines = ({
  xs,
  series,
  height = 150,
  yFormat = (v: number) => fmt(v, 2),
  xLabel = (x: number) => String(x),
  yMin,
  yMax,
}: {
  xs: number[]
  series: { label: string; slot: string; values: number[] }[]
  height?: number
  yFormat?: (v: number) => string
  xLabel?: (x: number) => string
  yMin?: number
  yMax?: number
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, w] = useWidth(480)
  const all = series.flatMap((s) => s.values)
  const lo = yMin ?? Math.min(...all)
  const hi = yMax ?? Math.max(...all)
  const pad = { l: 36, r: 84, t: 10, b: 20 }
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const x = (i: number) => pad.l + (xs.length === 1 ? iw / 2 : (i / (xs.length - 1)) * iw)
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} className="block" role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="stroke-ff-line" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-ff-muted font-mono text-[9.5px]">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xs.map((xv, i) =>
          i % Math.max(1, Math.ceil(xs.length / 8)) === 0 || i === xs.length - 1 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor="middle" className="fill-ff-muted font-mono text-[9.5px]">
              {xLabel(xv)}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="stroke-ff-line2" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.label}>
            <path
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={fill(s.slot)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r={4} fill={fill(s.slot)} className="stroke-ff-panel" strokeWidth={2} />
            <text x={x(s.values.length - 1) + 8} y={y(s.values[s.values.length - 1]) + 3} className="fill-ff-text2 text-[10.5px]">
              {s.label}
            </text>
            {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover])} r={4} fill={fill(s.slot)} className="stroke-ff-panel" strokeWidth={2} />}
          </g>
        ))}
        {xs.map((_, i) => (
          <rect key={i} x={x(i) - iw / xs.length / 2} y={pad.t} width={iw / xs.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <span className="pointer-events-none absolute z-30 rounded-sm bg-ff-text px-2 py-1 font-mono text-[10.5px] leading-relaxed text-ff-panel" style={{ left: Math.min(x(hover) + 8, w - 150), top: pad.t }}>
          <span className="block opacity-70">{xLabel(xs[hover])}</span>
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 " style={{ background: fill(s.slot) }} />
              {s.label} {yFormat(s.values[hover])}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/** A nice axis top: rounds up to a multiple of 10 (or 5 when the range is small). */
const niceTop = (v: number) => {
  const unit = v <= 30 ? 5 : 10
  return Math.max(unit * 2, Math.ceil(v / unit) * unit)
}

/** Hover readout: pinned beside the column and flipped to the other side near the right edge. */
const ColumnTip = ({ x, width, top, children }: { x: number; width: number; top: number; children: React.ReactNode }) => {
  const flip = x > width * 0.55
  return (
    <span
      className="pointer-events-none absolute z-30 rounded-sm bg-ff-text px-2 py-1 font-mono text-[10.5px] leading-relaxed text-ff-panel"
      style={{ left: flip ? x - 12 : x + 12, top, transform: flip ? 'translateX(-100%)' : undefined }}
    >
      {children}
    </span>
  )
}

/** Value labels sit in ink with a surface halo so they stay readable over gridlines and neighbouring marks. */
const valueLabel = 'fill-ff-text font-mono text-[10px] [paint-order:stroke] stroke-ff-panel [stroke-width:3px]'

/**
 * Results against expectations, week by week. Each played week is a column of
 * what was scored from the zero line, with a tick across it at what was
 * projected: a tick above the column is a miss, below it a beat. Weeks still to
 * come have no result, only a dashed outline up to the projection. A dashed
 * line marks the average of the weeks played, and the best and latest weeks
 * carry their number. One axis, points per week.
 */
export const ProjectionChart = ({
  weeks,
  actual,
  projected,
  height = 180,
  highlight = [],
  unit = 'pts',
  labels = [],
}: {
  weeks: number[]
  actual: (number | null)[]
  projected: (number | null)[]
  height?: number
  /** Weeks to shade, e.g. the fantasy playoffs. */
  highlight?: number[]
  unit?: string
  /** Optional per-week context for the readout, e.g. the opponent ("vs DAL"). */
  labels?: (string | null | undefined)[]
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, w] = useWidth(480)
  const vals = [...actual, ...projected].filter((v): v is number => v != null)
  if (!weeks.length || !vals.length) return null
  const played = actual.flatMap((v, i) => (v != null ? [i] : []))
  const avg = played.length ? played.reduce((a, i) => a + actual[i]!, 0) / played.length : null
  const best = played.length ? played.reduce((a, i) => (actual[i]! > actual[a]! ? i : a), played[0]) : -1
  const latest = played.length ? played[played.length - 1] : -1
  const upcoming = weeks.some((_, i) => actual[i] == null && projected[i] != null)
  const hasProj = played.some((i) => projected[i] != null)
  const hi = niceTop(Math.max(...vals) * 1.1)
  const pad = { l: 32, r: 8, t: 16, b: 20 }
  const iw = Math.max(40, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const step = iw / weeks.length
  const bw = Math.max(4, Math.min(18, step * 0.58))
  const x = (i: number) => pad.l + step * (i + 0.5)
  const y = (v: number) => pad.t + ih - (v / hi) * ih
  const ticks = [0, hi / 2, hi]
  const h = hover
  const diff = h !== null && actual[h] != null && projected[h] != null ? actual[h]! - projected[h]! : null
  // Label the best and latest weeks; skip the latest when it would sit on top of the best.
  const labelled = [best, latest].filter((i, k, a) => i >= 0 && a.indexOf(i) === k && (k === 0 || Math.abs(i - best) * step >= 26))
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} className="block" role="img" aria-label={`Weekly ${unit}, scored against projected${avg != null ? `, average ${fmt(avg)}` : ''}`}>
        {weeks.map((wk, i) => (highlight.includes(wk) ? <rect key={`h${i}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih} className="fill-ff-accent/[0.06]" /> : null))}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className={i === 0 ? 'stroke-ff-line2' : 'stroke-ff-line'} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-ff-muted font-mono text-[9.5px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {weeks.map((wk, i) =>
          i % Math.max(1, Math.ceil(weeks.length / Math.max(4, Math.floor(iw / 34)))) === 0 || i === weeks.length - 1 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor="middle" className="fill-ff-muted font-mono text-[9.5px]">
              {wk}
            </text>
          ) : null,
        )}
        {h !== null && <rect x={x(h) - step / 2} y={pad.t} width={step} height={ih} className="fill-ff-text/[0.05]" />}
        {weeks.map((_, i) => {
          const v = actual[i]
          const p = projected[i]
          if (v == null) {
            // Not played yet: the projection alone, as an outline.
            return p != null && p > 0 ? <rect key={i} x={x(i) - bw / 2 + 0.5} y={y(p)} width={bw - 1} height={y(0) - y(p)} fill="none" className="stroke-ff-muted" strokeWidth={1} strokeDasharray="3 2" /> : null
          }
          return <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} className="fill-ff-accent" opacity={h === null || h === i ? 1 : 0.55} />
        })}
        {avg != null && played.length > 1 && (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={y(avg)} y2={y(avg)} className="stroke-ff-text2" strokeWidth={1} strokeDasharray="4 3" />
          </g>
        )}
        {played.map((i) => {
          const p = projected[i]
          if (p == null) return null
          const x0 = x(i) - bw / 2 - 3
          const x1 = x(i) + bw / 2 + 3
          return (
            <g key={`t${i}`}>
              <line x1={x0} x2={x1} y1={y(p)} y2={y(p)} className="stroke-ff-panel" strokeWidth={4} />
              <line x1={x0} x2={x1} y1={y(p)} y2={y(p)} className="stroke-ff-text" strokeWidth={2} />
            </g>
          )
        })}
        {labelled.map((i) => (
          <text key={`l${i}`} x={x(i)} y={Math.min(y(actual[i]!), projected[i] != null ? y(projected[i]!) : Infinity) - 6} textAnchor="middle" className={valueLabel}>
            {fmt(actual[i], 1)}
          </text>
        ))}
        {weeks.map((_, i) => (
          <rect key={i} x={x(i) - step / 2} y={pad.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {h !== null && (
        <ColumnTip x={x(h)} width={w} top={pad.t}>
          <span className="block opacity-70">
            week {weeks[h]}
            {labels[h] ? ` · ${labels[h]}` : ''}
          </span>
          {actual[h] != null ? <span className="block">scored {fmt(actual[h])}</span> : <span className="block opacity-80">not played yet</span>}
          {projected[h] != null && <span className="block opacity-80">projected {fmt(projected[h])}</span>}
          {diff != null && <span className="block">{fmtSigned(diff)} vs proj</span>}
        </ColumnTip>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-ff-text2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2 bg-ff-accent" />
          scored
        </span>
        {hasProj && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-ff-text" />
            projected
          </span>
        )}
        {upcoming && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2 border border-dashed border-ff-muted" />
            ahead
          </span>
        )}
        {avg != null && played.length > 1 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 border-t border-dashed border-ff-text2" />
            average <span className="num text-ff-text">{fmt(avg)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * A team's recent scoring against its opponents. Two thin columns a week, the
 * team's own and the opponent's, from the zero line; a lettered cell under each
 * week says who won, so the result never rests on colour. A dashed line marks
 * the team's season average.
 */
export const ResultsChart = ({
  rows,
  avg,
  height = 128,
  teamLabel = 'points',
}: {
  rows: { week: number; points: number; opponentPoints: number | null; result: 'W' | 'L' | 'T' | null; opponent?: string | null }[]
  /** The team's season average, drawn as a reference line. */
  avg?: number
  height?: number
  teamLabel?: string
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, w] = useWidth(420)
  if (!rows.length) return null
  const strip = 17
  const pad = { l: 32, r: 8, t: 16, b: strip + 18 }
  const iw = Math.max(40, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const hi = niceTop(Math.max(...rows.flatMap((r) => [r.points, r.opponentPoints ?? 0])) * 1.1)
  const step = iw / rows.length
  const bw = Math.max(3, Math.min(14, step * 0.3))
  const x = (i: number) => pad.l + step * (i + 0.5)
  const y = (v: number) => pad.t + ih - (v / hi) * ih
  const best = rows.reduce((a, r, i) => (r.points > rows[a].points ? i : a), 0)
  const latest = rows.length - 1
  const labelled = [best, latest].filter((i, k, a) => a.indexOf(i) === k && (k === 0 || Math.abs(i - best) * step >= 28))
  const cell = Math.min(strip + 3, step - 4)
  const h = hover
  const wins = rows.filter((r) => r.result === 'W').length
  const losses = rows.filter((r) => r.result === 'L').length
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg
        width={w}
        height={height}
        className="block"
        role="img"
        aria-label={`${teamLabel} against opponents over the last ${rows.length} weeks: ${wins} won, ${losses} lost. ${rows.map((r) => `week ${r.week} ${r.result ?? 'no result'} ${fmt(r.points)} to ${fmt(r.opponentPoints)}`).join('; ')}`}
      >
        {[0, hi / 2, hi].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className={i === 0 ? 'stroke-ff-line2' : 'stroke-ff-line'} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-ff-muted font-mono text-[9.5px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {h !== null && <rect x={x(h) - step / 2} y={pad.t} width={step} height={ih + 4 + strip} className="fill-ff-text/[0.05]" />}
        {rows.map((r, i) => (
          <g key={r.week} opacity={h === null || h === i ? 1 : 0.6}>
            <rect x={x(i) - bw - 0.5} y={y(r.points)} width={bw} height={Math.max(0, y(0) - y(r.points))} className="fill-ff-accent" />
            {r.opponentPoints != null && <rect x={x(i) + 0.5} y={y(r.opponentPoints)} width={bw} height={Math.max(0, y(0) - y(r.opponentPoints))} className="fill-ff-muted" fillOpacity={0.5} />}
          </g>
        ))}
        {avg != null && rows.length > 1 && (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={y(avg)} y2={y(avg)} className="stroke-ff-text2" strokeWidth={1} strokeDasharray="4 3" />
          </g>
        )}
        {labelled.map((i) => (
          <text key={`l${i}`} x={x(i) - bw / 2 - 0.5} y={y(rows[i].points) - 5} textAnchor="middle" className={valueLabel}>
            {fmt(rows[i].points, 0)}
          </text>
        ))}
        {rows.map((r, i) => (
          <g key={`c${r.week}`}>
            <rect
              x={x(i) - cell / 2}
              y={pad.t + ih + 4}
              width={cell}
              height={strip}
              className={cx('stroke-ff-line2', r.result === 'W' ? 'fill-ff-pos/20' : r.result === 'L' ? 'fill-ff-neg/20' : 'fill-ff-line/50')}
              strokeWidth={1}
            />
            <text x={x(i)} y={pad.t + ih + 4 + strip / 2 + 3.5} textAnchor="middle" className="fill-ff-text font-mono text-[10.5px] font-semibold">
              {r.result ?? '–'}
            </text>
            <text x={x(i)} y={height - 3} textAnchor="middle" className="fill-ff-muted font-mono text-[9.5px]">
              {r.week}
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <rect key={`m${r.week}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih + 4 + strip} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {h !== null && (
        <ColumnTip x={x(h)} width={w} top={pad.t}>
          <span className="block opacity-70">
            week {rows[h].week} · {rows[h].result ?? 'no result'}
            {rows[h].opponent ? ` vs ${rows[h].opponent}` : ''}
          </span>
          <span className="block">
            {fmt(rows[h].points)} to {fmt(rows[h].opponentPoints)}
          </span>
          {rows[h].opponentPoints != null && <span className="block opacity-80">{fmtSigned(rows[h].points - rows[h].opponentPoints!)} margin</span>}
        </ColumnTip>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-ff-text2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2 bg-ff-accent" />
          {teamLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2 bg-ff-muted/50" />
          opponent
        </span>
        {avg != null && rows.length > 1 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 border-t border-dashed border-ff-text2" />
            season avg <span className="num text-ff-text">{fmt(avg)}</span>
          </span>
        )}
        <span className="font-mono text-[10px] text-ff-muted">W / L under each week</span>
      </div>
    </div>
  )
}

/**
 * Signed contributions stacked left and right of zero, one row per item —
 * where a composite score comes from. Positive pieces stack right, negative
 * left, each separated by a 2px surface gap.
 */
export const DivergingStacks = ({
  rows,
  parts,
  rowHeight = 22,
  label,
}: {
  rows: { key: string | number; label: React.ReactNode; values: number[]; total?: number }[]
  parts: { label: string; slot: string }[]
  rowHeight?: number
  label?: (total: number) => string
}) => {
  const [hover, setHover] = useState<{ r: number; p: number } | null>(null)
  const [ref, w] = useWidth(600)
  const labelW = Math.min(170, Math.max(110, w * 0.28))
  const valueW = 46
  const iw = w - labelW - valueW - 8
  const maxSide = Math.max(
    0.1,
    ...rows.map((r) => Math.max(r.values.filter((v) => v > 0).reduce((a, b) => a + b, 0), -r.values.filter((v) => v < 0).reduce((a, b) => a + b, 0))),
  )
  const mid = labelW + iw / 2
  const scale = iw / 2 / maxSide
  const barH = Math.min(14, rowHeight - 8)
  const height = rows.length * rowHeight + 6
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} className="block" role="img" aria-label="Contribution of each component to each row">
        <line x1={mid} x2={mid} y1={0} y2={height} className="stroke-ff-line2" strokeWidth={1} />
        {rows.map((r, ri) => {
          const cy = ri * rowHeight + rowHeight / 2 + 3
          let pos = 0
          let neg = 0
          return (
            <g key={r.key}>
              <foreignObject x={0} y={cy - 10} width={labelW - 8} height={20}>
                <div className="truncate text-[12px] leading-5 text-ff-text">{r.label}</div>
              </foreignObject>
              {r.values.map((v, pi) => {
                const width = Math.abs(v) * scale
                if (width < 0.5) return null
                const x0 = v >= 0 ? mid + pos * scale + 1 : mid - (neg + Math.abs(v)) * scale - 1
                if (v >= 0) pos += v
                else neg += Math.abs(v)
                return (
                  <rect
                    key={pi}
                    x={x0}
                    y={cy - barH / 2}
                    width={Math.max(0.5, width - 2)}
                    height={barH}
                    rx={2}
                    fill={fill(parts[pi].slot)}
                    opacity={hover === null || (hover.r === ri && hover.p === pi) ? 1 : 0.45}
                    onMouseEnter={() => setHover({ r: ri, p: pi })}
                  />
                )
              })}
              <text x={w - 4} y={cy + 4} textAnchor="end" className="fill-ff-text font-mono text-[11px]">
                {label ? label(r.total ?? r.values.reduce((a, b) => a + b, 0)) : fmtSigned(r.values.reduce((a, b) => a + b, 0), 2)}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <Tip x={mid} y={hover.r * rowHeight + 4} width={w}>
          {parts[hover.p].label} {fmtSigned(rows[hover.r].values[hover.p], 2)}
        </Tip>
      )}
    </div>
  )
}

/** One series as horizontal bars from a zero baseline, labelled at the tip. */
export const HBars = ({
  rows,
  format = (v: number) => fmt(v, 1),
  slot = 's1',
  max,
}: {
  rows: { key: string; label: React.ReactNode; value: number; sub?: string }[]
  format?: (v: number) => string
  slot?: string
  max?: number
}) => {
  const top = max ?? Math.max(0.01, ...rows.map((r) => Math.abs(r.value)))
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[72px_1fr] items-center gap-2" title={r.sub}>
          <div className="truncate text-[12px] text-ff-text2">{r.label}</div>
          <div className="flex items-center gap-2">
            <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(1, (Math.abs(r.value) / top) * 100) * 0.82}%`, background: fill(slot) }} />
            <span className={cx('num shrink-0 text-[11.5px] text-ff-text')}>{format(r.value)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
