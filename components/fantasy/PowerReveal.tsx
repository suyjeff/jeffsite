import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PowerWeights } from '../../lib/fantasy/power'
import type { ModelConfig } from '../../lib/fantasy/war'
import { estimateWeek, joinOdds, recapOddsRuns, RECAP_SIMS, sortPasses, type Odds, type Recap } from '../../lib/fantasy/recap'
import { useFantasy } from './FantasyContext'
import PowerRecap, { Phrase, RowBody, TeamLabel } from './PowerRecap'
import { Crown } from './RevealBanner'
import SwipeSheet, { type SwipeSheetHandle } from './SwipeSheet'
import { cx, fmt, usePhone } from './ui'
import { useSlate } from './useSlate'
import { recapSource, type RevealApi, type RevealSource } from './useReveal'

// The weekly power-rank reveal. Three acts, then the recap:
//   1. Calculating: the week's real scores stream in as a feed and the sample's figures tick up beside them.
//   2. Sorting: last week's ranking, re-sorted in place by odd-even passes until it is this week's.
//   3. The crown: No. 1 is framed in gold, crowned, and named.
// It then hands its ranking over to the recap (lib/fantasy/recap, PowerRecap.tsx). A tap, Space or Skip jumps to the
// end; Replay plays it again. Wide screens get a framed modal over the shaded page; phones a full-height sheet that
// swipes down to close. Reduced motion skips the acts and fades the recap in.

type Stage = 'calc' | 'calc-out' | 'sort' | 'crown' | 'done'

/** When each act begins, in ms from the start. The sort then runs a pass at a time and the crown holds. */
const T = { score: 600, simulate: 1200, out: 2650, sort: 2900, sortGo: 3600, crownHold: 1900 }
const STEPS = ['Ingest', 'Score', 'Simulate', 'Rank', 'Crown'] as const

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
const pad2 = (n: number) => String(n).padStart(2, '0')
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A number that counts from one value to another, written straight to the DOM so nothing re-renders per frame. */
const Count = ({ to, from = 0, digits = 1, dur = 900, delay = 0, className, group }: { to: number; from?: number; digits?: number; dur?: number; delay?: number; className?: string; group?: boolean }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const show = useCallback((x: number) => (group ? x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : x.toFixed(digits)), [digits, group])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reducedMotion()) {
      el.textContent = show(to)
      return
    }
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / dur))
      // A strong ease-out: the digits race, then settle onto the figure.
      const e = 1 - Math.pow(1 - p, 4)
      el.textContent = show(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    el.textContent = show(from)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, from, dur, delay, show])
  return (
    <span ref={ref} className={cx('num', className)}>
      {show(from)}
    </span>
  )
}

