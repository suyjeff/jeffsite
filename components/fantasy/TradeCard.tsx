import React, { useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { TradeIdea } from '../../lib/fantasy/trades'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { ContextNotes } from './ContextNotes'
import { IconArrow, IconSwap, IconWrench } from './icons'
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
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <PlayerAvatar id={id} player={p} size={36} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium tracking-tight text-ff-text">{p?.name ?? id}</span>
          {p?.injury && <span className={cx('shrink-0 font-mono text-[9.5px] font-semibold uppercase', /^(IR|Out|PUP|Sus)/i.test(p.injury) ? 'text-ff-neg' : 'text-ff-warn')}>{p.injury.slice(0, 3)}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] text-ff-muted">
          <span className="font-semibold text-ff-text2">{p?.pos}</span>
          <span>{p?.team ?? 'FA'}</span>
          <span className="text-ff-line2">·</span>
          <span className="text-ff-text2">{perWeek != null ? perWeek.toFixed(1) : '–'}</span>
          <span>/wk</span>
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
    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ff-muted">{label}</div>
    <div className="mt-0.5 text-[15px] leading-tight">{children}</div>
  </div>
)

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
  const [v, setV] = useState(0)
  const idea = versions[Math.min(v, versions.length - 1)]
  const team = analysis.teamById[idea.partnerId]
  const season = analysis.seasonById[idea.partnerId]
  const power = analysis.powerById[idea.partnerId]
  const players = data.players
  const nm = (id: string) => players[id]?.name ?? id
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-ff-line bg-ff-panel">
      <header className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar src={team?.avatar ?? null} name={team?.name ?? '?'} size={22} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-medium text-ff-text">{team?.name}</div>
            <div className="font-mono text-[10px] text-ff-muted">
              {season ? `${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}` : ''}
              {power ? ` · power #${power.rank}` : ''}
              {analysis.needs[idea.partnerId]?.worstPos ? ` · needs ${analysis.needs[idea.partnerId].worstPos}` : ''}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tag && <Badge tone="accent">{tag}</Badge>}
          {versions.length > 1 && (
            <span className="flex items-center rounded border border-ff-line font-mono text-[10.5px] text-ff-muted" title="Other ways to build the same deal">
              <button className="px-1.5 py-[1px] hover:text-ff-text disabled:opacity-30" disabled={v === 0} onClick={() => setV(v - 1)} aria-label="Previous version">
                ‹
              </button>
              <span className="text-ff-text2">
                v{v + 1}/{versions.length}
              </span>
              <button className="px-1.5 py-[1px] hover:text-ff-text disabled:opacity-30" disabled={v >= versions.length - 1} onClick={() => setV(v + 1)} aria-label="Next version">
                ›
              </button>
            </span>
          )}
          <Badge title={SHAPE_LABEL[idea.shape]}>
            <span className="num">
              {idea.give.length}-for-{idea.get.length}
            </span>
          </Badge>
        </div>
      </header>

      <div className="relative grid grid-cols-1 sm:grid-cols-2">
        <div className="min-w-0 border-b border-ff-line px-3 pb-2 pt-2 sm:border-b-0 sm:border-r">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ff-muted">You send</div>
          {idea.give.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} side="give" />
          ))}
        </div>
        <div className="min-w-0 px-3 pb-2 pt-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ff-muted">You get</div>
          {idea.get.map((id) => (
            <PlayerLine key={id} id={id} data={data} analysis={analysis} side="get" />
          ))}
        </div>
        <span className="absolute left-1/2 top-[34px] hidden -translate-x-1/2 rounded-full border border-ff-line bg-ff-panel p-1 text-ff-muted sm:block">
          <IconSwap size={12} />
        </span>
      </div>

      <div className="mt-auto border-t border-ff-line bg-ff-raised/50 px-3 py-2.5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="grid grid-cols-4 gap-x-4">
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
            <Metric label="Ask" title="Open-market value in minus out. Positive means you are asking for a premium.">
              <span className="num text-ff-text">{fmtSigned(idea.valueAsk, 1)}</span>
            </Metric>
          </div>
          <WeekBars weeks={idea.perWeek.map((w) => ({ week: w.week, value: w.mine }))} highlight={data.playoffWeeks} barWidth={7} height={30} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {idea.fills && (
            <span>
              Fills their <span className="font-mono text-ff-text2">{idea.fills.slot}</span>{' '}
              <span className="num">
                {idea.fills.before.toFixed(1)}
                <IconArrow size={10} className="mx-0.5 inline align-[-1px]" />
                {idea.fills.after.toFixed(1)}
              </span>
            </span>
          )}
          {idea.myCuts.length > 0 && <span>You drop {idea.myCuts.map(nm).join(', ')}</span>}
          {idea.theirCuts.length > 0 && <span>They drop {idea.theirCuts.map(nm).join(', ')}</span>}
          {idea.myCost > 0.05 && <span>Sending costs you <span className="num text-ff-text2">{idea.myCost.toFixed(2)}</span>/wk before the return</span>}
        </div>
        {onBuild && (
          <Button size="sm" variant="ghost" onClick={() => onBuild(idea)} title="Open this deal in the builder to adjust it">
            <IconWrench size={13} /> Adjust
          </Button>
        )}
      </footer>
    </article>
  )
}

export default TradeCard
