import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MONKE } from './brand'
import { useRevealOdds } from './revealOdds'
import { useFantasy } from './FantasyContext'
import PowerRecap from './PowerRecap'
import { CalibrateAct, DataAct, FLIGHT, LaunchAct, ModelAct, RankAct, pad2, rankSchedule, reducedMotion, useBox, type RankPhase } from './RevealActs'
import { Crown } from './RevealBanner'
import { ShareButton } from './RevealShare'
import SwipeSheet, { type SwipeSheetHandle } from './SwipeSheet'
import { lockScroll } from './scrollLock'
import { cx, usePhone } from './ui'
import type { RevealApi, RevealSource } from './useReveal'

// The weekly power-rank reveal: five acts (RevealActs.tsx), then the recap.
//   Calibrate  2.3s  an empty plane, tiles tessellating, every corner tracked
//   M.O.N.K.E. 3.1s  the model's face drawn as a study, the composite worked through with real numbers
//   Data       4.2s  the week's teams and standouts shuffling on an open canvas
//   Launch     2.2s  a football on a tracked arc into the ranking
//   Rank       ~11.5s last place, the middle sorted, then No. 3, No. 2 and No. 1, each held long enough to read, crowned (about 23s in all)
// It then hands its ranking over to the recap (PowerRecap.tsx). A tap, Space or Skip jumps to the end; Replay plays it
// again. Wide screens get a framed modal over the shaded page; phones a full-height sheet that swipes down to close.
// Reduced motion skips the acts and fades the recap in.

type Act = 'calibrate' | 'model' | 'data' | 'launch' | 'rank'
const ACTS: { key: Act; title: string; dur?: number }[] = [
  { key: 'calibrate', title: 'Calibrating', dur: 2300 },
  { key: 'model', title: MONKE.name, dur: 3100 },
  { key: 'data', title: 'Reading the week', dur: 4200 },
  { key: 'launch', title: 'Launch', dur: FLIGHT.lead + FLIGHT.air + 350 },
  { key: 'rank', title: 'Ranking' },
]
const STEPS = ['Calibrate', MONKE.name, 'Data', 'Launch', 'Rank', 'Crown']
/** How long an act takes to fade out under the next one. */
const HANDOFF = 180

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

/** The pipeline along the bottom: which step the reveal is on, and the clock. Compact wherever the frame is narrow. */
const Pipeline = ({ step, running, run }: { step: number; running: boolean; run: number }) => {
  const [ref, box] = useBox<HTMLElement>()
  const compact = !box || box.w < 860
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  return (
    <footer ref={ref} className="flex h-10 shrink-0 items-center gap-3 overflow-hidden border-t border-ff-line px-3">
      {compact ? (
        <>
          <span className="flex shrink-0 gap-[3px]" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={cx('h-1.5 w-4 transition-colors duration-200', i < step ? 'bg-ff-text2/60' : i === step ? 'bg-ff-accent' : 'bg-ff-line2')} />
            ))}
          </span>
          <span className="min-w-0 truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-ff-text2">
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
      {(!box || box.w >= 420) && <span className="shrink-0 font-mono text-[10px] text-ff-muted">{coarse ? 'tap to skip' : 'click or space to skip'}</span>}
      <Clock running={running} run={run} />
    </footer>
  )
}

/**
 * The reveal itself, for a recap already built. `run` restarts it from the top when it changes from outside (a
 * banner pressed while it is open).
 */
