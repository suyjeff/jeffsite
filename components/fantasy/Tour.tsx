import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DIAGRAMS, type DiagramKey } from './TourDiagrams'
import { cx, shortcutLabel } from './ui'

export type TourStep = { key: DiagramKey; title: string; what: string; can: string[]; why: string }

/** What each page is for, in the order the sidebar lists them. */
export const TOUR: TourStep[] = [
  {
    key: 'welcome',
    title: 'Your league, modelled',
    what: 'Every page reads your Sleeper league and prices it with one model, so the numbers agree everywhere.',
    can: ['Pick a page from the sidebar', 'Press {K} to jump to any page, player or team', 'Click a player for his full sheet'],
    why: 'Every number is something you can act on: points per week, win odds, playoff odds.',
  },
  {
    key: 'dash',
    title: 'Dashboard',
    what: 'A board of widgets for the whole league.',
    can: ['Add, resize and rearrange widgets', 'Link widgets so a pick in one updates the rest'],
    why: 'Your week at a glance, arranged your way.',
  },
  {
    key: 'slate',
    title: 'Gameday',
    what: 'Your matchup and the week’s NFL games, read for your league.',
    can: ['Follow your matchup slot by slot, live', 'Find the games that swing your win odds most', 'Open any NFL game for the league starters in it'],
    why: 'Know what to watch on Sunday, and why it matters to you.',
  },
  {
    key: 'trades',
    title: 'Trades',
    what: 'Deals that make both lineups better.',
    can: ['Browse suggested trades with the odds they say yes', 'Grade deals to teach it what is realistic', 'Build and price any trade'],
    why: 'Buy the points your lineup lacks at a price the other side accepts.',
  },
  {
    key: 'me',
    title: 'My team',
    what: 'Your roster and lineup against the league.',
    can: ['Check this week’s best lineup', 'See what helps and hurts your team', 'Read the latest news on your players'],
    why: 'Find your weak slots before your opponents do.',
  },
  {
    key: 'waivers',
    title: 'Waivers',
    what: 'Free agents worth a roster spot.',
    can: ['Get adds, drops and FAAB bids', 'Stream a position for this week', 'Compare every add in points per week'],
    why: 'The cheapest upgrades come off the wire.',
  },
  {
    key: 'matchups',
    title: 'Matchups',
    what: 'Every head-to-head this week, yours on top.',
    can: ['See every score and win odds at once', 'Spot the close ones and who decides them', 'Open a matchup for the slot-by-slot detail'],
    why: 'The whole league’s week, and how it moves the standings.',
  },
  {
    key: 'power',
    title: 'Power',
    what: 'Rankings and standings.',
    can: ['Rank teams three ways', 'Check who has the easier schedule'],
    why: 'Where you really stand, not just your record.',
  },
  {
    key: 'playoffs',
    title: 'Playoffs',
    what: 'The playoff race, simulated.',
    can: ['See everyone’s playoff and title odds', 'Pick results and watch the odds move', 'Play out a season, bracket and all'],
    why: 'See which games matter before they are played.',
  },
  {
    key: 'teams',
    title: 'Teams',
    what: 'Every team at a glance, and any roster in full.',
    can: ['Compare records, form, odds and needs in one table', 'Open a team for a quick summary', 'Scout any team’s strengths and holes'],
    why: 'Know your opponents and trade partners.',
  },
  {
    key: 'players',
    title: 'Players',
    what: 'Every player, valued for your league’s scoring.',
    can: ['Sort by value, projection or trend', 'Open a player to set your own read on him'],
    why: 'Values reflect your scoring and lineup, not a generic ranking.',
  },
  {
    key: 'monke',
    title: 'M.O.N.K.E.',
    what: 'The model behind every number.',
    can: ['See how the pieces connect', 'Check its forecasts against real results'],
    why: 'Trust the numbers once you can see how they are made.',
  },
  {
    key: 'model',
    title: 'Tuning',
    what: 'The model’s settings.',
    can: ['Change how players are valued', 'Weight the power rankings'],
    why: 'Make the model match how you see the game.',
  },
  {
    key: 'finish',
    title: 'You’re set',
    what: 'Press {K} anywhere to jump to a page, player or team.',
    can: ['Replay this tour from your username menu or the command palette'],
    why: 'Everything else is a click away in the sidebar.',
  },
]

const fill = (s: string) => s.replace('{K}', shortcutLabel())

/**
 * The first-visit tour. The page behind is shaded and blurred, except the sidebar, where the section being
 * explained is lit; a centered card says what it is, what you can do there and why it helps, over a small
 * animated diagram. Esc, Skip, or the last step end it, and it never runs again unless asked for.
 */
