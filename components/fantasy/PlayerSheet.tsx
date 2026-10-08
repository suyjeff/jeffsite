import React, { useEffect, useMemo, useRef } from 'react'
import { ProjectionChart } from './charts'
import AdjustControl from './AdjustControl'
import { ContextNotes } from './ContextNotes'
import { useFantasy } from './FantasyContext'
import LinesBlock from './LinesBlock'
import { Badge, PlayerAvatar, PosTag, Stat, ago, cx, fmt, fmtSigned, isOut, ownerLabel } from './ui'

const Section = ({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) => (
  <section className="border-t border-ff-line px-4 py-3">
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="ff-label">{title}</h3>
      {aside && <span className="font-mono text-[10.5px] text-ff-muted">{aside}</span>}
    </div>
    {children}
  </section>
)

/**
 * Everything about one player, over the page: a sheet from the right on wide
 * screens, from the bottom on phones. Opens from any player name.
 */
const PlayerSheet = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { data, analysis } = useFantasy()
  const panel = useRef<HTMLDivElement>(null)
  const p = data.players[id]

  // Escape closes; Tab stays inside; the page behind does not scroll; focus moves in and comes back.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        // In a field, Escape leaves the field; a second press closes.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
          t.blur()
          panel.current?.focus()
        } else onClose()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (!focusable.length) return e.preventDefault()
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      } else if (!panel.current.contains(at)) {
        e.preventDefault()
        first.focus()
      }
    }
    // Captured first, so Escape here never also closes a menu or drawer behind.
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      back?.focus?.()
    }
  }, [onClose])

  const ctx = data.context[id]
  const owner = analysis.rosteredBy[id]
  const ecr = data.consensus?.byId[id]
  const usage = data.usage[id]
  const perWeek = analysis.horizon.perWeek[id]
  const market = analysis.market[id]
  const posRank = useMemo(() => {
    if (!p || market == null) return null
    const same = Object.keys(analysis.market)
      .filter((x) => data.players[x]?.pos === p.pos)
      .sort((a, b) => analysis.market[b] - analysis.market[a])
    return same.indexOf(id) + 1 || null
  }, [p, id, market, analysis.market, data.players])

  // Scored against projected, week by week, with the weeks ahead dashed.
  const chart = useMemo(() => {
    const own = !data.pointsSource.startsWith('proxy')
    const past = own ? data.valueWeeks : []
    const ahead = data.horizonSource === 'projections' ? data.horizon.map((h) => h.week).filter((w) => !past.includes(w)) : []
    const weeks = [...past, ...ahead]
    return {
      weeks,
      actual: weeks.map((w) => (past.includes(w) ? (data.weekPoints[w]?.[id] ?? null) : null)),
      projected: weeks.map((w) => (past.includes(w) ? (data.pastProjections[w]?.[id] ?? null) : (data.horizon.find((h) => h.week === w)?.pts[id] ?? null))),
    }
  }, [data, id])

  if (!p) return null
  const out = isOut(p.injury)

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="ff-fade-in absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${p.name} details`}
        tabIndex={-1}
        className={cx(
          'absolute flex flex-col border-ff-line bg-ff-panel shadow-[0_-8px_40px_rgba(0,0,0,0.35)] outline-none',
          // Phones: a bottom sheet. Wide screens: a sheet from the right.
          'ff-sheet inset-x-0 bottom-0 max-h-[88vh] border-t pb-[env(safe-area-inset-bottom)]',
          'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[460px] md:border-l md:border-t-0 md:pb-0 md:shadow-[-12px_0_40px_rgba(0,0,0,0.3)]',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 bg-ff-line2 md:hidden" aria-hidden />
        <header className="flex items-start gap-3 px-4 pb-3 pt-3 md:pt-4">
          <PlayerAvatar id={id} player={p} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <PosTag pos={p.pos} />
              <span className="font-mono text-[11px] text-ff-muted">{p.team ?? 'FA'}</span>
              {p.injury && <Badge tone={out ? 'neg' : 'warn'}>{p.injury}</Badge>}
              {ctx?.byes.length ? <span className="font-mono text-[10.5px] text-ff-muted">bye wk {ctx.byes.join(', ')}</span> : null}
            </div>
            <h2 className="mt-1 truncate text-[19px] font-medium leading-tight tracking-[-0.01em] text-ff-text">{p.name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ff-muted">
              <span className={owner === analysis.myRosterId ? 'text-ff-accent' : undefined}>{ownerLabel(analysis, id)}</span>
              {p.newsAt ? <span>· Sleeper news {ago(p.newsAt)} ago</span> : null}
            </div>
          </div>
          <button onClick={onClose} className="-mr-1 -mt-1 h-8 px-2 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text" aria-label="Close">
            <span className="md:hidden">Close</span>
            <span className="hidden md:inline">ESC</span>
          </button>
        </header>

        <div className="ff-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-2 gap-px border-y border-ff-line bg-ff-line sm:grid-cols-4 [&>*]:border-0">
            <Stat label="Exp / wk" value={fmt(perWeek)} sub="rest of season" />
            <Stat label="Value" value={market != null ? fmtSigned(market, 1) : '–'} sub={posRank ? `model ${p.pos}${posRank}` : 'over replacement'} tone={market != null && market > 0 ? 'pos' : undefined} />
            <Stat label="Consensus" value={ecr?.posRank != null ? `${p.pos}${Math.round(ecr.posRank)}` : '–'} sub={ecr?.weekRank != null ? `this week ${p.pos}${Math.round(ecr.weekRank)}` : 'FantasyPros'} />
            <Stat label="Plays" value={ctx?.play != null ? `${Math.round(ctx.play * 100)}%` : '–'} sub="of weeks ahead" meter={ctx?.play ?? undefined} tone={ctx?.play != null && ctx.play < 0.75 ? 'neg' : ctx?.play != null && ctx.play < 0.9 ? 'warn' : undefined} />
          </div>

          <section className="px-4 py-3">
            <AdjustControl id={id} />
            <p className="mt-1.5 text-[11px] leading-snug text-ff-muted">Saved in this browser for this league, and used everywhere: lineups, trades, playoff odds, waivers.</p>
          </section>

          {chart.weeks.length > 0 && (
            <Section title="By week" aside="scored vs projected">
              <ProjectionChart weeks={chart.weeks} actual={chart.actual} projected={chart.projected} highlight={data.playoffWeeks} height={150} />
            </Section>
          )}

          {ctx?.notes.length ? (
            <Section title="Context">
              <ContextNotes context={ctx} players={data.players} max={8} />
            </Section>
          ) : null}

          {usage && usage.games > 0 && (
            <Section title="Usage" aside={`${usage.games} games`}>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="ff-label">Snaps</div>
                  <div className="num mt-0.5 text-[15px] text-ff-text">{Math.round(usage.snaps * 100)}%</div>
                  <div className="text-[10.5px] text-ff-muted">last {Math.round(usage.lastSnaps * 100)}%</div>
                </div>
                <div>
                  <div className="ff-label">Touches + tgts</div>
                  <div className="num mt-0.5 text-[15px] text-ff-text">{fmt(usage.opps)}</div>
                  <div className="text-[10.5px] text-ff-muted">a game</div>
                </div>
                <div>
                  <div className="ff-label">Last game</div>
                  <div className={cx('num mt-0.5 text-[15px]', usage.lastOpps > usage.priorOpps + 3 ? 'text-ff-pos' : usage.lastOpps < usage.priorOpps - 3 ? 'text-ff-neg' : 'text-ff-text')}>{usage.lastOpps}</div>
                  <div className="text-[10.5px] text-ff-muted">vs {fmt(usage.priorOpps)} before</div>
                </div>
              </div>
            </Section>
          )}

          {ctx?.schedule && ctx.schedule.length > 0 && (
            <Section title="Schedule ahead" aside={data.playoffWeeks.length ? 'blue = fantasy playoffs' : undefined}>
              <div className="grid grid-cols-7 gap-px border border-ff-line bg-ff-line">
                {ctx.schedule.slice(0, 14).map((s) => (
                  <span
                    key={s.week}
                    className={cx('bg-ff-panel py-1 text-center font-mono text-[10px] leading-tight', s.playoff ? 'text-ff-accent' : s.opp ? 'text-ff-text2' : 'text-ff-muted')}
                    title={`Week ${s.week}${s.playoff ? ' · fantasy playoffs' : ''}`}
                  >
                    <span className="block text-[8.5px] text-ff-muted">{s.week}</span>
                    {s.opp ?? 'BYE'}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {data.market?.byId[id] && (
            <section className="border-t border-ff-line px-4 py-3">
              <LinesBlock id={id} />
            </section>
          )}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )
}

export default PlayerSheet
