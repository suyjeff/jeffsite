import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { acceptRead, type AcceptRead } from '../../lib/fantasy/behavior'
import { tradeLeverage } from '../../lib/fantasy/forecast'
import { applyTrade, type TradeIdea } from '../../lib/fantasy/trades'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { ContextNotes } from './ContextNotes'
import { useFantasy } from './FantasyContext'
import { Avatar, Badge, Button, Chip, Figure, PlayerAvatar, WeekBars, cx, fmtSigned, simOdds } from './ui'

export const SHAPE_LABEL: Record<TradeIdea['shape'], string> = {
  'one-for-one': 'Straight swap',
  consolidate: 'Consolidation',
  depth: 'Depth',
  swap: 'Package swap',
}

const PlayerLine = ({ id, data, analysis, notes }: { id: string; data: LeagueData; analysis: Analysis; notes?: boolean }) => {
  const p = data.players[id]
  const ctx = data.context[id]
  const perWeek = analysis.horizon.perWeek[id]
  const play = ctx?.play
  const ecr = data.consensus?.byId[id]
  const out = !!p?.injury && /^(IR|Out|PUP|Sus)/i.test(p.injury)
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <PlayerAvatar id={id} player={p} size={34} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-ff-text">{p?.name ?? id}</span>
          {p?.injury && <span className={cx('shrink-0 font-mono text-[9.5px] font-semibold uppercase', out ? 'text-ff-neg' : 'text-ff-warn')}>{p.injury.slice(0, 3)}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] text-ff-muted">
          <span className="font-semibold text-ff-text2">{p?.pos}</span>
          <span>{p?.team ?? 'FA'}</span>
          {ecr?.posRank != null && (
            <span title="FantasyPros consensus rank, rest of season">
              · ecr {p?.pos}
              {Math.round(ecr.posRank)}
            </span>
          )}
          {play != null && play < 0.85 && (
            <span className={cx('px-1', play < 0.75 ? 'bg-ff-neg/10 text-ff-neg' : 'bg-ff-warn/10 text-ff-warn')} title="Chance he plays in a given week, from his status and history">
              plays {Math.round(play * 100)}%
            </span>
          )}
        </div>
        {/* What you take on matters more than what you send: a role about to shrink, a hard playoff run. */}
        {notes && ctx?.notes.length ? (
          <div className="mt-1">
            <ContextNotes context={ctx} players={data.players} max={2} />
          </div>
        ) : null}
      </div>
      <Figure value={perWeek != null ? perWeek.toFixed(1) : '–'} unit="/wk" className="shrink-0" title="Expected points per week over the horizon" />
    </div>
  )
}

/** Playoff and title odds before and after, run on the same simulated seasons. Deferred so cards paint first. */
const useLeverage = (idea: TradeIdea) => {
  const { models, analysis } = useFantasy()
  const [lev, setLev] = useState<ReturnType<typeof tradeLeverage> | null | undefined>(undefined)
  useEffect(() => {
    setLev(undefined)
    if (!models.forecast || analysis.myRosterId == null) {
      setLev(null)
      return
    }
    const t = setTimeout(() => {
      const me = analysis.teamById[analysis.myRosterId!]
      const them = analysis.teamById[idea.partnerId]
      const pts = analysis.horizon.perWeek
      setLev(
        tradeLeverage(models.forecastInput, models.forecast!, {
          me: me.rosterId,
          partner: them.rosterId,
          myRoster: applyTrade(me.players, idea.give, idea.get, analysis.capacity, pts),
          theirRoster: applyTrade(them.players, idea.get, idea.give, analysis.capacity, pts),
        }),
      )
    }, 30)
    return () => clearTimeout(t)
  }, [idea, models, analysis])
  return lev
}

/** A change in probability as signed points: +0.9. */
const pt = (v: number | undefined) => (v === undefined ? '···' : fmtSigned(v * 100, 1))

type Signal = AcceptRead['signals'][number]

