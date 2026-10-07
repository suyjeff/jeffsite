import React, { Children, useMemo, useState, type ReactNode } from 'react'
import type { TrimmedPlayer } from '../../lib/fantasy/types'

// ---------- Formatting ----------

export const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(digits))

export const fmtSigned = (n: number | null | undefined, digits = 1) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '–'
  // Anything that rounds to zero at the shown precision is zero: no "-0.0".
  if (Math.abs(n) < 0.5 * 10 ** -digits) return (0).toFixed(digits)
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`
}

export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : `${(n * 100).toFixed(digits)}%`)

/** 128255 -> 128k, for counts where only the order of magnitude matters. */
export const compact = (n: number) => (n >= 9950 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

// ---------- Text ----------

export const Muted = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('text-ff-muted', className)}>{children}</span>

/** A number set in the mono face, optionally signed and colored by direction. */
export const Num = ({
  value,
  digits = 1,
  signed = false,
  tone,
  suffix,
  className,
}: {
  value: number | null | undefined
  digits?: number
  signed?: boolean
  /** auto: green up, red down. none: ink. */
  tone?: 'auto' | 'none'
  suffix?: ReactNode
  className?: string
}) => {
  const shown = value == null || Number.isNaN(value) ? null : Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value
  const color = (tone ?? (signed ? 'auto' : 'none')) === 'auto' && shown ? (shown > 0 ? 'text-ff-pos' : 'text-ff-neg') : shown === 0 && signed ? 'text-ff-muted' : ''
  return (
    <span className={cx('num', color, className)}>
      {signed ? fmtSigned(value, digits) : fmt(value, digits)}
      {suffix != null && shown != null && <span className="text-ff-muted">{suffix}</span>}
    </span>
  )
}

export const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx('font-mono text-[10.5px] uppercase tracking-[0.08em] text-ff-muted', className)}>{children}</span>
)

// ---------- Containers ----------

export const Panel = ({
  title,
  actions,
  children,
  className,
  bodyClassName,
  pad = true,
  id,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  pad?: boolean
  id?: string
}) => (
  <section id={id} className={cx('rounded-lg border border-ff-line bg-ff-panel min-w-0', className)}>
    {(title || actions) && (
      <header className="flex min-h-[36px] items-center justify-between gap-3 border-b border-ff-line px-3 py-1.5">
        {title ? <Label className="truncate">{title}</Label> : <span />}
        {actions && <div className="flex shrink-0 items-center gap-2 text-xs text-ff-muted">{actions}</div>}
      </header>
    )}
    <div className={cx(pad && 'p-3', bodyClassName)}>{children}</div>
  </section>
)

/** Page title row plus the page's tabs. Sticks under the mobile top bar. */
export const PageHeader = ({ title, meta, actions, tabs }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; tabs?: ReactNode }) => (
  <div className="sticky top-12 md:top-0 z-20 -mx-3 md:-mx-6 px-3 md:px-6 bg-ff-bg/90 backdrop-blur supports-[backdrop-filter]:bg-ff-bg/75">
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-1.5 pt-2.5 md:pb-2 md:pt-5">
      <div className="min-w-0">
        {/* On phones the top bar already names the section. */}
        <h1 className="hidden text-[22px] font-medium leading-tight tracking-tight text-ff-text md:block">{title}</h1>
        {meta && <div className="text-[11.5px] text-ff-muted md:mt-0.5 md:text-xs">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
    {tabs}
  </div>
)

// ---------- Navigation controls ----------

export type TabItem<K extends string> = { key: K; label: string; count?: number | null }

export const Tabs = <K extends string>({ items, value, onChange }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void }) => (
  <div role="tablist" className="no-scrollbar -mb-px flex overflow-x-auto border-b border-ff-line [mask-image:linear-gradient(to_right,black_88%,transparent)] md:[mask-image:none]">
    {items.map((t) => {
      const active = t.key === value
      return (
        <button
          key={t.key}
          role="tab"
          aria-selected={active}
          onClick={() => onChange(t.key)}
          className={cx('relative h-10 shrink-0 px-3 text-[13px] tracking-tight transition-colors', active ? 'text-ff-text' : 'text-ff-muted hover:text-ff-text')}
        >
          {t.label}
          {t.count != null && <span className="num ml-1.5 text-[11px] text-ff-muted">{t.count}</span>}
          {active && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ff-accent" />}
        </button>
      )
    })}
  </div>
)

export type SegOption<K extends string> = { key: K; label: ReactNode; title?: string }

/** Same data, a different cut of it. */
export const Segmented = <K extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
}: {
  options: SegOption<NoInfer<K>>[]
  value: K
  onChange: (k: NoInfer<K>) => void
  size?: 'sm' | 'md'
  label?: string
}) => (
  <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto no-scrollbar rounded-md border border-ff-line bg-ff-sunken p-0.5">
    {options.map((o) => {
      const active = o.key === value
      return (
        <button
          key={o.key}
          role="radio"
          aria-checked={active}
          title={o.title}
          onClick={() => onChange(o.key)}
          className={cx(
            'shrink-0 whitespace-nowrap rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
            active ? 'bg-ff-panel text-ff-text shadow-sm ring-1 ring-ff-line' : 'text-ff-muted hover:text-ff-text',
          )}
        >
          {o.label}
        </button>
      )
    })}
  </div>
)

export const Select = ({ value, onChange, children, className, label }: { value: string | number; onChange: (v: string) => void; children: ReactNode; className?: string; label: string }) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={cx('h-8 rounded-md border border-ff-line bg-ff-panel px-2 pr-7 text-[13px] text-ff-text outline-none focus-visible:ring-2 focus-visible:ring-ff-accent/40', className)}
  >
    {children}
  </select>
)

export const Button = ({
  children,
  onClick,
  variant = 'outline',
  size = 'md',
  className,
  title,
  type = 'button',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'outline' | 'ghost' | 'primary'
  size?: 'sm' | 'md'
  className?: string
  title?: string
  type?: 'button' | 'submit'
  disabled?: boolean
}) => (
  <button
    type={type}
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ff-accent/40',
      size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
      variant === 'primary' && 'bg-ff-accent text-white hover:bg-ff-accent/90',
      variant === 'outline' && 'border border-ff-line bg-ff-panel text-ff-text hover:bg-ff-raised',
      variant === 'ghost' && 'text-ff-muted hover:text-ff-text hover:bg-ff-raised',
      className,
    )}
  >
    {children}
  </button>
)

// ---------- Figures ----------

export const Stat = ({ label, value, delta, sub, className }: { label: ReactNode; value: ReactNode; delta?: ReactNode; sub?: ReactNode; className?: string }) => (
  <div className={cx('min-w-0 rounded-lg border border-ff-line bg-ff-panel px-2.5 py-2 sm:px-3 sm:py-2.5', className)}>
    <div className="truncate text-[10.5px] text-ff-muted sm:text-[11px]">{label}</div>
    <div className="mt-1 flex min-w-0 items-baseline gap-1.5 sm:gap-2">
      <span className="num truncate text-[16px] font-medium leading-none text-ff-text sm:text-[19px]">{value}</span>
      {delta && <span className="text-[11px] sm:text-xs">{delta}</span>}
    </div>
    {sub && <div className="mt-1 truncate text-[10.5px] text-ff-muted sm:text-[11px]">{sub}</div>}
  </div>
)

/** KPI row. Phones get three across when the count divides by three, two otherwise. */
export const StatGrid = ({ children, className }: { children: ReactNode; className?: string }) => {
  const n = Children.toArray(children).filter(Boolean).length
  return <div className={cx('grid gap-1.5 sm:gap-2', n % 3 === 0 ? 'grid-cols-3' : 'grid-cols-2', 'sm:grid-cols-3 xl:grid-cols-6', className)}>{children}</div>
}

type Tone = 'neutral' | 'pos' | 'neg' | 'warn' | 'accent'
const TONE: Record<Tone, string> = {
  neutral: 'bg-ff-sunken text-ff-text2',
  pos: 'bg-ff-pos/10 text-ff-pos',
  neg: 'bg-ff-neg/10 text-ff-neg',
  warn: 'bg-ff-warn/15 text-ff-warn',
  accent: 'bg-ff-accent/10 text-ff-accent',
}

export const Badge = ({ children, tone = 'neutral', title, className }: { children: ReactNode; tone?: Tone; title?: string; className?: string }) => (
  <span title={title} className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-[1px] text-[11px] font-medium leading-[18px]', TONE[tone], title && 'cursor-help', className)}>
    {children}
  </span>
)

/** Legacy name kept for the context chips. */
export const Pill = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) => (
  <Badge tone={tone === 'good' ? 'pos' : tone === 'bad' ? 'neg' : tone}>{children}</Badge>
)

/** Position identity. The tint carries the hue; the text stays in ink. */
const POS_TINT: Record<string, string> = {
  QB: 'bg-ff-s5/20 ring-ff-s5/40',
  RB: 'bg-ff-s3/20 ring-ff-s3/40',
  WR: 'bg-ff-s1/20 ring-ff-s1/40',
  TE: 'bg-ff-s2/20 ring-ff-s2/40',
  DEF: 'bg-ff-s4/20 ring-ff-s4/40',
}
export const PosTag = ({ pos, className }: { pos: string; className?: string }) => (
  <span
    className={cx(
      'inline-flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded-[4px] font-mono text-[10px] font-semibold text-ff-text ring-1 ring-inset',
      POS_TINT[pos] ?? 'bg-ff-sunken ring-ff-line',
      className,
    )}
  >
    {pos}
  </span>
)
/** Kept for older call sites. */
export const PosPill = PosTag

// ---------- Images ----------

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

const Img = ({ src, alt, size, className, fallback }: { src: string | null; alt: string; size: number; className?: string; fallback: string }) => {
  const [failed, setFailed] = useState(false)
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-ff-sunken text-ff-muted ring-1 ring-ff-line', className)} style={{ width: size, height: size }}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
      ) : (
        <span className="font-mono font-medium" style={{ fontSize: Math.max(9, size * 0.36) }}>
          {fallback}
        </span>
      )}
    </span>
  )
}

export const Avatar = ({ src, name, size = 24 }: { src: string | null; name: string; size?: number }) => (
  <Img src={src} alt="" size={size} className="rounded-full" fallback={initials(name).slice(0, 1)} />
)

export const playerImage = (id: string, player?: TrimmedPlayer) =>
  player?.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`

