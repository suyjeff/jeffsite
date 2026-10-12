import React, { type CSSProperties } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Recap } from '../../lib/fantasy/recap'
import { cx } from './ui'

// The way back into the weekly power-rank reveal: a coloured banner on the Power page and a smaller one at the
// foot of the sidebar. Both are buttons that replay it. Drawn in the reveal's own language: hairline drafting shapes,
// a dot grid, the gold crown. Styles and hover motion live in fantasy.css (.ff-rv-banner).

/**
 * The No. 1 crown: a gold band with three points, a diamond at each tip and one hairline across the band. `drawing`
 * traces the outline in, then fills it. Kept geometric and crisp so it reads at 15px on a row and at 96px on stage.
 */
export const Crown = ({ size = 24, drawing, delay = 0, className, title }: { size?: number; drawing?: boolean; delay?: number; className?: string; title?: string }) => (
  <svg
    width={size}
    height={(size * 24) / 32}
    viewBox="0 0 32 24"
    className={cx('ff-rv-crown shrink-0 overflow-visible', drawing && 'is-drawing', className)}
    style={{ '--d': `${delay}ms` } as CSSProperties}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    shapeRendering="geometricPrecision"
  >
    <path className="ff-rv-crown-body" d="M5 20V9.5l5.75 4.75L16 6l5.25 8.25L27 9.5V20Z" />
    <path className="ff-rv-crown-band" d="M6.5 17H25.5" strokeWidth={1} />
    <path className="ff-rv-crown-line" pathLength={1} strokeWidth={1.25} d="M5 20V9.5l5.75 4.75L16 6l5.25 8.25L27 9.5V20Z" />
    {[
      [5, 8.5],
      [16, 4.75],
      [27, 8.5],
    ].map(([x, y]) => (
      <path key={x} className="ff-rv-crown-node" d={`M${x} ${y - 1.9}L${x + 1.9} ${y}L${x} ${y + 1.9}L${x - 1.9} ${y}Z`} />
    ))}
  </svg>
)

/** One line on the reveal for the banners: where you landed, or who is on top. */
const headline = (recap: Recap, analysis: Analysis) => {
  const top = recap.teams[0]
  const topName = top ? analysis.teamById[top.rosterId]?.name : null
  const mine = analysis.myRosterId != null ? recap.byId[analysis.myRosterId] : null
  return { top, topName, mine }
}

const Move = ({ move, className }: { move: number; className?: string }) =>
  move === 0 ? (
    <span className={cx('num text-white/90', className)}>–</span>
  ) : (
    <span className={cx('num', className)} aria-label={move > 0 ? `up ${move}` : `down ${-move}`}>
      {move > 0 ? '▲' : '▼'}
      {Math.abs(move)}
    </span>
  )

/** Hairline drafting shapes for the banner's right side; they move on hover (see fantasy.css). */
const Drafting = ({ compact }: { compact?: boolean }) => (
  <svg aria-hidden className="pointer-events-none absolute inset-y-0 right-0 h-full w-[240px] max-w-[60%] overflow-visible" viewBox="0 0 240 76" preserveAspectRatio="xMaxYMid slice">
    {/* A ruler along the bottom, its ticks sliding on hover. */}
    <g className="ff-rv-tick" style={{ '--tx': '-12px' } as CSSProperties}>
      {Array.from({ length: 22 }, (_, i) => (
        <path key={i} className="ff-rv-ink" d={`M${20 + i * 10} ${i % 5 === 0 ? 66 : 70}V74`} />
      ))}
    </g>
    {/* Kept left of the trailing control, so nothing is drawn under its label; phones, with no room beside the
        words, keep only the ruler. */}
    <g className={compact ? undefined : 'max-sm:hidden'}>
    <rect className="ff-rv-ink ff-rv-sq" x={compact ? 150.5 : 40.5} y={14.5} width={28} height={28} />
    <rect className="ff-rv-ink ff-rv-sq ff-rv-ccw" x={compact ? 158.5 : 48.5} y={22.5} width={12} height={12} />
    <path className="ff-rv-ink" d={compact ? 'M110 28.5H150M164.5 42V60' : 'M0 28.5H40M54.5 42V60'} strokeDasharray="2 3" />
    <rect className="ff-rv-ink-fill" x={compact ? 162.5 : 52.5} y={26.5} width={4} height={4} />
    {!compact && (
      <>
        {/* A small rank trace: up, up, down, up to the top. */}
        <path className="ff-rv-ink" d="M84 54L94 46L104 50L114 30L124 22" />
        {[
          [84, 54],
          [94, 46],
          [104, 50],
          [114, 30],
          [124, 22],
        ].map(([x, y]) => (
          <rect key={x} className="ff-rv-ink-fill" x={x - 1.5} y={y - 1.5} width={3} height={3} />
        ))}
        <text x={84} y={12} className="font-mono" fontSize={8} letterSpacing="0.08em" fill="rgb(255 255 255 / 0.55)">
          RK·Δ
        </text>
      </>
    )}
    </g>
  </svg>
)

