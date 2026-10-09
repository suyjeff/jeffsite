import React, { useMemo } from 'react'
import { ProjectionChart } from './charts'
import AdjustControl from './AdjustControl'
import { ContextNotes } from './ContextNotes'
import { useFantasy } from './FantasyContext'
import LinesBlock from './LinesBlock'
import TeamName from './TeamName'
import { SheetBody, SheetContent, SheetHeader, SheetSection } from './Sheet'
import { Badge, PlayerAvatar, PosTag, Stat, ago, cx, fmt, fmtSigned, isOut, ownerLabel } from './ui'

/**
 * Everything about one player, over the page: a sheet from the right on wide
 * screens, from the bottom on phones. Opens from any player name.
 */
const PlayerSheet = ({ id }: { id: string }) => {
  const { data, analysis } = useFantasy()
  const p = data.players[id]
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
    <SheetContent>
        <>
          <SheetHeader
          lead={<PlayerAvatar id={id} player={p} size={56} />}
          eyebrow={
            <>
              <PosTag pos={p.pos} />
              <span>{p.team ?? 'FA'}</span>
              {p.injury && <Badge tone={out ? 'neg' : 'warn'}>{p.injury}</Badge>}
              {ctx?.byes.length ? <span>bye wk {ctx.byes.join(', ')}</span> : null}
            </>
          }
          title={p.name}
          sub={
            <>
              {owner != null && owner !== analysis.myRosterId ? (
                <TeamName id={owner} size={14} />
              ) : (
                <span className={owner === analysis.myRosterId ? 'text-ff-accent' : undefined}>{ownerLabel(analysis, id)}</span>
              )}
              {p.newsAt ? <span>· Sleeper news {ago(p.newsAt)} ago</span> : null}
            </>
          }
        />

          <SheetBody>
            <div className="grid grid-cols-2 gap-px border-y border-ff-line bg-ff-line">
              <Stat inset="sheet" label="Exp / wk" value={fmt(perWeek)} sub="rest of season" />
              <Stat
                inset="sheet"
                label="Value"
                value={market != null ? fmtSigned(market, 1) : '–'}
                sub={posRank ? `model ${p.pos}${posRank}` : 'over replacement'}
                tone={market != null && market > 0 ? 'pos' : undefined}
              />
              <Stat
                inset="sheet"
                label="Consensus"
                value={ecr?.posRank != null ? `${p.pos}${Math.round(ecr.posRank)}` : '–'}
                sub={ecr?.weekRank != null ? `this week ${p.pos}${Math.round(ecr.weekRank)}` : 'FantasyPros'}
              />
              <Stat
                inset="sheet"
                label="Plays"
                value={ctx?.play != null ? `${Math.round(ctx.play * 100)}%` : '–'}
                sub="of weeks ahead"
                meter={ctx?.play ?? undefined}
                tone={ctx?.play != null && ctx.play < 0.75 ? 'neg' : ctx?.play != null && ctx.play < 0.9 ? 'warn' : undefined}
              />
            </div>

            <section className="px-4 py-3">
              <AdjustControl id={id} />
              <p className="mt-1.5 text-[11px] leading-snug text-ff-muted">Saved in this browser for this league. Applies everywhere: lineups, trades, odds, waivers.</p>
            </section>

            {chart.weeks.length > 0 && (
              <SheetSection title="By week" aside="scored vs projected">
                <ProjectionChart weeks={chart.weeks} actual={chart.actual} projected={chart.projected} highlight={data.playoffWeeks} height={150} />
              </SheetSection>
            )}

            {ctx?.notes.length ? (
              <SheetSection title="Context">
                <ContextNotes context={ctx} players={data.players} max={8} />
              </SheetSection>
            ) : null}

            {usage && usage.games > 0 && (
              <SheetSection title="Usage" aside={`${usage.games} games`}>
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
                    <div
                      className={cx(
                        'num mt-0.5 text-[15px]',
                        usage.lastOpps > usage.priorOpps + 3 ? 'text-ff-pos' : usage.lastOpps < usage.priorOpps - 3 ? 'text-ff-neg' : 'text-ff-text',
                      )}
                    >
                      {usage.lastOpps}
                    </div>
                    <div className="text-[10.5px] text-ff-muted">vs {fmt(usage.priorOpps)} before</div>
                  </div>
                </div>
              </SheetSection>
            )}

            {ctx?.schedule && ctx.schedule.length > 0 && (
              <SheetSection title="Schedule ahead" aside={data.playoffWeeks.length ? 'blue = fantasy playoffs' : undefined}>
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
              </SheetSection>
            )}

            {data.market?.byId[id] && (
              <section className="border-t border-ff-line px-4 py-3">
                <LinesBlock id={id} />
              </section>
            )}
          </SheetBody>
        </>
    </SheetContent>
  )
}

export default PlayerSheet
