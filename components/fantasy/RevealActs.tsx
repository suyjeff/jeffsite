import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { PowerWeights } from '../../lib/fantasy/power'
import { RECAP_SIMS, sortPasses, type Recap, type RecapTeam } from '../../lib/fantasy/recap'
import { MONKE } from './brand'
import { useFantasy } from './FantasyContext'
import { Phrase, RowBody, TeamLabel } from './PowerRecap'
import { Football, GorillaFace, Poop } from './RevealArt'
import { Crown } from './RevealBanner'
import { PosTag, cx, fmt } from './ui'

// The acts of the power-rank reveal (PowerReveal.tsx runs them in order):
//   Calibrate  an empty plane: parallelogram tiles tessellating across it, every corner tracked by a vector.
//   Model      the model introduces itself: a gorilla drawn as a technical study, its name, and the composite
//              computed live, team by team, from the week's real numbers.
//   Data       the week on an open canvas: team cards and position cards shuffling, swapping in and out.
//   Launch     a football on a tracked arc: predicted path, apex, velocity, landing.
//   Rank       the presentation: last place, the middle sorted fast, then No. 3, No. 2 and, slowly, No. 1.
// Every motion is a transform, an opacity or a stroke being drawn; the CSS lives in fantasy.css (.ff-rv-*).

export const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
export type Box = { w: number; h: number }

/** A small seeded random source, so a replay plays the same show. */
const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Ticks from 0 up to `count`, one every `ms`, starting after `delay`. Cleaned up with the act. */
const useTicks = (count: number, ms: number, delay = 0) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let i = 0
    let id = 0
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        i++
        setTick(i)
        if (i >= count) window.clearInterval(id)
      }, ms)
    }, delay)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(id)
    }
  }, [count, ms, delay])
  return tick
}

/** A number that counts from one value to another, written straight to the DOM so nothing re-renders per frame. */
export const Count = ({ to, from = 0, digits = 1, dur = 900, delay = 0, className, group }: { to: number; from?: number; digits?: number; dur?: number; delay?: number; className?: string; group?: boolean }) => {
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

/** Text that resolves out of noise, left to right, like a readout settling. Written to the DOM, no re-renders. */
const Resolve = ({ text, dur = 700, delay = 0, className }: { text: string; dur?: number; delay?: number; className?: string }) => {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reducedMotion()) {
      el.textContent = text
      return
    }
    const glyphs = '01#%+=/<>·▮▯'
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / dur))
      const fixed = Math.floor(p * text.length)
      el.textContent = text
        .split('')
        .map((c, i) => (i < fixed || c === ' ' ? c : glyphs[(i * 7 + Math.floor(now / 50)) % glyphs.length]))
        .join('')
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, dur, delay])
  return (
    <span ref={ref} className={className} aria-label={text}>
      {' '}
    </span>
  )
}

/**
 * The size of an element, kept current through resizes, rotation and the browser's own toolbars. A callback ref, so
 * a new element (the stage, mounted again on Replay) is measured afresh and the old one is let go.
 */