const TradeCard = ({
  versions,
  data,
  analysis,
  tag,
  onBuild,
}: {
  /** Ways to land the same players from the same team, best first. */
  versions: TradeIdea[]
  data: LeagueData
  analysis: Analysis
  /** A short distinction, e.g. "Best for you". */
  tag?: string
  onBuild?: (idea: TradeIdea) => void
}) => {
  const { models } = useFantasy()
  const [v, setV] = useState(0)
  const [open, setOpen] = useState(false)
  const idea = versions[Math.min(v, versions.length - 1)]
  const team = analysis.teamById[idea.partnerId]
  const season = analysis.seasonById[idea.partnerId]
  const players = data.players
  const nm = (id: string) => players[id]?.name ?? id
  const read = useMemo(() => acceptRead(idea, analysis.myRosterId ?? -1, models.behavior, models.perceived, analysis.currency), [idea, analysis, models])
  const lev = useLeverage(idea)
  const odds = models.forecast?.sim[idea.partnerId]
  const need = analysis.needs[idea.partnerId]?.worstPos

  // Why they would (or would not) say yes, strongest first: what the deal does for them, then who they are.
  const signals: Signal[] = []
  if (idea.fills) signals.push({ text: `fills their ${idea.fills.slot} ${idea.fills.before.toFixed(1)} → ${idea.fills.after.toFixed(1)}`, tone: 'pos' })
  if (idea.theirGain >= 0.25) signals.push({ text: `they gain ${idea.theirGain.toFixed(1)}/wk`, tone: 'pos' })
  else if (idea.theirGain <= -0.25) signals.push({ text: `they lose ${Math.abs(idea.theirGain).toFixed(1)}/wk`, tone: 'neg' })
  if (lev && Math.abs(lev.partner.playoffs) >= 0.005) signals.push({ text: `their playoff odds ${pt(lev.partner.playoffs)}pt`, tone: lev.partner.playoffs > 0 ? 'pos' : 'neg' })
  signals.push(...read.signals)
  const shown = open ? signals : signals.slice(0, 3)
  const bandTone = read.band === 'likely' ? 'pos' : read.band === 'possible' ? 'warn' : 'neg'

  return (
    <article className="flex min-w-0 flex-col border border-ff-line bg-ff-panel">
      <header className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar src={team?.avatar ?? null} name={team?.name ?? '?'} size={24} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-medium text-ff-text">{team?.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10.5px] text-ff-muted">
              {season && (
                <span className="text-ff-text2">
                  {season.wins}-{season.losses}
                  {season.ties ? `-${season.ties}` : ''}
                </span>
              )}
              {odds && <span>· PO {simOdds(odds, 'playoffs')}</span>}
              {need && <span>· needs {need}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tag && <Badge tone="accent">{tag}</Badge>}
          <Badge title={SHAPE_LABEL[idea.shape]}>
            {idea.give.length}-for-{idea.get.length}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="min-w-0 border-b border-ff-line px-3 pb-1.5 pt-2 sm:border-b-0 sm:border-r">
          <div className="ff-label">You send</div>
          {idea.give.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} />
          ))}
        </div>
        <div className="min-w-0 px-3 pb-1.5 pt-2">
          <div className="ff-label">You get</div>
          {idea.get.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} notes />
          ))}
        </div>
      </div>

      {/* The verdict: what it does for your lineup, for your season, and whether it will happen. */}
      <div className="grid grid-cols-3 gap-px border-y border-ff-line bg-ff-line">
        <div className="min-w-0 bg-ff-sunken px-3 py-2.5">
          <Figure
            label="For you"
            size="hero"
            value={fmtSigned(idea.myGain, 1)}
            unit="/wk"
            tone={idea.myGain > 0 ? 'pos' : 'neg'}
            sub={<span className={idea.weeksBetter <= 1 && idea.weeks > 2 ? 'text-ff-warn' : undefined}>better {idea.weeksBetter} of {idea.weeks} wks</span>}
            title="Points per week added to your best lineup, averaged over the horizon"
          />
        </div>
        <div className="min-w-0 bg-ff-sunken px-3 py-2.5">
          <Figure
            label="Playoffs"
            size="lg"
            value={lev === null ? '–' : pt(lev?.me.playoffs)}
            unit={lev ? 'pt' : undefined}
            tone={lev && lev.me.playoffs > 0.002 ? 'pos' : lev && lev.me.playoffs < -0.002 ? 'neg' : undefined}
            sub={lev ? (Math.abs(lev.me.title) >= 0.0005 ? `title ${pt(lev.me.title)}pt` : 'title odds unchanged') : lev === null ? 'no projections' : 'simulating'}
            title="Change in your playoff odds: the same simulated seasons, before and after"
          />
        </div>
        <div className="min-w-0 bg-ff-sunken px-3 py-2.5" title={`Yes-odds ${read.index}/100: their gain, how the deal looks by consensus, and how they trade`}>
          <div className="ff-label">Will they</div>
          <div className={cx('mt-1 text-[16px] font-medium leading-none', bandTone === 'pos' ? 'text-ff-pos' : bandTone === 'warn' ? 'text-ff-warn' : 'text-ff-neg')}>{read.band}</div>
          <span className="mt-2 block h-1 w-full max-w-[72px] bg-ff-line">
            <span className={cx('block h-full', bandTone === 'pos' ? 'bg-ff-pos' : bandTone === 'warn' ? 'bg-ff-warn' : 'bg-ff-neg/70')} style={{ width: `${read.index}%` }} />
          </span>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {shown.map((r, i) => (
            <Chip key={i} tone={r.tone} className={cx(!open && i >= 2 && 'max-sm:hidden')}>
              {r.tone === 'pos' ? '+ ' : r.tone === 'neg' ? '− ' : ''}
              {r.text}
            </Chip>
          ))}
          {!open && signals.length > Math.min(2, shown.length) && (
            <button onClick={() => setOpen(true)} className="px-1 font-mono text-[10.5px] text-ff-muted hover:text-ff-text sm:hidden">
              +{signals.length - Math.min(2, shown.length)} more
            </button>
          )}
          {!open && signals.length > shown.length && (
            <button onClick={() => setOpen(true)} className="hidden px-1 font-mono text-[10.5px] text-ff-muted hover:text-ff-text sm:inline">
              +{signals.length - shown.length} more
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-2.5 border-t border-ff-line bg-ff-sunken/40 px-3 py-2.5 text-[11.5px] text-ff-muted">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="They gain" value={fmtSigned(idea.theirGain, 2)} unit="/wk" title="Points per week added to their best lineup" />
            <Figure
              label="Your ask"
              value={fmtSigned(idea.valueAsk, 1)}
              unit="/wk"
              title="Trade value you take minus what you send, priced as managers price players: streamers cheap, players they drafted dear. Positive means you ask for a premium."
            />
            {read.perceivedAsk != null && (
              <Figure label="By consensus" value={fmtSigned(-read.perceivedAsk, 1)} unit="/wk" title="What they come out with in FantasyPros consensus value, priced the same way. Negative reads as them overpaying." />
            )}
            {lev && <Figure label="Their playoffs" value={pt(lev.partner.playoffs)} unit="pt" title="Change in their playoff odds" />}
          </div>
          <div>
            <div className="ff-label mb-1">your gain by week</div>
            <WeekBars weeks={idea.perWeek.map((w) => ({ week: w.week, value: w.mine }))} highlight={data.playoffWeeks} barWidth={7} height={28} />
          </div>
          {(idea.myCost > 0.05 || idea.myCuts.length > 0 || idea.theirCuts.length > 0) && (
            <ul className="space-y-0.5 leading-snug">
              {idea.myCost > 0.05 && (
                <li>
                  Sending costs your lineup <span className="num text-ff-text2">{idea.myCost.toFixed(2)}</span>/wk before the return.
                </li>
              )}
              {idea.myCuts.length > 0 && <li>You drop {idea.myCuts.map(nm).join(', ')} to make room.</li>}
              {idea.theirCuts.length > 0 && <li>They drop {idea.theirCuts.map(nm).join(', ')}.</li>}
            </ul>
          )}
        </div>
      )}

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-ff-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="py-1 font-mono text-[11px] text-ff-muted hover:text-ff-text">
            {open ? 'less ▴' : 'details ▾'}
          </button>
          {versions.length > 1 && (
            <span className="flex items-center border border-ff-line font-mono text-[10.5px] text-ff-muted" title="Other ways to build the same deal">
              <button className="px-1.5 py-0.5 hover:text-ff-text disabled:opacity-30" disabled={v === 0} onClick={() => setV(v - 1)} aria-label="Previous version">
                ‹
              </button>
              <span className="text-ff-text2">
                {v + 1}/{versions.length}
              </span>
              <button className="px-1.5 py-0.5 hover:text-ff-text disabled:opacity-30" disabled={v >= versions.length - 1} onClick={() => setV(v + 1)} aria-label="Next version">
                ›
              </button>
            </span>
          )}
        </div>
        {onBuild && (
          <Button size="sm" variant="accent" onClick={() => onBuild(idea)} title="Open this deal in the builder to change it">
            Build this trade →
          </Button>
        )}
      </footer>
    </article>
  )
}

export default TradeCard