/** Headshot, or the team logo for a defense. */
export const PlayerAvatar = ({ id, player, size = 28, className }: { id: string; player?: TrimmedPlayer; size?: number; className?: string }) => (
  <Img src={playerImage(id, player)} alt="" size={size} className={cx(player?.pos === 'DEF' ? 'rounded-md bg-transparent' : 'rounded-full', className)} fallback={initials(player?.name ?? id)} />
)

// ---------- Small charts ----------

/** Horizontal meter. The track is a lighter step of the fill's own hue. */
export const Meter = ({ value, max, width = 64, tone = 'accent' }: { value: number; max: number; width?: number; tone?: 'accent' | 'neg' | 'pos' }) => (
  <span className={cx('inline-block h-1.5 shrink-0 rounded-full align-middle', tone === 'accent' ? 'bg-ff-accent/15' : tone === 'neg' ? 'bg-ff-neg/15' : 'bg-ff-pos/15')} style={{ width }}>
    <span
      className={cx('block h-1.5 rounded-full', tone === 'accent' ? 'bg-ff-accent' : tone === 'neg' ? 'bg-ff-neg' : 'bg-ff-pos')}
      style={{ width: `${Math.max(0, Math.min(1, max ? value / max : 0)) * 100}%` }}
    />
  </span>
)

