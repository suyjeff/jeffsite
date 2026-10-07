import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { acceptRead } from '../../lib/fantasy/behavior'
import { tradeLeverage } from '../../lib/fantasy/forecast'
import { applyTrade, type TradeIdea } from '../../lib/fantasy/trades'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { ContextNotes } from './ContextNotes'
import { useFantasy } from './FantasyContext'
import { Avatar, Badge, Button, Num, PlayerAvatar, WeekBars, cx, fmtSigned } from './ui'

export const SHAPE_LABEL: Record<TradeIdea['shape'], string> = {
  'one-for-one': 'Straight swap',
  consolidate: 'Consolidation',
  depth: 'Depth',
  swap: 'Package swap',
}

const PlayerLine = ({ id, data, analysis, side }: { id: string; data: LeagueData; analysis: Analysis; side: 'give' | 'get' }) => {
  const p = data.players[id]
  const ctx = data.context[id]
  const perWeek = analysis.horizon.perWeek[id]
  const play = ctx?.play
  const ecr = data.consensus?.byId[id]
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <PlayerAvatar id={id} player={p} size={36} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-ff-text">{p?.name ?? id}</span>
          {p?.injury && <span className={cx('shrink-0 font-mono text-[9.5px] font-semibold uppercase', /^(IR|Out|PUP|Sus)/i.test(p.injury) ? 'text-ff-neg' : 'text-ff-warn')}>{p.injury.slice(0, 3)}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] text-ff-muted">
          <span className="font-semibold text-ff-text2">{p?.pos}</span>
          <span>{p?.team ?? 'FA'}</span>
          <span className="text-ff-line2">·</span>
          <span className="text-ff-text2">{perWeek != null ? perWeek.toFixed(1) : '–'}</span>
          <span>/wk</span>
          {ecr?.posRank != null && (
            <>
              <span className="text-ff-line2">·</span>
              <span title="FantasyPros consensus, rest of season">
                ecr {p?.pos}
                {Math.round(ecr.posRank)}
              </span>
            </>
          )}
          {play != null && play < 0.85 && (
            <>
              <span className="text-ff-line2">·</span>
              <span className={play < 0.75 ? 'text-ff-neg' : 'text-ff-warn'}>{Math.round(play * 100)}% plays</span>
            </>
          )}
        </div>
        {side === 'get' && ctx?.notes.length ? (
          <div className="mt-1">
            <ContextNotes context={ctx} players={data.players} max={2} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

const Metric = ({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) => (
  <div className="min-w-0" title={title}>
    <div className="ff-label">{label}</div>
    <div className="mt-0.5 text-[15px] leading-tight">{children}</div>
  </div>
)

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

const Delta = ({ v }: { v: number | undefined }) =>
  v === undefined ? <span className="num text-ff-muted">···</span> : <Num value={v * 100} signed digits={1} suffix="pt" />

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
  const idea = versions[Math.min(v, versions.length - 1)]
  const team = analysis.teamById[idea.partnerId]
  const season = analysis.seasonById[idea.partnerId]
  const players = data.players
  const nm = (id: string) => players[id]?.name ?? id
  const read = useMemo(() => acceptRead(idea, analysis.myRosterId ?? -1, models.behavior, models.perceived), [idea, analysis.myRosterId, models])
  const lev = useLeverage(idea)
  const odds = models.forecast?.sim[idea.partnerId]
  return (
    <article className="flex min-w-0 flex-col border border-ff-line bg-ff-panel">
      <header className="flex h-10 items-center justify-between gap-2 border-b border-ff-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar src={team?.avatar ?? null} name={team?.name ?? '?'} size={22} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-medium text-ff-text">{team?.name}</div>
            <div className="truncate font-mono text-[10px] text-ff-muted">
              {season ? `${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}` : ''}
              {odds ? ` · ${Math.round(odds.playoffs * 100)}% po` : ''}
              {analysis.needs[idea.partnerId]?.worstPos ? ` · needs ${analysis.needs[idea.partnerId].worstPos}` : ''}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tag && <Badge tone="accent">{tag}</Badge>}
          {versions.length > 1 && (
            <span className="flex items-center border border-ff-line font-mono text-[10.5px] text-ff-muted" title="Other ways to build the same deal">
              <button className="px-1.5 hover:text-ff-text disabled:opacity-30" disabled={v === 0} onClick={() => setV(v - 1)} aria-label="Previous version">
                ‹
              </button>
              <span className="text-ff-text2">
                v{v + 1}/{versions.length}
              </span>
              <button className="px-1.5 hover:text-ff-text disabled:opacity-30" disabled={v >= versions.length - 1} onClick={() => setV(v + 1)} aria-label="Next version">
                ›
              </button>
            </span>
          )}
          <Badge title={SHAPE_LABEL[idea.shape]}>
            {idea.give.length}-for-{idea.get.length}
          </Badge>
        </div>
      </header>

      <div className="relative grid grid-cols-1 sm:grid-cols-2">
        <div className="min-w-0 border-b border-ff-line px-3 pb-2 pt-2 sm:border-b-0 sm:border-r">
          <div className="ff-label">You send</div>
          {idea.give.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} side="give" />
          ))}
        </div>
        <div className="min-w-0 px-3 pb-2 pt-2">
          <div className="ff-label">You get</div>
          {idea.get.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} side="get" />
          ))}
        </div>
        <span aria-hidden className="absolute left-1/2 top-[9px] hidden -translate-x-1/2 border border-ff-line bg-ff-panel px-1 font-mono text-[10px] leading-4 text-ff-muted sm:block">
          ⇄
        </span>
      </div>

      <div className="mt-auto border-t border-ff-line bg-ff-raised/40 px-3 py-2.5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
            <Metric label="You" title="Points per week added to your optimal lineup">
              <Num value={idea.myGain} digits={2} signed />
            </Metric>
            <Metric label="Them" title="Points per week added to theirs">
              <Num value={idea.theirGain} digits={2} signed />
            </Metric>
            <Metric label="Weeks" title="Weeks of the horizon your lineup is better off">
              <span className={cx('num', idea.weeksBetter <= 1 && idea.weeks > 2 ? 'text-ff-warn' : 'text-ff-text')}>
                {idea.weeksBetter}
                <span className="text-ff-muted">/{idea.weeks}</span>
              </span>
            </Metric>
            <Metric label="Ask" title="Open-market value in minus out, by this model. Positive means you are asking for a premium.">
              <span className="num text-ff-text">{fmtSigned(idea.valueAsk, 1)}</span>
            </Metric>
            <Metric label="Δ PO" title="Change in your playoff odds, same simulated seasons before and after">
              {lev === null ? <span className="num text-ff-muted">–</span> : <Delta v={lev?.me.playoffs} />}
            </Metric>
            <Metric label="Δ Title" title="Change in your title odds">
              {lev === null ? <span className="num text-ff-muted">–</span> : <Delta v={lev?.me.title} />}
            </Metric>
          </div>
          <WeekBars weeks={idea.perWeek.map((w) => ({ week: w.week, value: w.mine }))} highlight={data.playoffWeeks} barWidth={7} height={30} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ff-line px-3 py-1.5 font-mono text-[10.5px]" title={read.reasons.join('; ')}>
        <span className="text-ff-muted">yes-odds</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[5px] w-14 bg-ff-sunken">
            <span className={cx('block h-full', read.band === 'likely' ? 'bg-ff-pos' : read.band === 'possible' ? 'bg-ff-text2' : 'bg-ff-muted')} style={{ width: `${read.index}%` }} />
          </span>
          <span className={read.band === 'likely' ? 'text-ff-pos' : 'text-ff-text2'}>
            {read.index} · {read.band}
          </span>
        </span>
        {read.perceivedAsk != null && (
          <span className="text-ff-muted">
            by consensus they {read.perceivedAsk > 0 ? 'give' : 'gain'} <span className="text-ff-text2">{Math.abs(read.perceivedAsk).toFixed(1)}</span>/wk
          </span>
        )}
        {lev && (
          <span className="text-ff-muted">
            their po <Delta v={lev.partner.playoffs} />
          </span>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ff-line px-3 py-1.5 text-[11.5px] text-ff-muted">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {idea.fills && (
            <span>
              Fills their <span className="font-mono text-ff-text2">{idea.fills.slot}</span>{' '}
              <span className="num">
                {idea.fills.before.toFixed(1)} → {idea.fills.after.toFixed(1)}
              </span>
            </span>
          )}
          {idea.myCuts.length > 0 && <span>You drop {idea.myCuts.map(nm).join(', ')}</span>}
          {idea.theirCuts.length > 0 && <span>They drop {idea.theirCuts.map(nm).join(', ')}</span>}
          {idea.myCost > 0.05 && (
            <span>
              Sending costs <span className="num text-ff-text2">{idea.myCost.toFixed(2)}</span>/wk before the return
            </span>
          )}
        </div>
        {onBuild && (
          <Button size="sm" variant="ghost" onClick={() => onBuild(idea)} title="Open this deal in the builder to adjust it">
            Adjust ›
          </Button>
        )}
      </footer>
    </article>
  )
}

export default TradeCard