/** The Power page's banner, under the tabs. */
export const PowerBanner = ({ recap, analysis, onOpen }: { recap: Recap; analysis: Analysis; onOpen: () => void }) => {
  const { top, topName, mine } = headline(recap, analysis)
  return (
    <button type="button" onClick={onOpen} className="ff-rv-banner group flex min-h-[72px] w-full items-center gap-3 px-3 py-2.5 text-left sm:gap-4 sm:px-4">
      <span className="ff-rv-sweep" aria-hidden />
      <Drafting />
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center border border-white/35 bg-black/10">
        {/* Registration ticks at the corners of the crown's box. */}
        <span aria-hidden className="absolute -left-px -top-px h-1.5 w-1.5 border-l border-t border-white" />
        <span aria-hidden className="absolute -bottom-px -right-px h-1.5 w-1.5 border-b border-r border-white" />
        <span className="ff-rv-lift">
          <Crown size={26} />
        </span>
      </span>
      <span className="relative min-w-0 flex-1 leading-tight">
        <span className="block font-mono text-[10.5px] uppercase tracking-[0.1em] text-white/90">
          Week {recap.week} · power rank reveal{recap.estimated ? ' · estimated' : ''}
          <span className="normal-case tracking-normal max-sm:hidden"> · composite ranking</span>
        </span>
        <span className="mt-1 block truncate text-[15px] font-medium sm:text-[16px]">
          {mine ? (
            <>
              You&apos;re No. {mine.rankAfter} <Move move={mine.move} className="ml-0.5 text-[13px]" />
              {top && top.rosterId !== mine.rosterId && topName && <span className="font-normal text-white/90 max-sm:hidden"> · {topName} is No. 1</span>}
            </>
          ) : (
            <>{topName} is No. 1</>
          )}
        </span>
        {mine && top && top.rosterId !== mine.rosterId && topName && <span className="mt-0.5 block truncate text-[12px] text-white/90 sm:hidden">{topName} is No. 1</span>}
      </span>
      <span className="relative flex h-8 shrink-0 items-center gap-1.5 border border-white/50 bg-white/10 px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] max-sm:hidden">
        Replay
        <span aria-hidden className="ff-rv-nudge inline-block">
          ▸
        </span>
      </span>
      <span aria-hidden className="ff-rv-nudge relative font-mono text-[14px] sm:hidden">
        ▸
      </span>
    </button>
  )
}

/** The sidebar's banner, above the settings, with the dev preview button under it while that is switched on. */
export const NavBanner = ({
  recap,
  analysis,
  onOpen,
  preview,
}: {
  recap: Recap
  analysis: Analysis
  onOpen: () => void
  preview?: { week: number; estimated: boolean; onOpen: () => void } | null
}) => {
  const { topName, mine } = headline(recap, analysis)
  return (
    <div className="shrink-0 space-y-1.5 border-t border-ff-line px-2 py-2">
      <button type="button" onClick={onOpen} className="ff-rv-banner flex h-14 w-full items-center gap-2.5 px-2.5 text-left md:h-12" aria-label={`Replay the week ${recap.week} power rank reveal`}>
        <span className="ff-rv-sweep" aria-hidden />
        <Drafting compact />
        <span className="ff-rv-lift relative">
          <Crown size={22} />
        </span>
        <span className="relative min-w-0 flex-1 leading-tight">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.1em] text-white/90">Wk {recap.week} power rank</span>
          <span className="mt-0.5 block truncate text-[13px] font-medium md:text-[12.5px]">
            {mine ? (
              <>
                You&apos;re No. {mine.rankAfter} <Move move={mine.move} className="text-[11px]" />
              </>
            ) : (
              <>{topName} is No. 1</>
            )}
          </span>
        </span>
        <span aria-hidden className="ff-rv-nudge relative font-mono text-[12px] text-white/90">
          ▸
        </span>
      </button>
      {preview && (
        <button
          type="button"
          onClick={preview.onOpen}
          title={`Play week ${preview.week}'s reveal now${preview.estimated ? ', estimated from live and projected points' : ''}. Not saved as seen.`}
          className="flex h-10 w-full items-center gap-2 border border-dashed border-ff-line2 px-2.5 text-left font-mono text-[10.5px] text-ff-muted hover:border-ff-muted hover:text-ff-text2 md:h-7"
        >
          <span className="bg-ff-warn/15 px-1 text-[9.5px] tracking-[0.08em] text-ff-warn">DEV</span>
          <span className="min-w-0 flex-1 truncate">Preview reveal (dev)</span>
          <span className="shrink-0 text-ff-muted/80">wk {preview.week}</span>
        </button>
      )}
    </div>
  )
}