export const useBox = <T extends HTMLElement>() => {
  const [box, setBox] = useState<Box | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const ref = useCallback((el: T | null) => {
    stop.current?.()
    stop.current = null
    if (!el) return
    const measure = () => setBox((b) => (b && b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.visualViewport?.addEventListener('resize', measure)
    stop.current = () => {
      ro.disconnect()
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])
  useEffect(() => () => stop.current?.(), [])
  return [ref, box] as const
}

/**
 * Content fitted to a box: laid out at full size and, when that is taller or wider than the box, scaled down, so
 * nothing is ever cut off on a small phone, a big league or a phone on its side.
 */
export const Fit = ({ box, children, center }: { box: Box; children: ReactNode; center?: boolean }) => {
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ s: 1, y: 0 })
  useLayoutEffect(() => {
    const i = inner.current
    if (!i) return
    const measure = () => {
      const nh = i.offsetHeight
      const nw = i.scrollWidth
      const sc = Math.min(1, box.h / Math.max(1, nh), box.w / Math.max(1, nw))
      const y = center ? Math.max(0, (box.h - nh * sc) / 2) : 0
      setFit((f) => (Math.abs(f.s - sc) < 0.002 && Math.abs(f.y - y) < 0.5 ? f : { s: sc, y }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(i)
    return () => ro.disconnect()
  }, [box, center])
  return (
    <div ref={inner} className="absolute inset-x-0 top-0 origin-top" style={{ transform: fit.s < 1 || fit.y ? `translateY(${fit.y}px) scale(${fit.s})` : undefined }}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Calibrate


/**
 * An empty plane, before any data: a parallelogram lattice draws itself, then tiles hop across it one lattice step at a
 * time, each corner tracked by a vector from where it was to where it is, with the coordinates read out.
 */
export const CalibrateAct = ({ box, dur }: { box: Box; dur: number }) => {
  const { w, h } = box
  // Tiles sized to the plane: about fourteen across a laptop, eight across a phone.
  const ax = Math.round(Math.max(52, Math.min(96, w / 13)))
  const bx = Math.round(ax * 0.39)
  const by = Math.round(ax * 0.61)
  const rows = Math.ceil(h / by) + 1
  const ox = -Math.ceil((rows * bx) / ax) * ax
  const pt = (i: number, j: number) => [ox + i * ax + j * bx, j * by] as const
  const cols = Math.ceil((w - ox) / ax) + 1
  const hops = Math.max(6, Math.floor((dur - 600) / 190))
  // Two walks across the plane, mostly rightward, kept inside it.
  const walks = useMemo(() => {
    const make = (seed: number, j0: number) => {
      const r = rng(seed)
      const out: [number, number][] = []
      let j = Math.max(1, Math.min(rows - 3, j0))
      let i = Math.ceil((40 - ox - j * bx) / ax)
      for (let k = 0; k <= hops; k++) {
        out.push([i, j])
        // Mostly across, now and then up or down a row, so the walk tours the plane.
        const step = r()
        const across = h > w ? 0.42 : 0.5
        if (step < across) i++
        else if (step < across + (1 - across) / 2 && j < rows - 3) j++
        else if (j > 1) j--
        else i++
        // Stay on screen: drift back when a corner would leave it.
        while (pt(i + 1, j)[0] > w - 40) i--
      }
      return out
    }
    return [make(11, Math.floor(rows / 2)), make(29, Math.max(1, Math.floor(rows / 2) - 3))]
  }, [rows, hops, w, ax]) // eslint-disable-line react-hooks/exhaustive-deps
  const hop = useTicks(hops, 190, 420)
  const tile = (i: number, j: number) => [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]
  const poly = (c: readonly (readonly [number, number])[]) => c.map((p) => p.join(',')).join(' ')
  const [ci, cj] = walks[0][Math.min(hop, hops)]
  const [pi, pj] = walks[0][Math.max(0, Math.min(hop, hops) - 1)]
  const now = tile(ci, cj)
  const was = tile(pi, pj)
  const origin = pt(walks[0][0][0], walks[0][0][1])
  const [si, sj] = walks[1][Math.min(hop, hops)]
  const second = pt(si, sj)
  const base0 = tile(0, 0).map(([x, y]) => [x - pt(0, 0)[0], y] as const)
  return (
    <div className="absolute inset-0">
      <svg width={w} height={h} className="ff-dg ff-rv-art absolute inset-0" aria-hidden>
        {/* The lattice: one family along a, one along b. */}
        {Array.from({ length: rows }, (_, j) => (
          <path key={`a${j}`} d={`M0 ${j * by}H${w}`} pathLength={1} className="draw ff-rv-cons" style={d(j * 50)} />
        ))}
        {Array.from({ length: cols }, (_, i) => {
          const [x0] = pt(i, 0)
          return <path key={`b${i}`} d={`M${x0} 0L${x0 + (h / by) * bx} ${h}`} pathLength={1} className="draw ff-rv-cons" style={d(120 + i * 30)} />
        })}
        {/* Where the tiles have been: the tessellation they leave. */}
        {walks.flatMap((walk, wi) =>
          walk.slice(0, Math.min(hop, hops)).map(([i, j], k) => <polygon key={`t${wi}-${k}`} points={poly(tile(i, j))} className={cx('in', wi ? 'ff-rv-trail-dim' : 'ff-rv-trail')} />),
        )}
        {/* The second tile, quieter, on its own walk. */}
        <g className="ff-rv-hop" style={{ transform: `translate(${second[0] - pt(0, 0)[0]}px, ${second[1]}px)` }}>
          <polygon points={poly(base0)} className="ff-rv-tile-dim" />
        </g>
        {/* The tracked tile. */}
        <g className="ff-rv-hop" style={{ transform: `translate(${now[0][0] - base0[0][0]}px, ${now[0][1]}px)` }}>
          <polygon points={poly(base0)} className="ff-rv-tile" />
          {base0.map(([x, y], k) => (
            <rect key={k} x={x - 2.5} y={y - 2.5} width={5} height={5} className="ff-rv-node-hot" />
          ))}
        </g>
        {/* A vector from each corner's last place to its new one, redrawn every hop. */}
        {hop > 0 &&
          now.map(([x, y], k) => {
            const [x0, y0] = was[k]
            const len = Math.hypot(x - x0, y - y0) || 1
            const ux = (x - x0) / len
            const uy = (y - y0) / len
            return (
              <g key={`${hop}-${k}`}>
                <path d={`M${x0} ${y0}L${x} ${y}`} pathLength={1} className="ff-rv-qdraw ff-rv-hot" />
                <path d={`M${x - ux * 6 - uy * 3} ${y - uy * 6 + ux * 3}L${x} ${y}L${x - ux * 6 + uy * 3} ${y - uy * 6 - ux * 3}`} className="in ff-rv-hot" style={d(120)} />
              </g>
            )
          })}
        {/* Each corner's coordinates, relative to where the walk began. */}
        {now.map(([x, y], k) => (
          <text key={`${hop}-l${k}`} x={x + (k === 1 || k === 2 ? 6 : -6)} y={y + (k < 2 ? -6 : 13)} textAnchor={k === 1 || k === 2 ? 'start' : 'end'} className="lbl in" style={d(60)}>
            {Math.round(x - origin[0])},{Math.round(y - origin[1])}
          </text>
        ))}
      </svg>
      <dl className="ff-rv-in absolute left-0 top-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 border border-ff-line bg-ff-panel/90 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em]" style={d(300)}>
        <dt className="text-ff-muted">plane</dt>
        <dd className="num text-ff-text">
          {w}×{h}
        </dd>
        <dt className="text-ff-muted">basis</dt>
        <dd className="num normal-case text-ff-text">
          a({ax},0) b({bx},{by})
        </dd>
        <dt className="text-ff-muted">det</dt>
        <dd className="num text-ff-text">{ax * by}</dd>
        <dt className="text-ff-muted">hop</dt>
        <dd className="num text-ff-text">
          {pad2(Math.min(hop, hops))}/{pad2(hops)}
        </dd>
      </dl>
      <p className="ff-rv-in absolute bottom-0 left-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ff-muted" style={d(500)}>
        Calibrating the plane · no data yet
        <span className="ff-rv-blink ml-1 inline-block h-2.5 w-1.5 translate-y-px bg-ff-accent" />
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Model

const PARTS: { key: keyof PowerWeights; label: string }[] = [
  { key: 'allPlay', label: 'AP' },
  { key: 'points', label: 'PTS' },
  { key: 'recent', label: 'L3' },
  { key: 'roster', label: 'RST' },
  { key: 'efficiency', label: 'EFF' },
]

const zShade = (z: number) => (z >= 0 ? `rgb(var(--ff-accent) / ${Math.min(0.5, 0.06 + Math.abs(z) * 0.22).toFixed(2)})` : `rgb(var(--ff-neg) / ${Math.min(0.42, 0.05 + Math.abs(z) * 0.2).toFixed(2)})`)

/**
 * The model at work: the gorilla drawn as a study, the model's name spelled out, and the composite worked through
 * the league row by row, from each team's real z-scores and the real weights, to its power.
 */
export const ModelAct = ({ recap, box, stacked, dur }: { recap: Recap; box: Box; stacked: boolean; dur: number }) => {
  const teams = recap.teams
  const parts = PARTS.filter((p) => recap.weights[p.key] > 0)
  // The scan starts once the matrix has filled, then steps a row at a time: quicker in a big league, so it always
  // reaches the last row before the act ends.
  const row = useTicks(teams.length - 1, Math.min(150, Math.max(40, (dur - 1700) / Math.max(1, teams.length - 1))), 1500)
  const cur = teams[Math.min(row, teams.length - 1)]
  const sum = parts.reduce((a, p) => a + recap.weights[p.key] * cur.components[p.key], 0)
  const rowH = stacked ? 15 : 17
  const name = MONKE.name
  const face = stacked ? Math.min(132, box.w * 0.36) : Math.min(260, box.h * 0.62)
  const math = (
    <div className="min-w-0 flex-1">
      <div className="font-mono uppercase">
        <div className="flex items-baseline gap-[0.08em] text-[30px] leading-none tracking-[0.02em] text-ff-text sm:text-[40px]">
          {name.split('').map((c, i) => (
            <span key={i} className={cx('ff-rv-in', c === '.' && 'text-ff-accent')} style={d(300 + i * 55)}>
              {c}
            </span>
          ))}
        </div>
        <div className="ff-rv-wipe mt-1.5 text-[9.5px] tracking-[0.14em] text-ff-muted sm:text-[10.5px]" style={d(900)}>
          {MONKE.long}
        </div>
      </div>
      <div className="ff-rv-in mt-4 font-mono text-[11px] text-ff-text2" style={d(1100)}>
        power = Φ( <span className="text-ff-accent">Σ wᵢ·zᵢ</span> · σ<sub className="text-[8px]">ppg</sub> / √2σ )
      </div>
      {/* The league as a matrix of z-scores, filled a column at a time, with the scan working down it. */}
      <div className="relative mt-2.5 font-mono text-[10px]">
        <div className="flex border-b border-ff-line pb-1 text-ff-muted">
          <span className="w-[92px] shrink-0 uppercase tracking-[0.08em] sm:w-[120px]">team</span>
          {parts.map((p, c) => (
            <span key={p.key} className="ff-rv-in w-11 shrink-0 text-right uppercase" style={d(1150 + c * 90)}>
              {p.label}
              <span className="block text-[9px] text-ff-accent">{recap.weights[p.key].toFixed(2)}</span>
            </span>
          ))}
          <span className="ff-rv-in w-12 shrink-0 text-right uppercase text-ff-text" style={d(1600)}>
            pwr
          </span>
        </div>
        <div className="relative">
          <span aria-hidden className="ff-rv-scanrow absolute inset-x-0 top-0 border-y border-ff-accent/70 bg-ff-accent/[0.07]" style={{ height: rowH, transform: `translateY(${Math.min(row, teams.length - 1) * rowH}px)` }} />
          {teams.map((t, r) => (
            <div key={t.rosterId} className="relative flex items-center" style={{ height: rowH }}>
              <span className="ff-rv-in w-[92px] shrink-0 truncate pr-2 font-plex text-[10.5px] sm:w-[120px]" style={d(1150 + r * 25)}>
                <TeamLabel id={t.rosterId} />
              </span>
              {parts.map((p, c) => (
                <span key={p.key} className="ff-rv-in num w-11 shrink-0 text-right" style={{ ...d(1200 + c * 90 + r * 12), background: zShade(t.components[p.key]) }}>
                  {t.components[p.key] >= 0 ? '+' : '−'}
                  {Math.abs(t.components[p.key]).toFixed(2)}
                </span>
              ))}
              <span className={cx('num w-12 shrink-0 text-right', r <= row ? 'text-ff-text' : 'text-transparent')}>{fmt(t.scoreAfter)}</span>
            </div>
          ))}
        </div>
      </div>
      {/* The working for the row under the scan. */}
      <div key={cur.rosterId} className="ff-rv-in mt-2 truncate font-mono text-[10.5px] text-ff-text2" style={d(0)}>
        <span className="text-ff-muted">Σ </span>
        {parts.map((p, i) => (
          <React.Fragment key={p.key}>
            {i > 0 && ' + '}
            {recap.weights[p.key].toFixed(2)}×{cur.components[p.key].toFixed(2)}
          </React.Fragment>
        ))}
        {' = '}
        <span className="text-ff-accent">
          {sum >= 0 ? '+' : '−'}
          {Math.abs(sum).toFixed(3)}σ
        </span>
        {' → '}
        <span className="text-ff-text">{fmt(cur.scoreAfter)}</span>
      </div>
    </div>
  )
  return (
    <Fit box={box} center>
      <div className={cx('flex', stacked ? 'flex-col gap-3' : 'items-center justify-center gap-12')}>
        <div className={cx('flex shrink-0 items-center', stacked && 'gap-4')}>
          <GorillaFace size={face} start={0} className="text-ff-text" />
          {stacked && (
            <div className="ff-rv-in font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-ff-muted" style={d(1700)}>
              model online
              <br />
              <span className="num normal-case text-ff-text">{teams.length}</span> teams · <span className="num normal-case text-ff-text">{parts.length}</span> parts
              <br />
              wk <span className="num text-ff-text">{pad2(recap.week)}</span>
            </div>
          )}
        </div>
        {math}
      </div>
    </Fit>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Data

type Card = { key: string; kind: 'team'; t: RecapTeam } | { key: string; kind: 'pos'; pos: string; id: string; pts: number; owner: number; started: boolean } | { key: string; kind: 'boom'; id: string; pts: number; proj: number; owner: number }

const CARD_H = 58
const GAP = 10

/**
 * The week on an open canvas: a card for every team and for the week's standouts, shuffled around the plane. Cards
 * trade places on smooth arcs, leave a ghost where they were and a vector to where they went; where there are more
 * cards than room, one wipes out and another wipes into its place.
 */
export const DataAct = ({ recap, box, stacked, dur }: { recap: Recap; box: Box; stacked: boolean; dur: number }) => {
  const { data } = useFantasy()
  const railW = stacked ? 0 : 212
  const stripH = stacked ? 54 : 0
  const cw = box.w - (stacked ? 0 : railW + 28)
  const ch = box.h - stripH
  const cards = useMemo<Card[]>(() => {
    const out: Card[] = recap.teams.map((t) => ({ key: `t${t.rosterId}`, kind: 'team', t }))
    for (const s of recap.stars) out.push({ key: `p${s.pos}`, kind: 'pos', pos: s.pos, id: s.id, pts: s.pts, owner: s.owner, started: s.started })
    const b = recap.awards.boom
    if (b) out.push({ key: 'boom', kind: 'boom', id: b.id, pts: b.pts, proj: b.proj, owner: b.owner })
    return out
  }, [recap])
  const minW = stacked ? 150 : 176
  const cols = Math.max(2, Math.floor((cw + GAP) / (minW + GAP)))
  // Rows at least 26px apart, so the plane stays open: there is always somewhere to move to.
  // A short canvas (a phone on its side) gets one row of shorter cards rather than rows forced to overlap.
  const cardH = Math.max(36, Math.min(CARD_H, ch))
  const rowsN = Math.max(1, Math.floor((ch + 26) / (cardH + 26)))
  const slots = cols * rowsN
  const cardW = (cw - GAP * (cols - 1)) / cols
  // Spread the rows over the canvas height, so the plane reads as open space rather than a packed table.
  const rowGap = rowsN > 1 ? Math.max(8, (ch - rowsN * cardH) / (rowsN - 1)) : 0
  const at = (s: number) => [(s % cols) * (cardW + GAP), Math.floor(s / cols) * (cardH + rowGap)] as const
  const ticks = Math.max(4, Math.floor((dur - 1400) / 420))

  // The whole shuffle, worked out up front: where every card is (or -1, off the canvas) after each tick.
  const states = useMemo(() => {
    const r = rng(97 + cards.length * 13 + slots)
    const order = cards.map((_, i) => i).sort(() => r() - 0.5)
    // Fill the canvas loosely: every other slot first, so there is room to move into.
    const free = Array.from({ length: slots }, (_, s) => s).sort((a, b) => (a % 2) - (b % 2) || r() - 0.5)
    const slotOf = cards.map(() => -1)
    order.forEach((c, k) => {
      if (k < free.length) slotOf[c] = free[k]
    })
    const out = [slotOf.slice()]
    for (let t = 1; t <= ticks; t++) {
      const cur = out[t - 1].slice()
      for (let o = 0; o < 2; o++) {
        const visible = cur.map((s, c) => (s >= 0 ? c : -1)).filter((c) => c >= 0)
        const hidden = cur.map((s, c) => (s < 0 ? c : -1)).filter((c) => c >= 0)
        if (hidden.length && r() < 0.5) {
          // Out with one, in with another, in the same place.
          const v = visible[Math.floor(r() * visible.length)]
          const h = hidden[Math.floor(r() * hidden.length)]
          cur[h] = cur[v]
          cur[v] = -1
        } else {
          const c = visible[Math.floor(r() * visible.length)]
          const to = Math.floor(r() * slots)
          const there = cur.indexOf(to)
          if (there >= 0) cur[there] = cur[c]
          cur[c] = to
        }
      }
      out.push(cur)
    }
    return out
  }, [cards, slots, ticks])
  const tick = useTicks(ticks, 420, 700)
  const now = states[Math.min(tick, ticks)]
  const was = states[Math.max(0, Math.min(tick, ticks) - 1)]
  const moved = cards.map((_, c) => tick > 0 && now[c] >= 0 && was[c] >= 0 && now[c] !== was[c])

  const scores = recap.teams.map((t) => t.points).filter((x) => x > 0)
  const max = Math.max(...scores, 1)
  const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
  const sd = Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / (scores.length || 1))
  const readings: [string, number, number][] = [
    ['teams', recap.teams.length, 0],
    ['games', recap.games.length, 0],
    ['points', scores.reduce((a, b) => a + b, 0), 1],
    ['mean', mean, 1],
    ['σ', sd, 1],
    ['high', Math.max(...scores, 0), 1],
    ['low', scores.length ? Math.min(...scores) : 0, 1],
  ]
  const name = (id: string) => data.players[id]?.name ?? id
  const body = (c: Card) => {
    if (c.kind === 'team') {
      const t = c.t
      return (
        <>
          <span className={cx('absolute inset-y-0 left-0 w-[2px]', t.result === 'W' ? 'bg-ff-accent' : t.result === 'L' ? 'bg-ff-neg' : 'bg-ff-line2')} />
          <span className="block truncate text-[12px] leading-tight">
            <TeamLabel id={t.rosterId} avatar={16} />
          </span>
          <span className="mt-1 flex items-baseline justify-between font-mono text-[10.5px]">
            <span className={t.result === 'W' ? 'text-ff-pos' : t.result === 'L' ? 'text-ff-neg' : 'text-ff-muted'}>
              {t.result ?? '–'} <span className="num text-ff-text">{fmt(t.points)}</span>
            </span>
            <span className="num text-ff-muted">#{t.weekRank}</span>
          </span>
        </>
      )
    }
    if (c.kind === 'pos')
      return (
        <>
          <span className="absolute inset-y-0 left-0 w-[2px] bg-[rgb(var(--ff-gold))]" />
          <span className="flex items-center gap-1.5 text-[12px] leading-tight">
            <PosTag pos={c.pos} className="!h-[15px] !w-[26px] !text-[9px]" />
            <span className="min-w-0 truncate text-ff-text">{name(c.id)}</span>
          </span>
          <span className="mt-1 flex items-baseline justify-between font-mono text-[10.5px]">
            <span className="num text-ff-text">{fmt(c.pts)}</span>
            <span className="min-w-0 truncate pl-2 text-ff-muted">{c.started ? 'best ' + c.pos.toLowerCase() : 'benched'}</span>
          </span>
        </>
      )
    return (
      <>
        <span className="absolute inset-y-0 left-0 w-[2px] bg-ff-pos" />
        <span className="block truncate text-[12px] leading-tight text-ff-text">{name(c.id)}</span>
        <span className="mt-1 flex items-baseline justify-between font-mono text-[10.5px]">
          <span className="text-ff-pos">
            boom <span className="num">+{fmt(c.pts - c.proj)}</span>
          </span>
          <span className="num text-ff-muted">{fmt(c.pts)}</span>
        </span>
      </>
    )
  }

  return (
    <div className="absolute inset-0">
      {stacked && (
        <dl className="mb-2 grid h-[46px] grid-cols-4 gap-px border border-ff-line bg-ff-line">
          {[readings[1], readings[3], readings[5], ['sims', RECAP_SIMS * 2, 0] as [string, number, number]].map(([k, v, digits], i) => (
            <div key={k} className="ff-rv-in bg-ff-panel px-2 py-1" style={d(100 + i * 70)}>
              <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-ff-muted">{k}</dt>
              <dd className="text-[12.5px] text-ff-text">
                <Count to={v} digits={digits} delay={200 + i * 70} dur={1600} group />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="relative" style={{ width: cw, height: ch }}>
        {/* A scan sweeping the plane while the cards move. */}
        <span aria-hidden className="ff-rv-sweepx pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-ff-accent shadow-[0_0_12px_2px_rgb(var(--ff-accent)/0.3)]" style={{ '--w': `${cw}px` } as CSSProperties} />
        {/* Ghosts where cards just were, and the vectors to where they went. */}
        <svg width={cw} height={ch} className="ff-dg ff-rv-art pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
          {[tick - 1, tick].flatMap((k) => {
            if (k < 1) return []
            const a = states[Math.min(k, ticks)]
            const b = states[Math.min(k - 1, ticks)]
            return cards.map((_, c) => ({ k, c, from: b[c], to: a[c] })).filter((m) => m.from >= 0 && m.to >= 0 && m.from !== m.to)
          }).map(({ k, c, from: f, to }) => {
            const [x0, y0] = at(f)
            const [x1, y1] = at(to)
            const ax0 = x0 + cardW / 2
            const ay0 = y0 + cardH / 2
            const ax1 = x1 + cardW / 2
            const ay1 = y1 + cardH / 2
            const len = Math.hypot(ax1 - ax0, ay1 - ay0) || 1
            const ux = (ax1 - ax0) / len
            const uy = (ay1 - ay0) / len
            return (
              <g key={`${k}-${c}`} className="ff-rv-fade">
                <rect x={x0 + 0.5} y={y0 + 0.5} width={cardW - 1} height={cardH - 1} className="ff-rv-ghost" />
                <path d={`M${ax0} ${ay0}L${ax1} ${ay1}`} pathLength={1} className="ff-rv-qdraw ff-rv-hot" />
                <path d={`M${ax1 - ux * 7 - uy * 3.5} ${ay1 - uy * 7 + ux * 3.5}L${ax1} ${ay1}L${ax1 - ux * 7 + uy * 3.5} ${ay1 - uy * 7 - ux * 3.5}`} className="ff-rv-hot" />
                <rect x={ax0 - 2} y={ay0 - 2} width={4} height={4} className="ff-rv-node-hot" />
              </g>
            )
          })}
        </svg>
        {cards.map((c, i) => {
          const s = now[i]
          const prev = was[i]
          const shown = s >= 0
          // A card coming back on jumps to its new place while it is hidden; one already showing travels.
          const pos = shown ? s : prev >= 0 ? prev : 0
          const [x, y] = at(pos)
          const travel = shown && prev >= 0
          return (
            <div
              key={c.key}
              className={cx('ff-rv-card absolute left-0 top-0 overflow-hidden border bg-ff-panel py-1.5 pl-2.5 pr-2', moved[i] ? 'border-ff-accent' : 'border-ff-line2')}
              data-shown={shown ? '' : undefined}
              style={{
                width: cardW,
                height: cardH,
                transform: `translate(${x}px, ${y}px)`,
                transition: travel ? undefined : 'clip-path 300ms var(--ff-ease-out) 140ms, opacity 300ms ease 140ms',
              }}
            >
              <span className="ff-rv-in block" style={d(450 + i * 45)}>
                {body(c)}
              </span>
              {moved[i] &&
                ['left-0 top-0 border-l border-t', 'right-0 top-0 border-r border-t', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'].map((k) => (
                  <span key={`${tick}${k}`} aria-hidden className={cx('ff-rv-tick absolute h-2 w-2 border-ff-accent', k)} />
                ))}
            </div>
          )
        })}
      </div>
      {!stacked && (
        <aside className="absolute right-0 top-0" style={{ width: railW }}>
          <div className="ff-rv-in mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted" style={d(150)}>
            Sample · wk {pad2(recap.week)} final
          </div>
          <dl className="border-t border-ff-line">
            {readings.map(([k, v, digits], i) => (
              <div key={k} className="ff-rv-in flex h-7 items-center justify-between border-b border-ff-line/70 font-mono text-[11px]" style={d(200 + i * 80)}>
                <dt className="uppercase tracking-[0.08em] text-ff-muted">{k === 'σ' ? <span className="normal-case">σ</span> : k}</dt>
                <dd className="text-ff-text">
                  <Count to={v} digits={digits} delay={300 + i * 80} dur={1600} group />
                </dd>
              </div>
            ))}
            <div className="ff-rv-in flex h-7 items-center justify-between border-b border-ff-line/70 font-mono text-[11px]" style={d(200 + readings.length * 80)}>
              <dt className="uppercase tracking-[0.08em] text-ff-muted">seasons</dt>
              <dd className="text-ff-text">
                <Count to={RECAP_SIMS * 2} digits={0} delay={900} dur={2600} group />
              </dd>
            </div>
          </dl>
          {/* The distribution only where the stage is tall enough to hold it under the readings. */}
          {box.h >= 440 && (
            <>
          <div className="ff-rv-in mb-2 mt-5 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted" style={d(900)}>
            <span>Distribution</span>
            <span className="num normal-case">n={scores.length}</span>
          </div>
          <div className="relative flex h-20 items-end gap-[3px] border-b border-ff-text2/60">
            {[...scores]
              .sort((a, b) => b - a)
              .map((sc, i) => (
                <span key={i} className={cx('ff-rv-y flex-1', i === 0 ? 'bg-[rgb(var(--ff-gold))]' : 'bg-ff-accent/70')} style={{ height: `${(sc / max) * 100}%`, ...d(1000 + i * 45) }} />
              ))}
            <span aria-hidden className="ff-rv-x absolute inset-x-0 border-t border-dashed border-ff-text2/60" style={{ bottom: `${(mean / max) * 100}%`, ...d(1600) }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ff-muted">
            <span>high</span>
            <span>— mean</span>
            <span>low</span>
          </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Launch

/** How long the ball is in the air, and when it leaves. */
export const FLIGHT = { lead: 250, air: 1150 }

/**
 * A football on a tracked arc, the bridge into the ranking: the predicted path dashed across the plane, the flown
 * path drawn in behind the ball, the apex marked as it passes, a velocity vector riding along, and the landing
 * bracketed where the ranking will begin.
 */
export const LaunchAct = ({ box, recap }: { box: Box; recap: Recap }) => {
  const { w, h } = box
  // A short, tidy throw through the middle of the plane: about two thirds of its width, never more than 640px, and
  // never higher than half its run, so a tall phone gets a lob rather than a moonshot.
  const run = Math.min(Math.round(w * 0.66), 640)
  const x0 = Math.round((w - run) / 2)
  const x1 = x0 + run
  const g = Math.round(h * 0.76)
  const apex = Math.round(Math.min(h * 0.42, run * 0.5))
  const xm = (x0 + x1) / 2
  // A quadratic Bézier peaks at half its control point's height.
  const path = `M${x0} ${g}Q${xm} ${g - apex * 2} ${x1} ${g}`
  const theta = Math.atan((4 * apex) / (x1 - x0))
  const deg = (theta * 180) / Math.PI
  const vars = { '--dx': `${x1 - x0}px`, '--h': `${apex}px`, '--rot': `${deg}deg`, '--air': `${FLIGHT.air}ms`, '--lead': `${FLIGHT.lead}ms` } as CSSProperties
  return (
    <div className="absolute inset-0" style={vars}>
      <svg width={w} height={h} className="ff-dg ff-rv-art absolute inset-0" aria-hidden>
        {/* Ground, with a ruler. */}
        <path d={`M0 ${g}H${w}`} pathLength={1} className="draw ff-rv-ink" style={d(0)} />
        {Array.from({ length: Math.floor(w / 24) }, (_, i) => (
          <path key={i} d={`M${i * 24 + 12} ${g}V${g + (i % 5 === 0 ? 8 : 4)}`} className="in ff-rv-cons" style={d(80 + i * 8)} />
        ))}
        {/* The predicted path, dashed, and the flown one drawing in behind the ball. */}
        <path d={path} className="in ff-rv-predict" style={d(120)} />
        <path d={path} pathLength={1} className="ff-rv-flown ff-rv-hot" />
        {/* Apex: a dropped line, a crosshair and its reading, as the ball passes. */}
        <g className="in" style={d(FLIGHT.lead + FLIGHT.air / 2)}>
          <path d={`M${xm} ${g - apex}V${g}`} className="ff-rv-cons" strokeDasharray="2 3" />
          <path d={`M${xm - 7} ${g - apex}H${xm + 7}M${xm} ${g - apex - 7}V${g - apex + 7}`} className="ff-rv-hot" />
          <text x={xm + 10} y={g - apex - 8} className="lbl">
            APEX · h {apex} · t {(FLIGHT.air / 2000).toFixed(2)}s
          </text>
        </g>
        {/* Launch angle at the start, the landing bracket at the end. */}
        <g className="in" style={d(200)}>
          <path d={`M${x0} ${g}L${x0 + 40} ${g}M${x0 + 26} ${g}A26 26 0 0 0 ${x0 + 26 * Math.cos(theta)} ${g - 26 * Math.sin(theta)}`} className="ff-rv-cons" />
          <text x={x0 + 30} y={g - 8} className="lbl">
            θ {deg.toFixed(0)}°
          </text>
        </g>
        <g className="in" style={d(FLIGHT.lead + FLIGHT.air - 150)}>
          <path d={`M${x1 - 18} ${g - 14}V${g - 20}H${x1 - 12}M${x1 + 12} ${g - 20}H${x1 + 18}V${g - 14}M${x1 - 18} ${g + 8}V${g + 14}H${x1 - 12}M${x1 + 12} ${g + 14}H${x1 + 18}V${g + 8}`} className="ff-rv-hot" />
          <text x={x1} y={g + 28} textAnchor="middle" className="lbl">
            WK {pad2(recap.week)} → RANK
          </text>
        </g>
      </svg>
      <span aria-hidden className="ff-rv-ping-land absolute h-10 w-10 border border-ff-accent" style={{ left: x1 - 20, top: g - 20, ...d(FLIGHT.lead + FLIGHT.air) }} />
      {/* The ball: across at a steady speed, up and down on the arc, turned along its path. */}
      <div className="ff-rv-ball-x absolute" style={{ left: x0 - 28, top: g - 18 }}>
        <div className="ff-rv-ball-y">
          <div className="ff-rv-ball-r relative">
            <Football />
            <span aria-hidden className="absolute left-[58px] top-[17px] h-px w-7 bg-ff-accent" />
            <span aria-hidden className="absolute left-[81px] top-[14px] h-[7px] w-[7px] rotate-45 border-r border-t border-ff-accent" />
            <span className="lbl absolute left-[64px] top-[3px] font-mono text-[9px] text-ff-accent">v</span>
          </div>
        </div>
      </div>
      <dl className="ff-rv-in absolute left-0 top-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 border border-ff-line bg-ff-panel/90 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em]" style={d(100)}>
        <dt className="text-ff-muted">range</dt>
        <dd className="num text-ff-text">{x1 - x0}</dd>
        <dt className="text-ff-muted">apex</dt>
        <dd className="num text-ff-text">{apex}</dd>
        <dt className="text-ff-muted">θ₀</dt>
        <dd className="num text-ff-text">{deg.toFixed(1)}°</dd>
        <dt className="text-ff-muted">t</dt>
        <dd className="text-ff-text">
          <Count to={FLIGHT.air / 1000} digits={2} delay={FLIGHT.lead} dur={FLIGHT.air} />s
        </dd>
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Rank

export type RankPhase = 'frame' | 'last' | 'mid' | 'third' | 'second' | 'tension' | 'first'

/**
 * When each part of the presentation starts, in ms from the start of the act: last place slowly, the middle fast,
 * then No. 3, No. 2 and No. 1 slower each time. `total` is when the act hands over to the recap.
 */
export const rankSchedule = (recap: Recap) => {
  const n = recap.teams.length
  const hasLast = n >= 4
  const mid = recap.teams.filter((t) => t.rankAfter > 3 && t.rankAfter < n).map((t) => t.rosterId)
  const midStart = [...mid].sort((a, b) => recap.byId[b].points - recap.byId[a].points)
  const passes = sortPasses(midStart, mid)
  const passMs = 130
  const lastAt = 400
  const midAt = hasLast ? lastAt + 1700 : lastAt
  const midEnd = mid.length ? midAt + 380 + mid.length * 40 + passes.length * passMs + 350 : midAt
  // Slower at each step up: No. 3 holds 1.2s, No. 2 1.3s, then a beat of suspense before No. 1, who holds 2.2s.
  const thirdAt = midEnd + 100
  const secondAt = n >= 3 ? thirdAt + 1200 : thirdAt
  const tensionAt = n >= 2 ? secondAt + 1300 : secondAt
  const firstAt = tensionAt + 700
  const total = firstAt + 2200
  return { n, hasLast, mid, midStart, passes, passMs, lastAt, midAt, thirdAt, secondAt, tensionAt, firstAt, total }
}

/** The presentation: the ranking filled in from the bottom, the middle sorted fast, the top three one at a time. */
export const RankAct = ({ recap, box, side, phone, rowH, listRef, onPhase }: { recap: Recap; box: Box; side: boolean; phone: boolean; rowH: number; listRef: React.Ref<HTMLDivElement>; onPhase: (p: RankPhase) => void }) => {
  const sch = useMemo(() => rankSchedule(recap), [recap])
  const [phase, setPhase] = useState<RankPhase>('frame')
  const [pass, setPass] = useState(-1)
  const phaseRef = useRef(onPhase)
  phaseRef.current = onPhase
  useEffect(() => {
    const ts: number[] = []
    const at = (ms: number, f: () => void) => ts.push(window.setTimeout(f, ms))
    const go = (p: RankPhase) => {
      setPhase(p)
      phaseRef.current(p)
    }
    if (sch.hasLast) at(sch.lastAt, () => go('last'))
    if (sch.mid.length) {
      at(sch.midAt, () => go('mid'))
      sch.passes.forEach((_, i) => at(sch.midAt + 380 + sch.mid.length * 40 + i * sch.passMs, () => setPass(i)))
    }
    if (sch.n >= 3) at(sch.thirdAt, () => go('third'))
    if (sch.n >= 2) at(sch.secondAt, () => go('second'))
    at(sch.tensionAt, () => go('tension'))
    at(sch.firstAt, () => go('first'))
    return () => ts.forEach(window.clearTimeout)
  }, [sch])

  const order = ['frame', 'last', 'mid', 'third', 'second', 'tension', 'first'] as RankPhase[]
  const reached = (p: RankPhase) => order.indexOf(phase) >= order.indexOf(p)
  // Where each team sits right now, by slot index, or absent.
  const placed: { id: number; slot: number; how: 'sink' | 'fast' | 'present' | 'gold'; i: number }[] = []
  const n = sch.n
  if (sch.hasLast && reached('last')) placed.push({ id: recap.teams[n - 1].rosterId, slot: n - 1, how: 'sink', i: 0 })
  if (sch.mid.length && reached('mid')) {
    const ord = pass < 0 ? sch.midStart : pass >= sch.passes.length - 1 ? sch.mid : sch.passes[pass].order
    ord.forEach((id, k) => placed.push({ id, slot: 3 + k, how: 'fast', i: k }))
  }
  if (n >= 3 && reached('third')) placed.push({ id: recap.teams[2].rosterId, slot: 2, how: 'present', i: 0 })
  if (n >= 2 && reached('second')) placed.push({ id: recap.teams[1].rosterId, slot: 1, how: 'present', i: 0 })
  if (reached('first')) placed.push({ id: recap.teams[0].rosterId, slot: 0, how: 'gold', i: 0 })
  const filled = new Set(placed.map((p) => p.slot))
  const swaps = pass >= 0 && pass < sch.passes.length ? sch.passes[pass].swaps.map((i) => i + 3) : []
  const crowned = phase === 'first'

  const list = (
    <div ref={listRef} className="relative border-y border-ff-line bg-ff-panel" style={{ height: n * rowH }}>
      {/* The empty slots, waiting: a hairline and the number they will hold. */}
      {Array.from({ length: n }, (_, s) => (
        <div key={s} className={cx('absolute inset-x-0 flex items-center border-b border-dashed border-ff-line2/70 px-3 transition-opacity duration-300', filled.has(s) && 'opacity-0')} style={{ top: s * rowH, height: rowH }}>
          <span className="ml-[34px] h-px w-16 bg-ff-line2/70" />
        </div>
      ))}
      {placed.map(({ id, slot, how, i }) => {
        const t = recap.byId[id]
        const top = how === 'gold'
        const dim = crowned && !top
        return (
          <div key={id} className="ff-rv-slot absolute inset-x-0 top-0" style={{ transform: `translateY(${slot * rowH}px)`, height: rowH, opacity: dim ? 0.45 : 1 }}>
            <div
              className={cx(
                'relative flex h-full items-center gap-2.5 border-b border-ff-line/60 px-3',
                how === 'sink' ? 'ff-rv-sink ff-rv-last-row' : how === 'fast' ? 'ff-rv-rise' : 'ff-rv-present',
                top && 'ff-rv-gold-row',
              )}
              style={d(how === 'fast' ? i * 40 : 0)}
            >
              <RowBody team={t} rank={slot + 1} showRank={false} showMove moveIn={how === 'fast' ? 300 : 500} crowned={top} hatDelay={1100} />
              {(how === 'present' || how === 'gold') &&
                (
                  [
                    ['left-0 top-0 border-l border-t', '-8px', '-8px'],
                    ['right-0 top-0 border-r border-t', '8px', '-8px'],
                    ['bottom-0 left-0 border-b border-l', '-8px', '8px'],
                    ['bottom-0 right-0 border-b border-r', '8px', '8px'],
                  ] as const
                ).map(([cls, x, y]) => <span key={cls} aria-hidden className={cx(top ? 'ff-rv-corner' : 'ff-rv-corner ff-rv-corner-accent', cls)} style={{ '--cx': x, '--cy': y, ...d(top ? 500 : 120) } as CSSProperties} />)}
            </div>
          </div>
        )
      })}
      {/* Rank numbers belong to the slots: teams arrive at them and move past them. */}
      {Array.from({ length: n }, (_, s) => (
        <span
          key={s}
          aria-hidden
          className={cx('num pointer-events-none absolute left-3 z-10 flex w-6 items-center text-[12px]', s === 0 && crowned ? 'ff-rv-gold font-medium' : s === n - 1 && sch.hasLast && filled.has(s) ? 'text-ff-neg' : 'text-ff-muted')}
          style={{ top: s * rowH, height: rowH }}
        >
          {pad2(s + 1)}
        </span>
      ))}
      <div aria-hidden className="absolute inset-x-0 -top-6 flex h-5 items-end gap-2.5 px-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ff-muted">
        <span className="w-6">rk</span>
        <span className="flex-1" />
        <span className="w-11 text-right">vs lw</span>
        <span className="w-10 text-right">pwr</span>
      </div>
      {side &&
        phase === 'mid' &&
        swaps.map((i) => (
          <span key={`${pass}-${i}`} aria-hidden className="ff-rv-cmp absolute -right-7 flex w-5 items-center" style={{ top: i * rowH + rowH / 2, height: rowH }}>
            <span className="h-full w-2 border-y border-r border-ff-accent" />
            <span className="ml-0.5 font-mono text-[10px] text-ff-accent">⇅</span>
          </span>
        ))}
    </div>
  )
  return (
    <Fit box={box} center={side}>
      <div className={cx('flex', side ? 'items-center justify-center gap-14' : 'flex-col gap-6')}>
        <div className={cx(side ? 'order-2 w-[340px]' : 'h-[104px] shrink-0')}>
          <Presenter key={phase} recap={recap} phase={phase} sch={sch} pass={pass} stacked={!side} />
        </div>
        <div className={cx('pt-6', side ? 'order-1 w-[400px]' : phone ? 'w-full' : 'mx-auto w-[400px] max-w-full')}>{list}</div>
      </div>
    </Fit>
  )
}

/** Beside the list: who is being presented, big. */
const Presenter = ({ recap, phase, sch, pass, stacked }: { recap: Recap; phase: RankPhase; sch: ReturnType<typeof rankSchedule>; pass: number; stacked: boolean }) => {
  const { analysis } = useFantasy()
  const n = sch.n
  const big = stacked ? 'text-[20px]' : 'text-[28px]'
  if (phase === 'frame')
    return (
      <div className="ff-rv-swap-in font-mono text-[11px] uppercase tracking-[0.12em] text-ff-muted">
        Ranking {n} teams
        <span className="ff-rv-blink ml-1 inline-block h-2.5 w-1.5 translate-y-px bg-ff-accent" />
      </div>
    )
  if (phase === 'mid') {
    const lo = 4
    const hi = n - (sch.hasLast ? 1 : 0)
    return (
      <div className="ff-rv-swap-in font-mono text-[11px] uppercase tracking-[0.1em] text-ff-muted">
        <div className="text-ff-text2">
          Nos. {pad2(lo)}–{pad2(hi)} · sorting the middle
        </div>
        <div className="mt-2 grid w-[220px] grid-cols-2 gap-px border border-ff-line bg-ff-line">
          <div className="bg-ff-panel px-2.5 py-1.5">
            <div className="text-[9.5px]">pass</div>
            <div className="num text-[15px] text-ff-text">
              {pad2(Math.max(0, Math.min(pass + 1, sch.passes.length)))}
              <span className="text-ff-muted">/{pad2(sch.passes.length)}</span>
            </div>
          </div>
          <div className="bg-ff-panel px-2.5 py-1.5">
            <div className="text-[9.5px]">teams</div>
            <div className="num text-[15px] text-ff-text">{pad2(sch.mid.length)}</div>
          </div>
        </div>
      </div>
    )
  }
  if (phase === 'last') {
    const t = recap.teams[n - 1]
    return (
      <div className={cx('ff-rv-swap-in flex', stacked ? 'items-center gap-4' : 'flex-col items-start')}>
        <Poop size={stacked ? 64 : 104} start={250} className={stacked ? '' : 'mb-3'} />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em]">
            <span className="text-ff-neg">No. {pad2(n)} · last place</span>
          </div>
          <div className={cx('ff-rv-sink mt-1 truncate font-medium leading-tight tracking-[-0.015em]', big)} style={d(300)}>
            <TeamLabel id={t.rosterId} />
          </div>
          <div className="ff-rv-in mt-1.5 font-mono text-[11px] text-ff-muted" style={d(700)}>
            {t.wins}-{t.losses}
            {t.ties ? `-${t.ties}` : ''} · power {fmt(t.scoreAfter)}
            {t.reasons[0] && (
              <>
                {' · '}
                <span className="font-plex normal-case">
                  <Phrase parts={t.reasons[0].parts} />
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }
  if (phase === 'third' || phase === 'second') {
    const t = recap.teams[phase === 'third' ? 2 : 1]
    return (
      <div className={cx('ff-rv-swap-in flex', stacked ? 'items-center gap-4' : 'flex-col items-start')}>
        <div className={cx('num leading-none tracking-[-0.04em] text-ff-text', stacked ? 'text-[56px]' : 'mb-2 text-[96px]')}>
          <Resolve text={pad2(t.rankAfter)} dur={400} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ff-accent">No. {pad2(t.rankAfter)}</div>
          <div className={cx('ff-rv-wipe mt-1 truncate font-medium leading-tight tracking-[-0.015em]', big)} style={d(250)}>
            <TeamLabel id={t.rosterId} />
          </div>
          <div className="ff-rv-in mt-1.5 font-mono text-[11px] text-ff-muted" style={d(500)}>
            {t.wins}-{t.losses}
            {t.ties ? `-${t.ties}` : ''} · power {fmt(t.scoreAfter)} · {t.move > 0 ? `up ${t.move}` : t.move < 0 ? `down ${-t.move}` : 'held'}
          </div>
          {!stacked && t.reasons[0] && (
            <div className="ff-rv-in mt-2 max-w-[320px] text-[13px] leading-snug text-ff-text2" style={d(650)}>
              <Phrase parts={t.reasons[0].parts} />
            </div>
          )}
        </div>
      </div>
    )
  }
  const top = recap.teams[0]
  const name = analysis.teamById[top.rosterId]?.name ?? ''
  if (phase === 'tension')
    return (
      <div className={cx('ff-rv-swap-in flex', stacked ? 'items-center gap-4' : 'flex-col items-start')}>
        <div className={cx('relative flex shrink-0 items-center justify-center border border-dashed border-ff-line2', stacked ? 'h-[72px] w-[72px]' : 'mb-4 h-[132px] w-[132px]')}>
          <span className="ff-rv-scan-box absolute inset-x-0 top-0 h-px bg-[rgb(var(--ff-gold))]" style={{ '--h': stacked ? '71px' : '131px' } as CSSProperties} />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ff-muted">no. 01</span>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ff-muted">Resolving No. 01</div>
          <div className={cx('mt-1 truncate font-medium leading-tight tracking-[-0.015em] text-ff-text', big)}>
            <Resolve text={name} dur={700} />
          </div>
        </div>
      </div>
    )
  const before = top.rankBefore
  return (
    <div className={cx('ff-rv-swap-in flex', stacked ? 'items-center gap-4' : 'flex-col items-start')}>
      <div className={cx('relative flex shrink-0 items-center justify-center', stacked ? 'h-[72px] w-[72px]' : 'mb-4 h-[132px] w-[132px]')}>
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(450)} />
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(800)} />
        <span aria-hidden className="ff-rv-in absolute inset-0 border border-[rgb(var(--ff-gold)/0.6)]" style={d(0)} />
        {['left-1/2 top-0 h-2 w-px', 'left-1/2 bottom-0 h-2 w-px', 'top-1/2 left-0 h-px w-2', 'top-1/2 right-0 h-px w-2'].map((c) => (
          <span key={c} aria-hidden className={cx('ff-rv-in absolute bg-[rgb(var(--ff-gold))]', c)} style={d(250)} />
        ))}
        <Crown size={stacked ? 46 : 84} drawing delay={60} title="Crowned No. 1" />
      </div>
      <div className="min-w-0">
        <div className="ff-rv-wipe font-mono text-[11px] uppercase tracking-[0.16em]" style={d(600)}>
          <span className="ff-rv-gold">No. 01</span>
          <span className="text-ff-muted"> · week {recap.week}</span>
        </div>
        <div className={cx('ff-rv-in mt-1 truncate font-medium leading-tight tracking-[-0.015em]', stacked ? 'text-[22px]' : 'text-[32px]')} style={d(200)}>
          <TeamLabel id={top.rosterId} />
        </div>
        <div className="ff-rv-rise mt-1.5 font-mono text-[11px] text-ff-muted" style={d(900)}>
          {top.wins}-{top.losses}
          {top.ties ? `-${top.ties}` : ''} · power {fmt(top.scoreAfter)} · {(before === 1 ? 'holds No. 1 for another week' : `up from No. ${before}`).toLowerCase()}
        </div>
        {!stacked && top.reasons[0] && (
          <div className="ff-rv-rise mt-3 max-w-[320px] text-[13px] leading-snug text-ff-text2" style={d(1050)}>
            <Phrase parts={top.reasons[0].parts} />
          </div>
        )}
      </div>
    </div>
  )
}