/** Single-series sparkline with a hover readout and an optional baseline. */
export const Sparkline = ({ points, baseline, width = 96, height = 24, labels }: { points: number[]; baseline?: number; width?: number; height?: number; labels?: string[] }) => {
  const [hover, setHover] = useState<number | null>(null)
  if (!points.length) return <span className="text-ff-muted">–</span>
  const all = baseline !== undefined ? [...points, baseline] : points
  const min = Math.min(...all, 0)
  const max = Math.max(...all, 1)
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 6) + 3)
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <span className="relative inline-block align-middle" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} className="block text-ff-accent" role="img" aria-label={`Weekly points: ${points.map((p) => p.toFixed(1)).join(', ')}`}>
        {baseline !== undefined && <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} className="stroke-ff-line2" strokeWidth={1} />}
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={2.5} fill="currentColor" />
        {points.map((_, i) => (
          <rect key={i} x={x(i) - width / points.length / 2} y={0} width={width / points.length} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && <circle cx={x(hover)} cy={y(points[hover])} r={4} fill="currentColor" className="stroke-ff-panel" strokeWidth={2} />}
      </svg>
      {hover !== null && (
        <span className="pointer-events-none absolute -top-6 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel">
          {labels?.[hover] ?? `Wk ${hover + 1}`} · {points[hover].toFixed(1)}
        </span>
      )}
    </span>
  )
}

/**
 * Per-week change as diverging columns from a zero line: up in the gain color,
 * down in the loss color, a 2px gap between weeks, and a readout on hover.
 */
