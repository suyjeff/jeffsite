import React, { useMemo, useState, type ReactNode } from 'react'

export const fmt = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(digits)

export const fmtSigned = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : `${Math.round(n * 100)}%`

export const Card = ({ title, children, className = '', aside }: { title?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) => (
  <section className={`border border-stone-200 dark:border-stone-800 rounded-lg p-4 bg-white/40 dark:bg-stone-900/40 ${className}`}>
    {(title || aside) && (
      <div className="flex items-baseline justify-between gap-4 mb-3">
        {title && <h2 className="text-xs uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">{title}</h2>}
        {aside && <div className="text-xs text-stone-400 dark:text-stone-500">{aside}</div>}
      </div>
    )}
    {children}
  </section>
)

export const Pill = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) => {
  const tones = {
    neutral: 'bg-stone-200/70 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    bad: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    accent: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  }
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${tones[tone]}`}>{children}</span>
}

export const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-stone-400 dark:text-stone-500">{children}</span>
)

export const Avatar = ({ src, name, size = 24 }: { src: string | null; name: string; size?: number }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded-full bg-stone-200 dark:bg-stone-800 shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span
      className="rounded-full bg-stone-200 dark:bg-stone-800 text-stone-500 inline-flex items-center justify-center text-[10px] shrink-0"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )

/** Single-series sparkline with hover readout. Baseline drawn when provided. */
export const Sparkline = ({
  points,
  baseline,
  width = 120,
  height = 28,
  labels,
}: {
  points: number[]
  baseline?: number
  width?: number
  height?: number
  labels?: string[]
}) => {
  const [hover, setHover] = useState<number | null>(null)
  if (!points.length) return <span className="text-stone-300 dark:text-stone-700">–</span>
  const all = baseline !== undefined ? [...points, baseline] : points
  const min = Math.min(...all, 0)
  const max = Math.max(...all, 1)
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 4) + 2)
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <span className="relative inline-block align-middle" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} className="text-[#2a78d6] dark:text-[#3987e5] block" role="img" aria-label={`Weekly points: ${points.map((p) => p.toFixed(1)).join(', ')}`}>
        {baseline !== undefined && (
          <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} className="stroke-stone-300 dark:stroke-stone-700" strokeDasharray="2 2" />
        )}
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => (
          <rect
            key={i}
            x={x(i) - (width / points.length) / 2}
            y={0}
            width={width / points.length}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && <circle cx={x(hover)} cy={y(points[hover])} r={3.5} fill="currentColor" className="stroke-white dark:stroke-stone-950" strokeWidth={2} />}
      </svg>
      {hover !== null && (
        <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-stone-900 text-stone-100 dark:bg-stone-100 dark:text-stone-900 text-[11px] px-1.5 py-0.5 pointer-events-none z-10">
          {labels?.[hover] ?? `Wk ${hover + 1}`}: {points[hover].toFixed(1)}
        </span>
      )}
    </span>
  )
}

/** Horizontal meter, 0..max, single hue. */
export const Meter = ({ value, max, width = 80 }: { value: number; max: number; width?: number }) => (
  <span className="inline-block align-middle bg-stone-200/70 dark:bg-stone-800 rounded-sm h-1.5" style={{ width }}>
    <span className="block h-1.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${Math.max(0, Math.min(1, max ? value / max : 0)) * 100}%` }} />
  </span>
)

export type Column<T> = {
  key: string
  label: ReactNode
  align?: 'left' | 'right'
  sort?: (row: T) => number | string
  render: (row: T) => ReactNode
  title?: string
  className?: string
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  defaultDesc = true,
  rowClass,
  onRowClick,
  empty = 'Nothing here yet.',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  defaultSort?: string
  defaultDesc?: boolean
  rowClass?: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSort)
  const [desc, setDesc] = useState(defaultDesc)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sort) return rows
    const s = col.sort
    return [...rows].sort((a, b) => {
      const va = s(a)
      const vb = s(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return desc ? -cmp : cmp
    })
  }, [rows, columns, sortKey, desc])
  const toggle = (c: Column<T>) => {
    if (!c.sort) return
    if (sortKey === c.key) setDesc((d) => !d)
    else {
      setSortKey(c.key)
      setDesc(true)
    }
  }
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm tabular-nums border-collapse">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggle(c)}
                className={`py-2 pr-3 font-medium whitespace-nowrap border-b border-stone-200 dark:border-stone-800 ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200' : ''} ${c.className ?? ''}`}
              >
                {c.label}
                {sortKey === c.key && <span className="ml-1 text-stone-300 dark:text-stone-600">{desc ? '↓' : '↑'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-stone-400 dark:text-stone-500">
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-stone-100 dark:border-stone-800/60 ${onRowClick ? 'cursor-pointer hover:bg-stone-200/40 dark:hover:bg-stone-800/40' : ''} ${rowClass?.(row) ?? ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`py-1.5 pr-3 align-middle ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const Tabs = <K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) => (
  <div className="flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-800">
    {tabs.map((t) => (
      <button
        key={t.key}
        onClick={() => onChange(t.key)}
        className={`px-3 py-2 text-sm tracking-tight -mb-px border-b-2 transition-colors ${
          value === t.key
            ? 'border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100'
            : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
        }`}
      >
        {t.label}
      </button>
    ))}
  </div>
)

export const Slider = ({ label, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) => (
  <label className="block">
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className="tabular-nums text-stone-500 dark:text-stone-400">{format ? format(value) : value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#2a78d6] dark:accent-[#3987e5]" />
    {hint && <div className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{hint}</div>}
  </label>
)

export const PosPill = ({ pos }: { pos: string }) => {
  const tones: Record<string, string> = {
    QB: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    RB: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    WR: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    TE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  }
  return <span className={`inline-block w-8 text-center rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${tones[pos] ?? 'bg-stone-200/70 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>{pos}</span>
}