const Tour = ({ step, setStep, onClose, phone }: { step: number; setStep: (n: number) => void; onClose: () => void; phone: boolean }) => {
  const s = TOUR[step]
  const Diagram = DIAGRAMS[s.key]
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const last = step === TOUR.length - 1
  const back = useRef<Element | null>(null)

  useEffect(() => {
    back.current = document.activeElement
    next.current?.focus({ preventScroll: true })
    const html = document.documentElement
    const overflow = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = overflow
      ;(back.current as HTMLElement | null)?.focus?.({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Another modal opened over the tour (the command palette) keeps its own keys.
      const t = e.target as Element | null
      if (t && !card.current?.contains(t) && t.closest?.('[aria-modal="true"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowRight' && !e.altKey) {
        e.preventDefault()
        last ? onClose() : setStep(step + 1)
      } else if (e.key === 'ArrowLeft' && step > 0) {
        e.preventDefault()
        setStep(step - 1)
      } else if (e.key === 'Tab' && card.current) {
        // Keyboard focus stays in the card while it is open.
        const f = [...card.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')]
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const to = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 || i < 0 ? 0 : i + 1
        e.preventDefault()
        f[to].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [step, last, onClose, setStep])

  // A hard-edged leader from the lit sidebar item to the card, redrawn per step.
  const [leader, setLeader] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (phone) return setLeader(null)
    const draw = () => {
      const item = document.querySelector(`[data-tour-key="${s.key}"]`)
      const c = card.current
      if (!item || !c) return setLeader(null)
      const a = item.getBoundingClientRect()
      const b = c.getBoundingClientRect()
      const x1 = a.right
      const y1 = a.top + a.height / 2
      const x2 = b.left
      const y2 = Math.min(b.bottom - 28, Math.max(b.top + 28, y1))
      const xm = x1 + Math.max(16, (x2 - x1) / 2)
      setLeader(`M${x1} ${y1}H${xm}V${y2}H${x2}`)
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [s.key, phone])

  return (
    // The root lets pointer events through, so the lit sidebar stays clickable (a click there jumps the tour to it).
    <div className="pointer-events-none fixed inset-0 z-[60]" role="presentation">
      {/* The shade: everything but the sidebar on wide screens, everything on phones. */}
      <div aria-hidden onClick={onClose} className="pointer-events-auto absolute inset-0 bg-ff-bg/70 backdrop-blur-[3px] md:left-[220px]" />
      {leader && (
        <svg aria-hidden className="ff-dg pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <path key={s.key} d={leader} pathLength={1} className="wire hot draw" />
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3 md:left-[220px] md:p-8">
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ff-tour-title"
          aria-describedby="ff-tour-what"
          className="ff-modal-in pointer-events-auto flex max-h-full w-full max-w-[600px] flex-col border border-ff-line2 bg-ff-panel shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)]"
        >
          <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-ff-line px-3">
            <span className="ff-label">
              Tour <span className="num ml-1 text-ff-text2">{String(step + 1).padStart(2, '0')}</span>
              <span className="num text-ff-muted">/{String(TOUR.length).padStart(2, '0')}</span>
            </span>
            <button type="button" onClick={onClose} className="-mr-1.5 h-7 px-2 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text">
              Skip tour
            </button>
          </header>
          <div className="shrink-0 border-b border-ff-line bg-ff-sunken/60 px-2 py-1.5 sm:px-4 sm:py-2">
            <Diagram key={step} />
          </div>
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <div>
              <h2 id="ff-tour-title" className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-ff-text">
                {s.title}
              </h2>
              <p id="ff-tour-what" className="mt-1 text-[13.5px] leading-[1.5] text-ff-text2">
                {fill(s.what)}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-5">
              <div>
                <div className="ff-label mb-1.5">What you can do</div>
                <ul className="space-y-1 text-[13px] leading-[1.45] text-ff-text">
                  {s.can.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 bg-ff-accent" />
                      {fill(c)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="ff-label mb-1.5">Why it helps</div>
                <p className="text-[13px] leading-[1.45] text-ff-text2">{s.why}</p>
              </div>
            </div>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ff-line px-3 py-2.5 sm:px-4">
            <span className="flex gap-1" aria-hidden>
              {TOUR.map((_, i) => (
                <span key={i} className={cx('h-1.5 w-3', i === step ? 'bg-ff-accent' : i < step ? 'bg-ff-text2/50' : 'bg-ff-line2')} />
              ))}
            </span>
            <span className="flex gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="h-8 border border-ff-line px-3 text-[12.5px] text-ff-text2 hover:bg-ff-raised hover:text-ff-text"
                >
                  Back
                </button>
              )}
              <button
                ref={next}
                type="button"
                onClick={() => (last ? onClose() : setStep(step + 1))}
                className="h-8 bg-ff-text px-4 text-[12.5px] font-medium text-ff-panel hover:bg-ff-text/85"
              >
                {last ? 'Done' : step === 0 ? 'Show me around' : 'Next'}
              </button>
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}

export default Tour
