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

/**
 * Results against expectations, week by week. The projection is a faded line
 * underneath (dashed where the weeks are still to come); what actually
 * happened sits on top, each week's dot marked by whether it beat the
 * projection. One axis, points per week.
 */
export const ProjectionChart = ({
  weeks,
  actual,
  projected,
  height = 170,
  highlight = [],
  unit = 'pts',
}: {
  weeks: number[]
  actual: (number | null)[]
  projected: (number | null)[]
  height?: number
  /** Weeks to shade, e.g. the fantasy playoffs. */
  highlight?: number[]
  unit?: string
}) => {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, w] = useWidth(480)
  const vals = [...actual, ...projected].filter((v): v is number => v != null)
  if (!weeks.length || !vals.length) return null
  const lastPlayed = actual.reduce<number>((a, v, i) => (v != null ? i : a), -1)
  const rawLo = Math.min(...vals)
  const rawHi = Math.max(...vals)
  const span = rawHi - rawLo || 10
  const lo = Math.max(0, Math.floor((rawLo - span * 0.1) / 10) * 10)
  const hi = Math.ceil((rawHi + span * 0.1) / 10) * 10
  const pad = { l: 34, r: 10, t: 10, b: 20 }
  const iw = Math.max(40, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const step = iw / weeks.length
  const x = (i: number) => pad.l + step * (i + 0.5)
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih
  const ticks = [lo, (lo + hi) / 2, hi]
  const pastProj = projected.map((v, i) => (i <= Math.max(lastPlayed, 0) ? v : null))
  // The dashed run starts at the last played week so the two lines join.
  const futureProj = projected.map((v, i) => (i >= lastPlayed ? v : null))
  const h = hover
  const diff = h !== null && actual[h] != null && projected[h] != null ? actual[h]! - projected[h]! : null
  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} className="block" role="img" aria-label={`Weekly ${unit}, scored against projected`}>
        {weeks.map((wk, i) => (highlight.includes(wk) ? <rect key={`h${i}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih} className="fill-ff-accent/[0.06]" /> : null))}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="stroke-ff-line" strokeWidth={1} />
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
        {h !== null && <line x1={x(h)} x2={x(h)} y1={pad.t} y2={pad.t + ih} className="stroke-ff-line2" strokeWidth={1} />}
        <path d={linePath(pastProj, x, y)} fill="none" className="stroke-ff-muted" strokeOpacity={0.5} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath(futureProj, x, y)} fill="none" className="stroke-ff-muted" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
        <path d={linePath(actual, x, y)} fill="none" className="stroke-ff-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {actual.map((v, i) => {
          if (v == null) return null
          const p = projected[i]
          const tone = p == null ? 'fill-ff-accent' : v >= p ? 'fill-ff-pos' : 'fill-ff-neg'
          return <circle key={i} cx={x(i)} cy={y(v)} r={h === i ? 4.5 : 3} className={cx(tone, 'stroke-ff-panel')} strokeWidth={2} />
        })}
        {h !== null && actual[h] == null && projected[h] != null && <circle cx={x(h)} cy={y(projected[h]!)} r={3.5} className="fill-ff-muted stroke-ff-panel" strokeWidth={2} />}
        {weeks.map((_, i) => (
          <rect key={i} x={x(i) - step / 2} y={pad.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h !== null && (
        <span
          className="pointer-events-none absolute z-30 rounded-sm bg-ff-text px-2 py-1 font-mono text-[10.5px] leading-relaxed text-ff-panel"
          style={{ left: Math.max(0, Math.min(x(h) + 10, w - 140)), top: pad.t }}
        >
          <span className="block opacity-70">week {weeks[h]}</span>
          {actual[h] != null && <span className="block">scored {fmt(actual[h])}</span>}
          {projected[h] != null && <span className="block opacity-80">projected {fmt(projected[h])}</span>}
          {diff != null && <span className="block">{fmtSigned(diff)} vs proj</span>}
        </span>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1 font-mono text-[10px] text-ff-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-ff-accent" />
          scored
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-ff-muted/50" />
          projected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ff-pos" />
          beat
          <span className="ml-1 h-2 w-2 rounded-full bg-ff-neg" />
          missed
        </span>
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
