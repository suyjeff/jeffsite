import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { PowerWeights } from '../../lib/fantasy/power'
import { sortPasses, type Recap } from '../../lib/fantasy/recap'
import { MONKE } from './brand'
import { useFantasy } from './FantasyContext'
import { Phrase, RowBody, TeamLabel } from './PowerRecap'
import { GorillaFace, Poop } from './RevealArt'
import { Crown } from './RevealBanner'
import { cx, fmt } from './ui'

// The two acts of the power-rank reveal (PowerReveal.tsx runs them in order):
//   Model      the model introduces itself: a gorilla drawn as a technical study, its name, and the composite
//              computed live, team by team, from the week's real numbers.
//   Rank       the presentation: last place, the middle sorted in a pass or two, then No. 3, No. 2 and No. 1.
// Every motion is a transform, an opacity or a stroke being drawn; the CSS lives in fantasy.css (.ff-rv-*).

export const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
export type Box = { w: number; h: number }

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
  // The scan starts as the matrix fills, then steps a row at a time: quicker in a big league, so it always reaches the
  // last row a beat before the act hands over.
  const scanAt = 900
  const row = useTicks(teams.length - 1, Math.min(110, Math.max(30, (dur - scanAt - 220) / Math.max(1, teams.length - 1))), scanAt)
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
            <span key={i} className={cx('ff-rv-in', c === '.' && 'text-ff-accent')} style={d(120 + i * 30)}>
              {c}
            </span>
          ))}
        </div>
        <div className="ff-rv-wipe mt-1.5 text-[9.5px] tracking-[0.14em] text-ff-muted sm:text-[10.5px]" style={d(380)}>
          {MONKE.long}
        </div>
      </div>
      <div className="ff-rv-in mt-4 font-mono text-[11px] text-ff-text2" style={d(460)}>
        power = Φ( <span className="text-ff-accent">Σ wᵢ·zᵢ</span> · σ<sub className="text-[8px]">ppg</sub> / √2σ )
      </div>
      {/* The league as a matrix of z-scores, filled a column at a time, with the scan working down it. */}
      <div className="relative mt-2.5 font-mono text-[10px]">
        <div className="flex border-b border-ff-line pb-1 text-ff-muted">
          <span className="w-[92px] shrink-0 uppercase tracking-[0.08em] sm:w-[120px]">team</span>
          {parts.map((p, c) => (
            <span key={p.key} className="ff-rv-in w-11 shrink-0 text-right uppercase" style={d(500 + c * 45)}>
              {p.label}
              <span className="block text-[9px] text-ff-accent">{recap.weights[p.key].toFixed(2)}</span>
            </span>
          ))}
          <span className="ff-rv-in w-12 shrink-0 text-right uppercase text-ff-text" style={d(760)}>
            pwr
          </span>
        </div>
        <div className="relative">
          <span aria-hidden className="ff-rv-scanrow absolute inset-x-0 top-0 border-y border-ff-accent/70 bg-ff-accent/[0.07]" style={{ height: rowH, transform: `translateY(${Math.min(row, teams.length - 1) * rowH}px)` }} />
          {teams.map((t, r) => (
            <div key={t.rosterId} className="relative flex items-center" style={{ height: rowH }}>
              <span className="ff-rv-in w-[92px] shrink-0 truncate pr-2 font-plex text-[10.5px] sm:w-[120px]" style={d(500 + r * 14)}>
                <TeamLabel id={t.rosterId} />
              </span>
              {parts.map((p, c) => (
                <span key={p.key} className="ff-rv-in num w-11 shrink-0 text-right" style={{ ...d(540 + c * 45 + r * 8), background: zShade(t.components[p.key]) }}>
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
          <GorillaFace size={face} start={0} speed={0.5} className="text-ff-text" />
          {stacked && (
            <div className="ff-rv-in font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-ff-muted" style={d(700)}>
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
// Rank

export type RankPhase = 'frame' | 'last' | 'mid' | 'third' | 'second' | 'tension' | 'first'

/**
 * When each part of the presentation starts, in ms from the start of the act: last place for a beat, the middle risen
 * and sorted in a pass or two, then No. 3, No. 2 and No. 1, each held just long enough to read. `total` is when the act
 * hands over to the recap.
 */
export const rankSchedule = (recap: Recap) => {
  const n = recap.teams.length
  const hasLast = n >= 4
  const mid = recap.teams.filter((t) => t.rankAfter > 3 && t.rankAfter < n).map((t) => t.rosterId)
  const midStart = [...mid].sort((a, b) => recap.byId[b].points - recap.byId[a].points)
  const all = sortPasses(midStart, mid)
  // Two steps on screen at most: one or two passes play as they are, with their comparators; more fold into a halfway
  // order and the final one, so a big shuffle still lands in about half a second.
  const passes = all.length <= 2 ? all : [{ order: all[Math.ceil(all.length / 2) - 1].order, swaps: [] as number[] }, { order: all[all.length - 1].order, swaps: [] as number[] }]
  const passMs = 260
  const lastAt = 120
  const midAt = hasLast ? lastAt + 950 : lastAt
  // The middle rises in, a row every 22ms, before its first pass.
  const riseMs = mid.length ? 160 + mid.length * 22 : 0
  const midEnd = mid.length ? midAt + riseMs + passes.length * passMs + 120 : midAt
  const thirdAt = midEnd
  const secondAt = n >= 3 ? thirdAt + 1000 : thirdAt
  const tensionAt = n >= 2 ? secondAt + 1050 : secondAt
  const firstAt = tensionAt + 450
  const total = firstAt + 1600
  return { n, hasLast, mid, midStart, passes, passMs, lastAt, midAt, riseMs, thirdAt, secondAt, tensionAt, firstAt, total }
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
      sch.passes.forEach((_, i) => at(sch.midAt + sch.riseMs + i * sch.passMs, () => setPass(i)))
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
              style={d(how === 'fast' ? i * 22 : 0)}
            >
              <RowBody team={t} rank={slot + 1} showRank={false} showMove moveIn={how === 'fast' ? 180 : 260} crowned={top} hatDelay={520} />
              {(how === 'present' || how === 'gold') &&
                (
                  [
                    ['left-0 top-0 border-l border-t', '-8px', '-8px'],
                    ['right-0 top-0 border-r border-t', '8px', '-8px'],
                    ['bottom-0 left-0 border-b border-l', '-8px', '8px'],
                    ['bottom-0 right-0 border-b border-r', '8px', '8px'],
                  ] as const
                ).map(([cls, x, y]) => <span key={cls} aria-hidden className={cx(top ? 'ff-rv-corner' : 'ff-rv-corner ff-rv-corner-accent', cls)} style={{ '--cx': x, '--cy': y, ...d(top ? 260 : 60) } as CSSProperties} />)}
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
        <Poop size={stacked ? 64 : 104} start={60} speed={0.5} className={stacked ? '' : 'mb-3'} />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em]">
            <span className="text-ff-neg">No. {pad2(n)} · last place</span>
          </div>
          <div className={cx('ff-rv-sink mt-1 truncate font-medium leading-tight tracking-[-0.015em]', big)} style={d(120)}>
            <TeamLabel id={t.rosterId} />
          </div>
          <div className="ff-rv-in mt-1.5 font-mono text-[11px] text-ff-muted" style={d(300)}>
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
          <Resolve text={pad2(t.rankAfter)} dur={280} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ff-accent">No. {pad2(t.rankAfter)}</div>
          <div className={cx('ff-rv-wipe mt-1 truncate font-medium leading-tight tracking-[-0.015em]', big)} style={d(120)}>
            <TeamLabel id={t.rosterId} />
          </div>
          <div className="ff-rv-in mt-1.5 font-mono text-[11px] text-ff-muted" style={d(260)}>
            {t.wins}-{t.losses}
            {t.ties ? `-${t.ties}` : ''} · power {fmt(t.scoreAfter)} · {t.move > 0 ? `up ${t.move}` : t.move < 0 ? `down ${-t.move}` : 'held'}
          </div>
          {!stacked && t.reasons[0] && (
            <div className="ff-rv-in mt-2 max-w-[320px] text-[13px] leading-snug text-ff-text2" style={d(360)}>
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
            <Resolve text={name} dur={420} />
          </div>
        </div>
      </div>
    )
  const before = top.rankBefore
  return (
    <div className={cx('ff-rv-swap-in flex', stacked ? 'items-center gap-4' : 'flex-col items-start')}>
      <div className={cx('relative flex shrink-0 items-center justify-center', stacked ? 'h-[72px] w-[72px]' : 'mb-4 h-[132px] w-[132px]')}>
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(250)} />
        <span aria-hidden className="ff-rv-ping absolute inset-[18%]" style={d(500)} />
        <span aria-hidden className="ff-rv-in absolute inset-0 border border-[rgb(var(--ff-gold)/0.6)]" style={d(0)} />
        {['left-1/2 top-0 h-2 w-px', 'left-1/2 bottom-0 h-2 w-px', 'top-1/2 left-0 h-px w-2', 'top-1/2 right-0 h-px w-2'].map((c) => (
          <span key={c} aria-hidden className={cx('ff-rv-in absolute bg-[rgb(var(--ff-gold))]', c)} style={d(150)} />
        ))}
        <Crown size={stacked ? 46 : 84} drawing delay={60} title="Crowned No. 1" />
      </div>
      <div className="min-w-0">
        <div className="ff-rv-wipe font-mono text-[11px] uppercase tracking-[0.16em]" style={d(320)}>
          <span className="ff-rv-gold">No. 01</span>
          <span className="text-ff-muted"> · week {recap.week}</span>
        </div>
        <div className={cx('ff-rv-in mt-1 truncate font-medium leading-tight tracking-[-0.015em]', stacked ? 'text-[22px]' : 'text-[32px]')} style={d(120)}>
          <TeamLabel id={top.rosterId} />
        </div>
        <div className="ff-rv-rise mt-1.5 font-mono text-[11px] text-ff-muted" style={d(480)}>
          {top.wins}-{top.losses}
          {top.ties ? `-${top.ties}` : ''} · power {fmt(top.scoreAfter)} · {(before === 1 ? 'holds No. 1 for another week' : `up from No. ${before}`).toLowerCase()}
        </div>
        {!stacked && top.reasons[0] && (
          <div className="ff-rv-rise mt-3 max-w-[320px] text-[13px] leading-snug text-ff-text2" style={d(620)}>
            <Phrase parts={top.reasons[0].parts} />
          </div>
        )}
      </div>
    </div>
  )
}
