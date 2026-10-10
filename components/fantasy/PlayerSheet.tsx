import React, { useMemo } from 'react'
import { ProjectionChart } from './charts'
import AdjustControl from './AdjustControl'
import { ContextNotes } from './ContextNotes'
import { useFantasy } from './FantasyContext'
import LinesBlock from './LinesBlock'
import PlayerNews from './PlayerNews'
import TeamName from './TeamName'
import { SheetBody, SheetContent, SheetHeader, SheetSection } from './Sheet'
import { Badge, PlayerAvatar, PosTag, Pts, ScoreDelta, ScoreState, Stat, ago, cx, fmt, fmtSigned, isOut, ownerLabel } from './ui'
import { useSlate } from './useSlate'
import { boxParts, useWeekNow, type PlayerWeek } from './useWeekNow'

/**
 * His game this week once it has kicked off, apart from what was expected of him: the score in solid ink with its
 * state, how far it is from his projection, the game's score from his side, and his box score.
 */
const ThisWeek = ({ week, w, pos, loaded }: { week: number; w: PlayerWeek; pos: string; loaded: boolean }) => {
  const d = w.value - w.proj
  const g = w.game
  const result = g && g.us != null && g.them != null ? (w.kind === 'final' ? (g.us > g.them ? 'W' : g.us < g.them ? 'L' : 'T') : null) : null
  const parts = boxParts(w.line, pos)
  const snaps = w.line?.off_snp && w.line?.tm_off_snp ? w.line.off_snp / w.line.tm_off_snp : null
  return (
    <section aria-label={`Week ${week}, as played`} className="border-t border-ff-line px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="ff-label">Week {week}</span>
        {g && (
          <span className="font-mono text-[11px] text-ff-muted">
            {result && <span className={cx('font-semibold', result === 'W' ? 'text-ff-pos' : result === 'L' ? 'text-ff-neg' : 'text-ff-text2')}>{result} </span>}
            {g.us != null && g.them != null && (
              <span className="num text-ff-text2">
                {g.us}–{g.them}{' '}
              </span>
            )}
            {g.home ? 'vs' : '@'} {g.opp}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end gap-3">
        <Pts value={w.value} kind={w.kind} className="text-[30px] font-medium leading-none tracking-[-0.03em]" />
        <span className="flex flex-col items-start gap-1 pb-px">
          <ScoreState kind={w.kind} clock={w.clock} />
          <span className="font-mono text-[11px] text-ff-muted">
            {w.kind === 'final' ? (
              <>
                <ScoreDelta d={d} /> against{' '}
                <span className="ff-proj num">{fmt(w.proj)}</span> projected
              </>
            ) : (
              <>
                of <span className="ff-proj num">{fmt(w.proj)}</span> projected
                {w.heading != null && (
                  <>
                    {' '}
                    · heading for <span className="num text-ff-text2">{fmt(w.heading)}</span>
                  </>
                )}
              </>
            )}
          </span>
        </span>
      </div>
      {parts.length || snaps != null ? (
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
          {parts.map((p) => (
            <React.Fragment key={p.label}>
              <dt className="ff-label self-center">{p.label}</dt>
              <dd className="num text-ff-text">{p.text}</dd>
            </React.Fragment>
          ))}
          {snaps != null && (
            <>
              <dt className="ff-label self-center">Snaps</dt>
              <dd className="num text-ff-text">
                {Math.round(snaps * 100)}% <span className="text-ff-muted">({Math.round(w.line!.off_snp)} of {Math.round(w.line!.tm_off_snp)})</span>
              </dd>
            </>
          )}
        </dl>
      ) : loaded ? (
        <p className="mt-2 text-[12px] text-ff-muted">{w.kind === 'final' ? 'No stats recorded for him in this game.' : 'No stats for him yet.'}</p>
      ) : null}
    </section>
  )
}

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
  // This week as played, once his game has kicked off.
  const { slate, proj } = useSlate(data, analysis)
  const now = useWeekNow(slate, proj)
  const thisWeek = now.of(id)
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
      // His current team's opponent each week, for the readout; a traded player's old games read against his new team's.
      labels: weeks.map((w) => {
        const opp = data.schedule?.opp[data.players[id]?.team ?? '']?.[w]
        return opp ? `vs ${opp}` : null
      }),
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
            {thisWeek && thisWeek.kind !== 'proj' && <ThisWeek week={slate.week} w={thisWeek} pos={p.pos} loaded={now.hasLines} />}
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
                <ProjectionChart weeks={chart.weeks} actual={chart.actual} projected={chart.projected} labels={chart.labels} highlight={data.playoffWeeks} height={190} />
              </SheetSection>
            )}

            <PlayerNews id={id} max={3} section />

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