export const PowerReveal = ({ source, run, onClose }: { source: RevealSource; run: number; onClose: () => void }) => {
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

  // Playoff odds before and after the week, simulated in idle slices (usually already done by the time it opens).
  const odds = useRevealOdds(source, data, analysis, models)

  // The recap's rows: a full 44px touch target wherever the layout is the phone's, 40px on wide screens.
  const recapRowH = stack ? 44 : 40
  const sch = useMemo(() => rankSchedule(recap), [recap])
  const acts = useMemo(() => ACTS.map((x) => ({ ...x, dur: x.dur ?? sch.total })), [sch])

  const [act, setAct] = useState<Act | 'done'>(reduced ? 'done' : 'calibrate')
  const [leaving, setLeaving] = useState<Act | null>(null)
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<RankPhase>('frame')
  const [play, setPlay] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const from = useRef<DOMRect | null>(null)
  const timers = useRef<number[]>([])

  // Read through refs by the script, so turning a tablet or a new recap object never restarts the show.
  const live = useRef({ n, recapRowH, acts })
  live.current = { n, recapRowH, acts }

  const finish = useCallback((handOver: boolean) => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    // The list slides into the recap only when it is drawn at the recap's size (not scaled, same row height).
    const { n: count, recapRowH: rowH } = live.current
    const r = handOver ? (listRef.current?.getBoundingClientRect() ?? null) : null
    from.current = r && Math.abs(r.height - count * rowH) <= 3 ? r : null
    setLeaving(null)
    setAct('done')
  }, [])

  // The script: each act in turn, the one before fading out under the next. Restarted by Replay, or by `run`.
  useEffect(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    from.current = null
    if (reduced) {
      setAct('done')
      return
    }
    setAct('calibrate')
    setLeaving(null)
    setStep(0)
    setPhase('frame')
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
    const acts = live.current.acts
    let t = 0
    acts.forEach((x, i) => {
      if (i > 0) {
        const prev = acts[i - 1].key
        at(t, () => {
          setLeaving(prev)
          setAct(x.key)
          setStep(i)
        })
        at(t + HANDOFF, () => setLeaving((l) => (l === prev ? null : l)))
      }
      t += x.dur
    })
    at(t, () => finish(true))
    return () => timers.current.forEach(window.clearTimeout)
  }, [play, run, reduced, finish])

  const onPhase = useCallback((p: RankPhase) => {
    setPhase(p)
    if (p === 'tension' || p === 'first') setStep(5)
  }, [])

  const skip = useCallback(() => {
    if (act === 'done') return
    finish(act === 'rank' && phase === 'first')
  }, [act, phase, finish])
  const replay = useCallback(() => setPlay((p) => p + 1), [])
  const [area, box] = useBox<HTMLDivElement>()

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
  const stageRef = useRef(act)
  stageRef.current = act
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
    const unlock = lockScroll()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      unlock()
      back?.focus?.({ preventScroll: true })
    }
  }, [close])

  // Skip and Replay trade places as the intro ends: when the one that had focus goes, focus stays in the dialog.
  useEffect(() => {
    const at = document.activeElement
    if (panel.current && (!at || at === document.body)) panel.current.focus({ preventScroll: true })
  }, [act])

  const intro = act !== 'done'
  const top = recap.teams[0]
  const mine = analysis.myRosterId != null ? recap.byId[analysis.myRosterId] : null
  // What the show says, for a screen reader: the intro is pictures of numbers.
  const summary = `Week ${recap.week}. ${top ? `${analysis.teamById[top.rosterId]?.name} is No. 1.` : ''}${
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
      <span className="flex-1" />
      {intro ? (
        <button type="button" onClick={skip} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text max-md:h-10">
          Skip ›
        </button>
      ) : (
        <>
          {/* On a single-column layout the share sits here; on a wide screen it heads the ranking column. */}
          {stack && <ShareButton recap={recap} icon />}
          <button type="button" onClick={replay} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text max-md:h-10" title="Play the reveal again" aria-label="Replay">
            ↺ <span className="max-[359px]:sr-only">Replay</span>
          </button>
        </>
      )}
      <button type="button" onClick={close} className="h-8 shrink-0 whitespace-nowrap px-2.5 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text max-md:h-10" aria-label={phone ? 'Close' : 'Close (Esc)'}>
        {phone ? 'Done' : 'ESC'}
      </button>
    </header>
  )

  const title = act === 'rank' && (phase === 'tension' || phase === 'first') ? 'The crown' : (acts.find((x) => x.key === act)?.title ?? '')
  const actIndex = acts.findIndex((x) => x.key === act)
  const renderAct = (k: Act) => {
    if (!box) return null
    // Side by side wherever the stage is wide, or wider than it is tall (a phone on its side); stacked otherwise.
    const side = !phone && (box.w >= 760 || box.w > box.h * 1.6)
    if (k === 'calibrate') return <CalibrateAct box={box} dur={acts[0].dur} />
    if (k === 'model') return <ModelAct recap={recap} box={box} stacked={!side} dur={acts[1].dur} />
    if (k === 'data') return <DataAct recap={recap} box={box} stacked={!side} dur={acts[2].dur} />
    if (k === 'launch') return <LaunchAct box={box} recap={recap} />
    // Rows as tall as the recap's when they fit, so the list hands over without a jump, never under 30px.
    const room = side ? box.h - 26 : box.h - 104 - 24 - 26
    const rowH = Math.max(30, Math.min(recapRowH, Math.floor(room / Math.max(1, n))))
    return <RankAct recap={recap} box={box} side={side} phone={phone} rowH={rowH} listRef={listRef} onPhase={onPhase} />
  }

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
        <div className="mb-4 flex shrink-0 items-baseline justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.12em]">
          <span key={title} className="ff-rv-wipe text-ff-text">
            <span className="text-ff-accent">{pad2(title === 'The crown' ? 6 : actIndex + 1)} //</span> {title}
          </span>
          <span className="text-ff-muted">
            wk {pad2(recap.week)} · {recap.games.length} games
          </span>
        </div>
        <div ref={area} className="relative min-h-0 flex-1">
          {/* The act on stage, and the one before it fading out underneath for a moment. */}
          {(leaving ? [leaving, act as Act] : [act as Act]).map((k) => (
            <div key={`${k}-${play}-${run}`} className={cx('absolute inset-0', k === leaving ? 'ff-rv-act-out pointer-events-none' : 'ff-rv-act-in')}>
              {renderAct(k)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const body = (
    <>
      {header}
      {intro ? (
        <>
          {stageEl}
          <Pipeline step={step} running={intro} run={play + run} />
        </>
      ) : (
        <PowerRecap key={`${play}-${run}`} recap={recap} odds={odds} phone={stack} rowH={recapRowH} from={phone || !narrow ? from.current : null} entering />
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
    // A short window (a phone on its side) gives the frame the whole screen, safe areas aside.
    <div
      ref={root}
      className="ff-rv-root fixed inset-0 z-[70] flex items-center justify-center p-6 [@media(max-height:560px)]:pb-[env(safe-area-inset-bottom)] [@media(max-height:560px)]:pl-[env(safe-area-inset-left)] [@media(max-height:560px)]:pr-[env(safe-area-inset-right)] [@media(max-height:560px)]:pt-[env(safe-area-inset-top)]"
      role="presentation"
    >
      {/* Shade only, no backdrop blur: blurring the page under a moving frame costs every frame on a weak GPU. */}
      <div className="ff-rv-shade absolute inset-0 bg-black/60" onClick={close} />
      <div
        ref={panel}
        {...dialog}
        className="ff-rv-frame relative flex h-[min(820px,calc(100dvh-48px))] w-[min(1140px,100%)] flex-col border border-ff-line2 bg-ff-panel shadow-[0_32px_80px_-24px_rgb(0_0_0/0.6)] outline-none [@media(max-height:560px)]:h-full"
      >
        {body}
      </div>
    </div>
  )
}

/** Mounted once inside the league: shows the reveal when the hook says so. */
export const RevealHost = ({ api }: { api: RevealApi }) => {
  if (!api.open) return null
  if (!api.source) return null
  return <PowerReveal source={api.source} run={api.open.run} onClose={api.close} />
}

export default PowerReveal