/** The elapsed clock in the footer: T+03.21s, ticking until the reveal lands. */
const Clock = ({ running, run }: { running: boolean; run: number }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const t0 = useRef(0)
  useEffect(() => {
    t0.current = performance.now()
  }, [run])
  useEffect(() => {
    if (!running) return
    let raf = 0
    const tick = (now: number) => {
      if (ref.current) ref.current.textContent = `T+${((now - t0.current) / 1000).toFixed(2).padStart(5, '0')}s`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, run])
  return <span ref={ref} className="num text-[10.5px] text-ff-muted" />
}

/** Registration crosshairs at the corners of the stage, like a plotted sheet. */
const Registration = () => (
  <>
    {['left-2.5 top-2.5', 'right-2.5 top-2.5', 'bottom-2.5 left-2.5', 'bottom-2.5 right-2.5'].map((pos) => (
      <svg key={pos} aria-hidden width="11" height="11" className={cx('pointer-events-none absolute text-ff-line2', pos)}>
        <path d="M0 5.5H11M5.5 0V11" stroke="currentColor" />
      </svg>
    ))}
  </>
)

/** Act one: every game of the week as a feed of readings, with the sample's figures beside it. */
/**
 * Under the feed, the simulate step: the season run forward from before the week and from after it, each team's
 * playoff odds filling to where the week left them, a tick where they stood before it. Without a season model it
 * shows the week's all-play instead: how many teams each score would have beaten.
 */
const Simulate = ({ recap, odds, pending, phone }: { recap: Recap; odds: Record<number, Odds> | null; pending: boolean; phone: boolean }) => {
  const n = recap.teams.length
  const sim = odds || pending
  const rows = pending
    ? recap.teams.map((t) => ({ id: t.rosterId, v: 0, was: null as number | null }))
    : odds
    ? recap.teams.map((t) => ({ id: t.rosterId, v: odds[t.rosterId]?.after.playoffs ?? 0, was: odds[t.rosterId]?.before.playoffs ?? null })).sort((a, b) => b.v - a.v)
    : recap.teams.map((t) => ({ id: t.rosterId, v: t.weekRank ? (n - t.weekRank) / Math.max(1, n - 1) : 0, was: null as number | null })).sort((a, b) => b.v - a.v)
  const t0 = T.simulate
  return (
    <div className="mt-4 shrink-0 md:mt-6">
      <div className="ff-rv-in mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted" style={d(t0 - 150)}>
        <span>{sim ? 'Simulate · playoff odds' : 'All-play · this week'}</span>
        {sim && (
          <span className="normal-case">
            <Count to={RECAP_SIMS} digits={0} delay={t0} dur={1000} group className="text-ff-text" /> seasons × 2
          </span>
        )}
      </div>
      {/* The seasons being run: a strip of cells lighting left to right. */}
      {sim && (
        <div className="mb-2.5 flex gap-[2px]" aria-hidden>
          {Array.from({ length: phone ? 36 : 64 }, (_, i) => (
            <span key={i} className="ff-rv-in h-1.5 flex-1 bg-ff-accent/70" style={d(t0 + i * (phone ? 26 : 15))} />
          ))}
        </div>
      )}
      <ul className={cx('grid gap-x-6', !phone && 'grid-cols-2')}>
        {rows.map((r, i) => (
          <li key={r.id} className="ff-rv-in flex items-center gap-2 text-[11px]" style={{ height: phone ? 15 : 19, ...d(t0 + 80 + i * 40) }}>
            <span className="min-w-0 flex-1 truncate">
              <TeamLabel id={r.id} />
            </span>
            <span className="relative h-1.5 w-[42%] shrink-0 bg-ff-sunken">
              <span className={cx('ff-rv-x absolute inset-y-0 left-0', i === 0 ? 'bg-[var(--ff-gold)]' : 'bg-ff-accent')} style={{ width: `${r.v * 100}%`, ...d(t0 + 160 + i * 40) }} />
              {r.was != null && <span className="ff-rv-in absolute -inset-y-[3px] w-px bg-ff-text" style={{ left: `${r.was * 100}%`, ...d(t0 + 400 + i * 40) }} />}
            </span>
            <span className="num w-9 shrink-0 text-right text-ff-text2">
              {sim ? <Count to={r.v * 100} digits={0} delay={t0 + 160 + i * 40} dur={700} /> : `${Math.round(r.v * (n - 1))}-${n - 1 - Math.round(r.v * (n - 1))}`}
              {sim && '%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const Feed = ({ recap, odds, hasModel, phone, leaving }: { recap: Recap; odds: Record<number, Odds> | null; hasModel: boolean; phone: boolean; leaving: boolean }) => {
  const games = recap.games
  const scores = recap.teams.map((t) => t.points).filter((x) => x > 0)
  const max = Math.max(...scores, 1)
  const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  const sd = Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / (scores.length || 1))
  const readings: [string, number, number][] = [
    ['teams', recap.teams.length, 0],
    ['games', games.length, 0],
    ['points', scores.reduce((a, b) => a + b, 0), 1],
    ['mean', mean, 1],
    ['σ', sd, 1],
    ['high', Math.max(...scores, 0), 1],
    ['low', scores.length ? Math.min(...scores) : 0, 1],
    ['Δ max', Math.max(0, ...games.map((g) => g.margin)), 1],
  ]
  const half = phone ? 52 : 84
  const rowAt = (i: number) => 250 + i * (phone ? 90 : 110)
  const sorted = [...scores].sort((a, b) => b - a)
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col justify-center gap-4 md:flex-row md:items-center md:gap-8', leaving && 'ff-rv-out')}>
      {phone && (
        <dl className="grid shrink-0 grid-cols-4 gap-px border border-ff-line bg-ff-line">
          {readings.map(([k, v, digits], i) => (
            <div key={k} className="ff-rv-in bg-ff-panel px-2 py-1.5" style={d(150 + i * 60)}>
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-ff-muted">{k === 'σ' ? <span className="normal-case">σ</span> : k}</dt>
              <dd className="text-[12.5px] text-ff-text">
                <Count to={v} digits={digits} delay={300 + i * 60} dur={1300} group />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="relative min-h-0 md:flex-1">
        <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted">
          <span className="ff-rv-in" style={d(100)}>
            Feed · wk {pad2(recap.week)} {recap.estimated ? 'estimated' : 'final'}
          </span>
          <span className="ff-rv-in" style={d(200)}>
            pts · Δ
          </span>
        </div>
        <ol className="relative border-t border-ff-line">
          {/* The scan: a line that sweeps the feed while it reads. */}
          <span
            aria-hidden
            className="ff-rv-scan pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-ff-accent shadow-[0_0_12px_2px_rgb(var(--ff-accent)/0.35)]"
            style={{ ...d(300), '--h': `${games.length * (phone ? 46 : 40)}px` } as CSSProperties}
          />
          {games.map((g, i) => {
            const t = rowAt(i)
            const wa = g.winner === g.a
            const wb = g.winner === g.b
            const bars = (
              <span className="flex items-center gap-[3px]" aria-hidden>
                <span className="flex h-2 justify-end" style={{ width: half }}>
                  <span className={cx('ff-rv-x-r h-full', wa ? 'bg-ff-accent' : 'bg-ff-line2')} style={{ width: (g.pa / max) * half, ...d(t + 120) }} />
                </span>
                <span className="h-3.5 w-px bg-ff-text2" />
                <span className="flex h-2" style={{ width: half }}>
                  <span className={cx('ff-rv-x h-full', wb ? 'bg-ff-accent' : 'bg-ff-line2')} style={{ width: (g.pb / max) * half, ...d(t + 120) }} />
                </span>
              </span>
            )
            if (phone)
              return (
                <li key={i} className="ff-rv-rise border-b border-ff-line/70 py-1.5" style={{ height: 46, ...d(t) }}>
                  <div className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className={cx('min-w-0 flex-1 truncate', !wa && 'opacity-60')}>
                      <TeamLabel id={g.a} />
                    </span>
                    <span className="num shrink-0 text-[10px] text-ff-muted">M{pad2(i + 1)}</span>
                    <span className={cx('min-w-0 flex-1 truncate text-right', !wb && 'opacity-60')}>
                      <TeamLabel id={g.b} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Count to={g.pa} delay={t + 100} className={cx('w-12 text-[12.5px]', wa ? 'text-ff-text' : 'text-ff-muted')} />
                    {bars}
                    <Count to={g.pb} delay={t + 100} className={cx('w-12 text-right text-[12.5px]', wb ? 'text-ff-text' : 'text-ff-muted')} />
                  </div>
                </li>
              )
            return (
              <li key={i} className="ff-rv-rise flex h-10 items-center gap-3 border-b border-ff-line/70 text-[12.5px]" style={d(t)}>
                <span className="num w-8 shrink-0 text-[10.5px] text-ff-muted">M{pad2(i + 1)}</span>
                <span className={cx('min-w-0 flex-1 truncate text-right', !wa && 'opacity-60')}>
                  <TeamLabel id={g.a} />
                </span>
                <Count to={g.pa} delay={t + 100} className={cx('w-14 shrink-0 text-right', wa ? 'text-ff-text' : 'text-ff-muted')} />
                {bars}
                <Count to={g.pb} delay={t + 100} className={cx('w-14 shrink-0', wb ? 'text-ff-text' : 'text-ff-muted')} />
                <span className={cx('min-w-0 flex-1 truncate', !wb && 'opacity-60')}>
                  <TeamLabel id={g.b} />
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] text-ff-muted">
                  Δ<Count to={g.margin} delay={t + 300} dur={700} />
                </span>
              </li>
            )
          })}
        </ol>
        {/* Drawn from the start, empty until the odds land, so nothing shifts when they do. */}
        <Simulate recap={recap} odds={odds} pending={hasModel && !odds} phone={phone} />
      </div>
      {!phone && (
        <aside className="w-[220px] shrink-0">
          <div className="ff-rv-in mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted" style={d(150)}>
            Sample
          </div>
          <dl className="border-t border-ff-line">
            {readings.map(([k, v, digits], i) => (
              <div key={k} className="ff-rv-in flex h-7 items-center justify-between border-b border-ff-line/70 font-mono text-[11px]" style={d(200 + i * 70)}>
                <dt className="uppercase tracking-[0.08em] text-ff-muted">{k === 'σ' ? <span className="normal-case">σ</span> : k}</dt>
                <dd className="text-ff-text">
                  <Count to={v} digits={digits} delay={300 + i * 70} dur={1400} group />
                </dd>
              </div>
            ))}
          </dl>
          <div className="ff-rv-in mb-2 mt-5 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted" style={d(800)}>
            <span>Distribution</span>
            <span className="num normal-case">n={sorted.length}</span>
          </div>
          {/* Every team's score, highest first, rising off a baseline. */}
          <div className="relative flex h-20 items-end gap-[3px] border-b border-ff-text2/60">
            {sorted.map((s, i) => (
              <span key={i} className={cx('ff-rv-y flex-1', i === 0 ? 'bg-[var(--ff-gold)]' : 'bg-ff-accent/70')} style={{ height: `${(s / max) * 100}%`, ...d(900 + i * 45) }} />
            ))}
            <span aria-hidden className="ff-rv-x absolute inset-x-0 border-t border-dashed border-ff-text2/60" style={{ bottom: `${(mean / max) * 100}%`, ...d(1500) }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ff-muted">
            <span>high</span>
            <span>— mean</span>
            <span>low</span>
          </div>
        </aside>
      )}
    </div>
  )
}

/**
 * Acts two and three: the week's scoreboard, sorted in place into the new power ranking, then the crown. While it
 * sorts, each row shows the week's points where its move will go, and its power counts from last week's to this
 * week's. Once sorted, wide screens draw a leader from each mover's old place to its new one.
 */
const Ranking = ({
  recap,
  order,
  prev,
  pass,
  passes,
  sortMs,
  sorted,
  crowned,
  rowH,
  listRef,
  phone,
}: {
  recap: Recap
  order: number[]
  prev: number[]
  pass: number
  passes: { swaps: number[] }[]
  sortMs: number
  sorted: boolean
  crowned: boolean
  rowH: number
  listRef: React.Ref<HTMLDivElement>
  phone: boolean
}) => {
  const swaps = pass >= 0 && pass < passes.length ? passes[pass].swaps : []
  const movers = recap.teams.filter((t) => t.move !== 0 && t.rankBefore > 0)
  return (
    <div ref={listRef} className="relative border-y border-ff-line bg-ff-panel" style={{ height: order.length * rowH }}>
      {order.map((id, idx) => {
        const t = recap.byId[id]
        const was = prev.indexOf(id)
        const dir = pass >= 0 && !sorted && was !== idx ? (was > idx ? 'up' : 'down') : undefined
        const top = crowned && idx === 0
        return (
          <div key={id} className="ff-rv-slot absolute inset-x-0 top-0" style={{ transform: `translateY(${idx * rowH}px)`, height: rowH, opacity: crowned && !top ? 0.4 : 1 }} data-dir={dir}>
            <div className={cx('ff-rv-row ff-rv-rise relative flex h-full items-center gap-2.5 border-b border-ff-line/60 px-3', top && 'ff-rv-gold-row')} style={d(idx * 35)}>
              <RowBody
                team={t}
                rank={idx + 1}
                showRank={false}
                showMove={sorted}
                moveIn={sorted ? 0 : undefined}
                moveStandIn={<span className="num text-[11px] text-ff-muted">{fmt(t.points)}</span>}
                crowned={top}
                hatDelay={900}
                score={pass < 0 ? fmt(t.scoreBefore, 1) : <Count key="sorting" from={t.scoreBefore} to={t.scoreAfter} dur={sortMs} />}
              />
              {top &&
                (
                  [
                    ['left-0 top-0 border-l border-t', '-8px', '-8px'],
                    ['right-0 top-0 border-r border-t', '8px', '-8px'],
                    ['bottom-0 left-0 border-b border-l', '-8px', '8px'],
                    ['bottom-0 right-0 border-b border-r', '8px', '8px'],
                  ] as const
                ).map(([cls, x, y]) => <span key={cls} aria-hidden className={cx('ff-rv-corner', cls)} style={{ '--cx': x, '--cy': y, ...d(200) } as CSSProperties} />)}
            </div>
          </div>
        )
      })}
      {/* Rank numbers belong to the slots, not the teams: the teams move past them. */}
      {order.map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx('num pointer-events-none absolute left-3 z-10 flex w-6 items-center text-[12px]', crowned && i === 0 ? 'ff-rv-gold font-medium' : 'text-ff-muted')}
          style={{ top: i * rowH, height: rowH }}
        >
          {pad2(i + 1)}
        </span>
      ))}
      {/* Column heads over the list: what the two figures are while it sorts. */}
      <div aria-hidden className="absolute inset-x-0 -top-6 flex h-5 items-end gap-2.5 px-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ff-muted">
        <span className="w-6">rk</span>
        <span className="flex-1" />
        <span className="w-11 text-right">{sorted ? 'vs lw' : `wk ${recap.week}`}</span>
        <span className="w-10 text-right">pwr</span>
      </div>
      {/* The comparator: a bracket on each pair this pass swaps. */}
      {!phone &&
        swaps.map((i) => (
          <span key={`${pass}-${i}`} aria-hidden className="ff-rv-cmp absolute -right-7 flex w-5 items-center" style={{ top: i * rowH + rowH / 2, height: rowH }}>
            <span className="h-full w-2 border-y border-r border-ff-accent" />
            <span className="ml-0.5 font-mono text-[10px] text-ff-accent">⇅</span>
          </span>
        ))}
      {/* Leaders from last week's place to this week's, for every team that moved. */}
      {!phone && sorted && !crowned && movers.length > 0 && (
        <svg aria-hidden className="ff-dg pointer-events-none absolute -right-14 top-0 overflow-visible" width="48" height={order.length * rowH}>
          {movers.map((t, i) => {
            const y0 = (t.rankBefore - 1) * rowH + rowH / 2
            const y1 = (t.rankAfter - 1) * rowH + rowH / 2
            const x = 14 + (i % 4) * 7
            const up = t.move > 0
            return (
              <g key={t.rosterId} className={up ? 'text-ff-pos' : 'text-ff-neg'}>
                <path d={`M0 ${y0}H${x}V${y1}H2`} pathLength={1} className="draw" fill="none" stroke="currentColor" strokeWidth="1" style={d(i * 60)} />
                <path d={`M5 ${y1 - 3}L1.5 ${y1}L5 ${y1 + 3}`} className="in" fill="none" stroke="currentColor" strokeWidth="1" style={d(300 + i * 60)} />
                <text x={x + 4} y={y1 + 3} className="lbl in" fill="currentColor" style={{ ...d(350 + i * 60), fill: 'currentColor' }}>
                  {up ? '+' : '−'}
                  {Math.abs(t.move)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** Beside the ranking: what the sort is doing, then who was crowned. */
const Hero = ({ recap, stage, pass, passes, swapsDone, phone }: { recap: Recap; stage: Stage; pass: number; passes: number; swapsDone: number; phone: boolean }) => {
  const top = recap.teams[0]
  if (!top) return null
  const moved = recap.teams.filter((t) => t.move !== 0).length
  const done = pass >= passes
  if (stage !== 'crown')
    return (
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ff-muted">
        <div key={pass < 0 ? 'a' : done ? 'c' : 'b'} className="ff-rv-wipe text-ff-text2">
          {pass < 0 ? `Week ${recap.week} scoreboard, by points` : done ? `Sorted · ${moved ? `${moved} moved since last week` : 'nobody moved since last week'}` : `Sorting ${recap.teams.length} teams by power`}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-px border border-ff-line bg-ff-line md:mt-3">
          <div className="bg-ff-panel px-2.5 py-1.5">
            <div className="text-[9.5px]">pass</div>
            <div className="num text-[15px] normal-case text-ff-text">
              {pad2(Math.max(0, Math.min(pass + 1, passes)))}
              <span className="text-ff-muted">/{pad2(passes)}</span>
            </div>
          </div>
          <div className="bg-ff-panel px-2.5 py-1.5">
            <div className="text-[9.5px]">swaps</div>
            <div className="num text-[15px] text-ff-text">{pad2(swapsDone)}</div>
          </div>
          <div className="bg-ff-panel px-2.5 py-1.5">
            <div className="text-[9.5px]">moved</div>
            <div className={cx('num text-[15px]', done ? 'text-ff-text' : 'text-ff-muted/50')}>{done ? pad2(moved) : '--'}</div>
          </div>
        </div>
        {!phone && (
          <p className="ff-rv-in mt-3 normal-case leading-relaxed tracking-normal" style={d(300)}>
            Odd-even transposition: compare neighbours, swap any out of order, repeat until a pass changes nothing. Key: power, the chance to beat an average team.
          </p>
        )}
      </div>
    )
  const before = top.rankBefore
  const line = before === 1 ? 'Holds No. 1 for another week' : `Up from No. ${before}`
  return (
    <div className={cx('flex', phone ? 'items-center gap-4' : 'flex-col items-start')}>
      <div className={cx('relative flex shrink-0 items-center justify-center', phone ? 'h-[72px] w-[72px]' : 'mb-4 h-[132px] w-[132px]')}>
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(500)} />
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(800)} />
        <span aria-hidden className="ff-rv-in absolute inset-0 border border-ff-line2" style={d(0)} />
        {/* Reticle ticks at the middle of each side, pointing in at the crown. */}
        {['left-1/2 top-0 h-2 w-px', 'left-1/2 bottom-0 h-2 w-px', 'top-1/2 left-0 h-px w-2', 'top-1/2 right-0 h-px w-2'].map((c) => (
          <span key={c} aria-hidden className={cx('ff-rv-in absolute bg-[var(--ff-gold)]', c)} style={d(300)} />
        ))}
        <Crown size={phone ? 48 : 84} drawing delay={60} title="Crowned No. 1" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="ff-rv-wipe font-mono text-[11px] uppercase tracking-[0.16em]" style={d(700)}>
          <span className="ff-rv-gold">No. 01</span>
          <span className="text-ff-muted"> · week {recap.week}</span>
        </div>
        <div className={cx('ff-rv-wipe mt-1 font-medium leading-tight tracking-[-0.015em]', phone ? 'text-[22px]' : 'text-[30px]')} style={d(820)}>
          <TeamLabel id={top.rosterId} />
        </div>
        <div className="ff-rv-rise mt-1.5 font-mono text-[11px] text-ff-muted" style={d(1050)}>
          {top.wins}-{top.losses}
          {top.ties ? `-${top.ties}` : ''} · power {fmt(top.scoreAfter)} · {line.toLowerCase()}
        </div>
        {!phone && top.reasons[0] && (
          <div className="ff-rv-rise mt-3 max-w-[320px] text-[13px] leading-snug text-ff-text2" style={d(1200)}>
            <Phrase parts={top.reasons[0].parts} />
          </div>
        )}
      </div>
    </div>
  )
}

/** The pipeline along the bottom: which step the reveal is on, and the clock. */
const Pipeline = ({ step, phone, running, run }: { step: number; phone: boolean; running: boolean; run: number }) => (
  <footer className="flex h-10 shrink-0 items-center gap-3 border-t border-ff-line px-3">
    {phone ? (
      <>
        <span className="flex gap-[3px]" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={cx('h-1.5 w-4 transition-colors duration-200', i < step ? 'bg-ff-text2/60' : i === step ? 'bg-ff-accent' : 'bg-ff-line2')} />
          ))}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ff-text2">
          {pad2(step + 1)}/{pad2(STEPS.length)} {STEPS[step]}
        </span>
      </>
    ) : (
      <ol className="flex items-center">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center">
            {i > 0 && <span aria-hidden className={cx('h-px w-6 transition-colors duration-300', i <= step ? 'bg-ff-accent' : 'bg-ff-line2')} />}
            <span
              className={cx(
                'border px-1.5 font-mono text-[10px] uppercase leading-[18px] tracking-[0.1em] transition-colors duration-200',
                i === step ? 'border-ff-accent bg-ff-accent/10 text-ff-accent' : i < step ? 'border-ff-line2 text-ff-text2' : 'border-ff-line text-ff-muted/70',
              )}
            >
              {pad2(i + 1)} {s}
            </span>
          </li>
        ))}
      </ol>
    )}
    <span className="flex-1" />
    <span className="font-mono text-[10px] text-ff-muted max-sm:hidden">{phone ? 'tap to skip' : 'click or space to skip'}</span>
    <Clock running={running} run={run} />
  </footer>
)

/**
 * The reveal itself, for a recap already built. `run` restarts it from the top when it changes from outside (a
 * banner pressed while it is open).
 */
export const PowerReveal = ({ source, preview, run, onClose }: { source: RevealSource; preview?: { estimated: boolean } | null; run: number; onClose: () => void }) => {
  const { data, analysis, models } = useFantasy()
  const { recap } = source
  const phone = usePhone()
  // Between a phone and a wide screen (a tablet, a narrow window) the frame is too narrow to set the acts side by
  // side: they stack as on a phone, inside the frame.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const stack = phone || narrow
  const reduced = useMemo(reducedMotion, [])
  const n = recap.teams.length

  // Playoff odds before and after the week, simulated once the reveal is under way.
  const [odds, setOdds] = useState<Record<number, Odds> | null>(null)
  useEffect(() => {
    const f = models.forecast
    if (!f) return
    let live = true
    // Two simulations, one task each, while the frame's entrance (a compositor animation) plays.
    const runs = recapOddsRuns({
      recap,
      priorWeeks: source.priorWeeks,
      matchupsByWeek: source.matchupsByWeek,
      slots: analysis.slots,
      players: data.players,
      rosterIds: analysis.teams.map((t) => t.rosterId),
      forecast: f,
      schedule: models.forecastInput.schedule,
      playoffWeeks: models.forecastInput.playoffWeeks,
      playoffTeams: models.forecastInput.playoffTeams,
      weeksLeft: data.futureWeeks.filter((w) => w > recap.week).length,
    })
    let before: ReturnType<typeof runs.before> | null = null
    const a = window.setTimeout(() => (before = runs.before()), 30)
    const b = window.setTimeout(() => {
      if (live && before) setOdds(joinOdds(analysis.teams.map((t) => t.rosterId), before, runs.after()))
    }, 120)
    return () => {
      live = false
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [source, recap, models, analysis, data])

  // The sort starts from the week's scoreboard, highest score first, and ends at the new power ranking.
  const start = useMemo(() => [...recap.teams].sort((a, b) => b.points - a.points || a.rankAfter - b.rankAfter).map((t) => t.rosterId), [recap])
  const after = useMemo(() => recap.teams.map((t) => t.rosterId), [recap])
  const passes = useMemo(() => sortPasses(start, after), [start, after])
  // A pass every 180ms; a long sort runs quicker so the act never drags past two seconds.
  const passMs = passes.length > 10 ? Math.max(120, Math.round(1800 / passes.length)) : 180
  const sortMs = Math.max(700, passes.length * passMs)

  // Rows as tall as fit: 40px on wide screens, up to 44px on a phone, so every team shows without scrolling.
  const rowH = useMemo(() => {
    if (typeof window === 'undefined') return 40
    const h = window.innerHeight
    if (phone) return Math.max(32, Math.min(44, Math.floor((h - 300) / Math.max(1, n))))
    return Math.max(30, Math.min(40, Math.floor((Math.min(820, h - 48) - 200) / Math.max(1, n))))
  }, [phone, n])

  const [stage, setStage] = useState<Stage>(reduced ? 'done' : 'calc')
  const [step, setStep] = useState(0)
  const [pass, setPass] = useState(-1)
  const [play, setPlay] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const from = useRef<DOMRect | null>(null)
  const timers = useRef<number[]>([])

  const finish = useCallback((handOver: boolean) => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    from.current = handOver ? (listRef.current?.getBoundingClientRect() ?? null) : null
    setStage('done')
  }, [])

  // The script. Restarted by Replay, or by `run` changing.
  useEffect(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    from.current = null
    if (reduced) {
      setStage('done')
      return
    }
    setStage('calc')
    setStep(0)
    setPass(-1)
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
    at(T.score, () => setStep(1))
    at(T.simulate, () => setStep(2))
    at(T.out, () => setStage('calc-out'))
    at(T.sort, () => {
      setStage('sort')
      setStep(3)
    })
    passes.forEach((_, i) => at(T.sortGo + i * passMs, () => setPass(i)))
    const sorted = T.sortGo + passes.length * passMs + (passes.length ? 200 : 700)
    at(sorted, () => setPass(passes.length))
    // A beat on the sorted list, for the moves since last week to land, then the crown.
    at(sorted + 900, () => {
      setStage('crown')
      setStep(4)
    })
    at(sorted + 900 + T.crownHold, () => finish(true))
    return () => timers.current.forEach(window.clearTimeout)
  }, [play, run, reduced, passes, passMs, finish])

  const skip = useCallback(() => {
    if (stage === 'done') return
    finish(stage === 'crown')
  }, [stage, finish])
  const replay = useCallback(() => setPlay((p) => p + 1), [])

  const order = pass < 0 ? start : pass >= passes.length ? after : passes[pass].order
  const prev = pass <= 0 ? start : pass >= passes.length ? after : passes[pass - 1].order
  const swapsDone = passes.slice(0, Math.max(0, Math.min(pass + 1, passes.length))).reduce((a, p) => a + p.swaps.length, 0)

  // ---- The frame: a modal on wide screens, a full-height sheet on phones. ----
  const panel = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const swipe = useRef<SwipeSheetHandle>(null)
  const closing = useRef(false)
  const done = useRef(onClose)
  done.current = onClose
  const close = useCallback(() => {
    if (closing.current) return
    if (phone) return swipe.current ? swipe.current.dismiss() : done.current()
    closing.current = true
    root.current?.setAttribute('data-closing', '')
    window.setTimeout(() => done.current(), reducedMotion() ? 160 : 180)
  }, [phone])

  // Keys: Escape closes, Space or Enter skips the intro, Tab stays inside.
  const skipRef = useRef(skip)
  skipRef.current = skip
  const stageRef = useRef(stage)
  stageRef.current = stage
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element | null
      if (t && panel.current && !panel.current.contains(t) && t.closest?.('[aria-modal="true"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if ((e.key === ' ' || e.key === 'Enter') && stageRef.current !== 'done' && !(t instanceof HTMLButtonElement)) {
        e.preventDefault()
        skipRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const f = [...panel.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (!f.length) return e.preventDefault()
      const at = document.activeElement
      if (!panel.current.contains(at)) {
        e.preventDefault()
        ;(e.shiftKey ? f[f.length - 1] : f[0]).focus()
      } else if (e.shiftKey && (at === f[0] || at === panel.current)) {
        e.preventDefault()
        f[f.length - 1].focus()
      } else if (!e.shiftKey && at === f[f.length - 1]) {
        e.preventDefault()
        f[0].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      back?.focus?.({ preventScroll: true })
    }
  }, [close])

  // Skip and Replay trade places as the intro ends: when the one that had focus goes, focus stays in the dialog.
  useEffect(() => {
    const at = document.activeElement
    if (panel.current && (!at || at === document.body)) panel.current.focus({ preventScroll: true })
  }, [stage])

  const intro = stage !== 'done'
  const top = recap.teams[0]
  const mine = analysis.myRosterId != null ? recap.byId[analysis.myRosterId] : null
  // What the show says, for a screen reader: the intro is pictures of numbers.
  const summary = `Week ${recap.week}${recap.estimated ? ', estimated' : ''}. ${top ? `${analysis.teamById[top.rosterId]?.name} is No. 1.` : ''}${
    mine ? ` You are No. ${mine.rankAfter}, ${mine.move > 0 ? `up ${mine.move}` : mine.move < 0 ? `down ${-mine.move}` : 'unchanged'} from last week.` : ''
  }`
  const header = (
    <header className="relative flex h-11 shrink-0 items-center gap-2.5 border-b border-ff-line pl-3 pr-1.5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--ff-rv-a), var(--ff-rv-b))' }} />
      <Crown size={18} />
      <h2 id="ff-reveal-title" className="ff-label shrink-0 whitespace-nowrap !text-ff-text">
        Power rank
      </h2>
      <span className="num shrink-0 whitespace-nowrap text-[11px] text-ff-muted">wk {pad2(recap.week)}</span>
      <p id="ff-reveal-summary" className="sr-only">
        {summary}
      </p>
      {/* Phones carry the preview warning in a strip under the header instead. */}
      {preview && !(phone && preview.estimated) && (
        <span className="min-w-0 truncate whitespace-nowrap bg-ff-warn/15 px-1.5 font-mono text-[10px] leading-[18px] text-ff-warn" title="A preview of a week still being played">
          preview{preview.estimated ? ' · estimated' : ''}
        </span>
      )}
      <span className="flex-1" />
      {intro ? (
        <button type="button" onClick={skip} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text max-md:h-10">
          Skip ›
        </button>
      ) : (
        <button type="button" onClick={replay} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text max-md:h-10" title="Play the reveal again">
          ↺ Replay
        </button>
      )}
      <button type="button" onClick={close} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text max-md:h-10" aria-label={phone ? 'Close' : 'Close (Esc)'}>
        {phone ? 'Done' : 'ESC'}
      </button>
    </header>
  )

  const stageEl = intro && (
    // The stage takes a tap anywhere to skip; the buttons above keep their own.
    <div className="ff-rv-grid relative min-h-0 flex-1 cursor-pointer overflow-hidden" onClick={skip} role="presentation">
      <Registration />
      {/* A ruler along the top edge: minor ticks every 8px, majors every 40. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1.5 opacity-70"
        style={{ background: 'repeating-linear-gradient(90deg, rgb(var(--ff-line2)) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgb(var(--ff-muted)) 0 1px, transparent 1px 40px)', backgroundSize: '100% 4px, 100% 6px', backgroundRepeat: 'no-repeat' }}
      />
      <div className={cx('absolute inset-0 flex flex-col', phone ? 'px-3 pb-3 pt-4' : narrow ? 'px-6 pb-5 pt-6' : 'px-10 pb-6 pt-7')}>
        <div className="mb-3 flex shrink-0 items-baseline justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.12em]">
          <span key={stage === 'calc-out' ? 'calc' : stage} className="ff-rv-wipe text-ff-text">
            <span className="text-ff-accent">{pad2(stage === 'crown' ? 3 : stage === 'sort' ? 2 : 1)} //</span> {stage === 'crown' ? 'The crown' : stage === 'sort' ? 'Rank' : 'Calculating'}
          </span>
          <span className="text-ff-muted">
            wk {pad2(recap.week)} · {recap.games.length} games
          </span>
        </div>
        {stage === 'calc' || stage === 'calc-out' ? (
          <Feed recap={recap} odds={odds} hasModel={!!models.forecast} phone={stack} leaving={stage === 'calc-out'} />
        ) : (
          <div className={cx('flex min-h-0 flex-1', stack ? 'flex-col gap-8' : 'items-center justify-center gap-16 xl:gap-20')}>
            <div className={cx(stack ? 'h-[92px] shrink-0' : 'order-2 w-[320px] xl:w-[340px]')}>
              <Hero recap={recap} stage={stage} pass={pass} passes={passes.length} swapsDone={swapsDone} phone={stack} />
            </div>
            <div className={cx(stack ? (phone ? 'w-full' : 'mx-auto w-[400px] max-w-full') : 'order-1 w-[400px]')}>
              <Ranking
                recap={recap}
                order={order}
                prev={prev}
                pass={pass}
                passes={passes}
                sortMs={sortMs}
                sorted={pass >= passes.length}
                crowned={stage === 'crown'}
                rowH={rowH}
                listRef={listRef}
                phone={stack}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const body = (
    <>
      {header}
      {/* Phones have no room for the whole badge in the header: the warning gets its own strip. */}
      {phone && preview?.estimated && (
        <div className="shrink-0 border-b border-ff-warn/30 bg-ff-warn/10 px-3 py-1 font-mono text-[10.5px] text-ff-warn">Preview · estimated: games still being played count at their projections</div>
      )}
      {intro ? (
        <>
          {stageEl}
          <Pipeline step={step} phone={phone} running={intro} run={play + run} />
        </>
      ) : (
        <PowerRecap key={`${play}-${run}`} recap={recap} odds={odds} phone={stack} rowH={rowH} from={phone || !narrow ? from.current : null} entering />
      )}
    </>
  )

  const dialog = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ff-reveal-title', 'aria-describedby': 'ff-reveal-summary', tabIndex: -1 } as const

  if (phone)
    return (
      <SwipeSheet
        ref={swipe}
        side="bottom"
        className="z-[70]"
        onDismissed={onClose}
        backdropClassName="bg-black/60"
        panelRef={panel}
        panelProps={dialog}
        panelClassName="flex h-[calc(100dvh-env(safe-area-inset-top)-10px)] w-full flex-col border-t border-ff-line2 bg-ff-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(0,0,0,0.4)] outline-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 bg-ff-line2" aria-hidden />
        {body}
      </SwipeSheet>
    )

  return (
    <div ref={root} className="ff-rv-root fixed inset-0 z-[70] flex items-center justify-center p-6" role="presentation">
      {/* Shade only, no backdrop blur: blurring the page under a moving frame costs every frame on a weak GPU. */}
      <div className="ff-rv-shade absolute inset-0 bg-black/60" onClick={close} />
      <div
        ref={panel}
        {...dialog}
        className="ff-rv-frame relative flex h-[min(820px,calc(100dvh-48px))] w-[min(1140px,100%)] flex-col border border-ff-line2 bg-ff-panel shadow-[0_32px_80px_-24px_rgb(0_0_0/0.6)] outline-none"
      >
        {body}
      </div>
    </div>
  )
}

/** The dev preview: the week under way, finished on projections where it is still being played. */
const PreviewReveal = ({ run, onClose, prefs }: { run: number; onClose: () => void; prefs: { weights: PowerWeights; model: ModelConfig } }) => {
  const { data, analysis, models } = useFantasy()
  const { slate, proj, week } = useSlate(data, analysis)
  const source = useMemo(() => {
    const ms = data.matchupsByWeek[week] ?? []
    const est = estimateWeek(ms, proj, (id) => {
      const team = data.players[id]?.team
      const st = team ? slate.teamState[team] : undefined
      if (!st) return null
      return st === 'live' ? { state: 'live', expect: slate.byId[id]?.expect } : { state: st }
    })
    const estimated = slate.games.some((g) => !g.final)
    return { src: recapSource(data, analysis, models, prefs, week, { matchups: est, estimated }), estimated }
  }, [data, analysis, models, prefs, week, slate, proj])
  // Built once per opening: live scores ticking underneath should not restart the show.
  const [frozen] = useState(source)
  return <PowerReveal source={frozen.src} preview={{ estimated: frozen.estimated }} run={run} onClose={onClose} />
}

/** Mounted once inside the league: shows the reveal when the hook says so. */
export const RevealHost = ({ api, prefs }: { api: RevealApi; prefs: { weights: PowerWeights; model: ModelConfig } }) => {
  if (!api.open) return null
  if (api.open.preview) return <PreviewReveal run={api.open.run} onClose={api.close} prefs={prefs} />
  if (!api.source) return null
  return <PowerReveal source={api.source} run={api.open.run} onClose={api.close} />
}

export default PowerReveal