export const WeekBars = ({
  weeks,
  height = 34,
  barWidth = 9,
  highlight,
}: {
  weeks: { week: number; value: number }[]
  height?: number
  barWidth?: number
  /** Weeks to mark beneath the axis — the fantasy playoffs, say. */
  highlight?: number[]
}) => {
  const [hover, setHover] = useState<number | null>(null)
  if (!weeks.length) return null
  const maxAbs = Math.max(0.5, ...weeks.map((w) => Math.abs(w.value)))
  const step = barWidth + 2
  const width = weeks.length * step
  const mid = height / 2
  const scale = (mid - 2) / maxAbs
  return (
    <span className="relative inline-block align-middle" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height + 4} role="img" aria-label={weeks.map((w) => `week ${w.week} ${w.value.toFixed(1)}`).join(', ')} className="block">
        <line x1={0} x2={width} y1={mid} y2={mid} className="stroke-ff-line2" strokeWidth={1} />
        {weeks.map((w, i) => {
          const h = Math.max(1, Math.abs(w.value) * scale)
          const up = w.value >= 0
          return (
            <g key={w.week} onMouseEnter={() => setHover(i)}>
              <rect x={i * step} y={0} width={step} height={height + 4} fill="transparent" />
              <rect
                x={i * step + 1}
                y={up ? mid - h : mid}
                width={barWidth}
                height={h}
                rx={1.5}
                className={Math.abs(w.value) < 0.05 ? 'fill-ff-line2' : up ? 'fill-ff-pos' : 'fill-ff-neg'}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {highlight?.includes(w.week) && <rect x={i * step + 1} y={height + 2} width={barWidth} height={2} rx={1} className="fill-ff-accent" />}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <span
          className="pointer-events-none absolute -top-6 z-30 whitespace-nowrap rounded bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel"
          style={{ left: Math.min(hover * step, width - 70) }}
        >
          Wk {weeks[hover].week} · {fmtSigned(weeks[hover].value, 1)}
        </span>
      )}
    </span>
  )
}

// ---------- Inputs ----------

export const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
  defaultValue,
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: ReactNode
  defaultValue?: number
}) => {
  const changed = defaultValue !== undefined && Math.abs(value - defaultValue) > step / 2
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] text-ff-text">{label}</label>
        <span className="flex items-baseline gap-2">
          {changed && (
            <button
              onClick={() => onChange(defaultValue!)}
              className="font-mono text-[10.5px] uppercase tracking-wider text-ff-muted hover:text-ff-accent"
              title={`Reset to ${format ? format(defaultValue!) : defaultValue}`}
            >
              reset
            </button>
          )}
          <span className={cx('num text-[13px]', changed ? 'text-ff-accent' : 'text-ff-text')}>{format ? format(value) : value}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ff-range mt-1 w-full"
        style={{ ['--fill' as string]: `${((value - min) / (max - min || 1)) * 100}%` }}
      />
      {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-ff-muted">{hint}</p>}
    </div>
  )
}

// ---------- Tables ----------

export type Column<T> = {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  sort?: (row: T) => number | string
  render: (row: T) => ReactNode
  title?: string
  className?: string
  /** Keep this column pinned while the table scrolls sideways (first column on phones). */
  sticky?: boolean
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg'
}

const HIDE: Record<string, string> = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

export function Table<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  defaultDesc = true,
  rowClass,
  onRowClick,
  empty = 'Nothing here yet.',
  maxHeight,
  dense = false,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  defaultSort?: string
  defaultDesc?: boolean
  rowClass?: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  maxHeight?: number
  dense?: boolean
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
  const align = (c: Column<T>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')
  return (
    <div className="ff-scroll overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggle(c)}
                aria-sort={sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined}
                className={cx(
                  'h-8 whitespace-nowrap border-b border-ff-line bg-ff-panel px-2 font-mono text-[10.5px] font-normal uppercase tracking-[0.06em] text-ff-muted first:pl-3 last:pr-3',
                  align(c),
                  c.sort && 'cursor-pointer select-none hover:text-ff-text',
                  c.sticky && 'sticky left-0 z-20',
                  c.hideBelow && HIDE[c.hideBelow],
                  c.className,
                )}
              >
                {c.label}
                {sortKey === c.key && <span className="ml-0.5 text-ff-accent">{desc ? '↓' : '↑'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-[13px] text-ff-muted">
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx('group border-b border-ff-line/70 last:border-0', onRowClick && 'cursor-pointer', 'hover:bg-ff-raised', rowClass?.(row))}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    dense ? 'h-8' : 'h-10',
                    'whitespace-nowrap px-2 align-middle first:pl-3 last:pr-3',
                    align(c),
                    c.align === 'right' && 'num',
                    c.sticky && 'sticky left-0 z-[1] bg-ff-panel group-hover:bg-ff-raised',
                    c.hideBelow && HIDE[c.hideBelow],
                    c.className,
                  )}
                >
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

export const Empty = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-ff-line2 px-4 py-10 text-center">
    <div className="text-sm text-ff-text">{title}</div>
    {children && <div className="mx-auto mt-1 max-w-md text-[13px] text-ff-muted">{children}</div>}
  </div>
)

/** Small key/value grid for detail panes. */
export const KV = ({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: number }) => (
  <dl className={cx('grid gap-x-4 gap-y-2', cols === 3 ? 'grid-cols-3' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')}>
    {items.map(([k, v], i) => (
      <div key={i} className="min-w-0">
        <dt className="truncate text-[11px] text-ff-muted">{k}</dt>
        <dd className="num truncate text-[13px] text-ff-text">{v}</dd>
      </div>
    ))}
  </dl>
)
