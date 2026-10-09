import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { waiverTargets } from '../../../lib/fantasy/search'
import { getWeekStatLines } from '../../../lib/fantasy/sleeper'
import type { TradeTarget } from '../../../lib/fantasy/trades'
import type { WeekStats } from '../../../lib/fantasy/types'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import {
  impliedTotals,
  pointsAllowed,
  positionSpread,
  STREAM_POSITIONS,
  streamReasons,
  streamRows,
  type Allowed,
  type StreamPos,
  type StreamRow,
  type TeamTotal,
} from '../../../lib/fantasy/waivers'
import { suggestBid, type BidAdvice } from '../../../lib/fantasy/faab'
import { ContextNotes, contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import WaiverMoves from './WaiverMoves'
import PlayerName from '../PlayerName'
import { sectionCode } from '../Shell'
import { DeltaChip, Badge, CenterMeter, Empty, N, Num, PageHeader, Panel, Reasons, Segmented, Stat, StatGrid, Table, Tabs, compact, cx, fmt, pct, type Column, type Reason } from '../ui'

type Sub = 'moves' | 'stream' | 'adds'
const SUBS: Sub[] = ['moves', 'stream', 'adds']
const AHEAD = 3
const POS_LABEL: Record<StreamPos, string> = { QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end', K: 'kicker', DEF: 'defense' }

/** Stat lines (pts_allow, sacks, FGA, rush yards) for the weeks on screen. Cached a few hours, a few dozen KB a week. */
const useStatLines = (season: string, weeks: number[]) => {
  const [lines, setLines] = useState<Record<number, WeekStats | null>>({})
  const key = weeks.join(',')
  useEffect(() => {
    let live = true
    for (const w of weeks) {
      if (w in lines) continue
      getWeekStatLines(season, w)
        .then((s) => live && setLines((x) => ({ ...x, [w]: s })))
        .catch(() => live && setLines((x) => ({ ...x, [w]: null })))
    }
    return () => {
      live = false
    }
  }, [season, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return lines
}

/** A matchup as a short tier word with its tone: easy, neutral, tough. */
const tier = (m: Allowed | null | undefined) => (!m ? null : m.index >= 1.12 ? 'easy' : m.index <= 0.88 ? 'tough' : 'avg')

const MatchupCell = ({ m }: { m: Allowed | null }) =>
  m ? (
    <span className="inline-flex items-center justify-end gap-2" title={`${fmt(m.ppg)} pts/g allowed over ${m.games} games; #${m.rank} after regressing toward average`}>
      <CenterMeter value={(m.index - 1) / 0.4} width={36} />
      <span className={cx('w-9', m.index >= 1.12 ? 'text-ff-pos' : m.index <= 0.88 ? 'text-ff-neg' : 'text-ff-text2')}>
        {m.index >= 1 ? '+' : '−'}
        {Math.round(Math.abs(m.index - 1) * 100)}%
      </span>
    </span>
  ) : (
    <span className="text-ff-muted">–</span>
  )

const TotalCell = ({ t, low }: { t: TeamTotal | null; low?: boolean }) =>
  t ? (
    <span
      title={t.source === 'market' ? 'From the kicker’s extra-point and field-goal props' : 'Sleeper’s projected points allowed by the opposing defense, built on the Vegas line'}
    >
      <span className={cx(low ? (t.pts <= 19 ? 'text-ff-pos' : t.pts >= 26 ? 'text-ff-neg' : '') : t.pts >= 26 ? 'text-ff-pos' : t.pts <= 19 ? 'text-ff-neg' : '')}>
        {fmt(t.pts)}
      </span>
      {t.source === 'market' && <span className="ml-0.5 text-[9px] text-ff-accent">m</span>}
    </span>
  ) : (
    <span className="text-ff-muted">–</span>
  )

const WaiversView = ({ data, analysis, sub, onSub }: { data: LeagueData; analysis: Analysis; sub: string | null; onSub: (s: string) => void }) => {
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'moves'
  const { models } = useFantasy()
  const { players } = data
  const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  const startable = useMemo(() => new Set(analysis.slots.flatMap((s) => s.eligible)), [analysis.slots])
  const positions = STREAM_POSITIONS.filter((p) => startable.has(p))
  const [pos, setPos] = useState<StreamPos>(positions[positions.length - 1] ?? 'DEF')
  const weeks = useMemo(
    () =>
      data.horizon
        .map((h) => h.week)
        .filter((w) => !data.playoffWeeks.length || w <= Math.max(...data.playoffWeeks))
        .slice(0, AHEAD),
    [data.horizon, data.playoffWeeks],
  )
  const [picked, setWeek] = useState<number | null>(null)
  // The weeks roll over on a refresh; a pick that has passed falls back to the coming week.
  const week = picked != null && weeks.includes(picked) ? picked : (weeks[0] ?? 0)
  const lines = useStatLines(data.league.season, weeks)

  // Season-to-date matchup tables need this season's results against this season's schedule.
  const ownSeason = !data.pointsSource.startsWith('proxy')
  const allowed = useMemo(
    () => (ownSeason ? pointsAllowed(data.weekPoints, data.valueWeeks, players, data.schedule, pos) : {}),
    [ownSeason, data.weekPoints, data.valueWeeks, players, data.schedule, pos],
  )
  const starter = analysis.horizonStarter[pos] ?? 0
  const sd = useMemo(
    () => positionSpread(ownSeason ? data.weekPoints : {}, data.valueWeeks, players, pos, starter),
    [ownSeason, data.weekPoints, data.valueWeeks, players, pos, starter],
  )
  const totals = useMemo(
    () =>
      impliedTotals({
        week,
        schedule: data.schedule,
        statLines: lines[week] ?? null,
        market: data.market,
        players,
      }),
    [week, data.schedule, lines, data.market, players],
  )
  const posSlots = (data.league.roster_positions ?? []).filter((s) => s === pos).length || 1
  const mineLabel = posSlots > 1 ? `your weakest starting ${POS_LABEL[pos]}` : `your ${POS_LABEL[pos]}`
  const stream = useMemo(
    () =>
      streamRows({
        pos,
        week,
        aheadWeeks: weeks,
        players,
        rosteredBy: analysis.rosteredBy,
        myPlayers: me?.players ?? [],
        horizon: data.horizon,
        schedule: data.schedule,
        totals,
        allowed,
        statLines: lines[week] ?? null,
        starter,
        sd,
        trending: data.trending,
        starts: posSlots,
      }),
    [pos, week, weeks, players, analysis.rosteredBy, me, data.horizon, data.schedule, totals, allowed, lines, starter, sd, data.trending, posSlots],
  )
  const teamCount = Object.keys(data.schedule?.opp ?? {}).length || 32

  const picks = useMemo(() => {
    const r = stream.rows
    if (!r.length) return null
    const by = (f: (x: StreamRow) => number) => [...r].sort((a, b) => f(b) - f(a))[0]
    return {
      week: r[0],
      upside: by((x) => x.boom),
      hold: by((x) => x.ahead.reduce((a, w) => a + w.proj, 0)),
    }
  }, [stream.rows])

  // Everyone off the wire who would start for you, with the cut it forces already priced in.
  const adds = useMemo(() => ((tab === 'adds' || tab === 'moves') && me ? waiverTargets(data, analysis) : []), [tab, me, data, analysis])
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  const dropCandidate = useMemo(() => {
    if (!me) return null
    const lineup = new Set(analysis.needs[me.rosterId]?.slots.map((s) => s.starter).filter(Boolean) ?? [])
    // The model's value, lifted to the consensus price where that is higher, so an injured star the experts still rank is never the cut.
    // Consensus floors at zero, so it only lifts: below zero the model's order stands.
    const keep = (id: string) => {
      const market = analysis.market[id] ?? -99
      return market + Math.max(0, (models.perceived?.[id] ?? 0) - Math.max(0, market))
    }
    return [...me.players].filter((id) => !lineup.has(id)).sort((a, b) => keep(a) - keep(b))[0] ?? null
  }, [me, analysis, models.perceived])

  const posLabel = POS_LABEL[pos]
  const myProj = stream.mine
  const myOnBye = myProj && !(myProj.proj > 0)

  const streamCols: Column<StreamRow>[] = [
    {
      key: 'player',
      label: 'Player',
      sticky: true,
      sort: (r) => players[r.id]?.name ?? r.id,
      render: (r) => <PlayerName id={r.id} player={players[r.id]} size={24} sub={<span className="font-mono text-[10px]">{r.opp ? `${r.home === false ? '@' : 'vs'} ${r.opp}` : 'BYE'}</span>} />,
    },
    {
      key: 'proj',
      label: 'Proj',
      align: 'right',
      sort: (r) => r.proj,
      render: (r) => <span className="text-ff-text">{fmt(r.proj)}</span>,
    },
    {
      key: 'vs',
      label: 'vs yours',
      align: 'right',
      // A constant offset from the projection: the headline tile carries it on phones.
      hideBelow: 'sm',
      title: `Projection minus ${mineLabel} this week`,
      sort: (r) => r.vsMine ?? -99,
      render: (r) => (r.vsMine != null ? <Num value={r.vsMine} signed /> : <span className="text-ff-muted">–</span>),
    },
    {
      key: 'boom',
      label: 'Boom',
      align: 'right',
      title: `Chance of a starter-level week: ${fmt(starter)}+ pts, the average starting ${posLabel} in this league (spread ±${fmt(sd)})`,
      sort: (r) => r.boom,
      render: (r) => pct(r.boom),
    },
    pos === 'DEF'
      ? {
          key: 'oppTotal',
          label: 'Opp total',
          align: 'right',
          title: 'Points the opponent is expected to score; lower is better for a defense. m = from betting props',
          sort: (r) => -(r.oppTotal?.pts ?? 99),
          render: (r) => <TotalCell t={r.oppTotal} low />,
        }
      : {
          key: 'teamTotal',
          label: 'Team total',
          align: 'right',
          title: 'Points his team is expected to score. m = from betting props',
          sort: (r) => r.teamTotal?.pts ?? 0,
          render: (r) => <TotalCell t={r.teamTotal} />,
        },
    {
      key: 'matchup',
      label: 'Matchup',
      align: 'right',
      hideBelow: 'sm',
      title:
        pos === 'DEF'
          ? 'Fantasy points this opponent’s offense has handed defenses, vs the league average'
          : `Fantasy points this defense has allowed to ${pos}s, vs the league average`,
      sort: (r) => r.matchup?.index ?? 0,
      render: (r) => <MatchupCell m={r.matchup} />,
    },
    {
      key: 'ahead',
      label: `Next ${weeks.length}`,
      hideBelow: 'md',
      title: 'Opponent and projection each week: worth holding, or one and done',
      sort: (r) => r.ahead.reduce((a, w) => a + w.proj, 0),
      render: (r) => (
        <span className="flex gap-1">
          {r.ahead.map((w) => {
            const t = tier(w.matchup)
            return (
              <span
                key={w.week}
                title={`Wk ${w.week}: ${w.opp ?? 'bye'} · proj ${fmt(w.proj)}`}
                className={cx(
                  'inline-flex w-[52px] flex-col items-center border px-1 py-0.5 font-mono text-[10px] leading-tight',
                  w.week === week ? 'border-ff-accent/60' : 'border-ff-line',
                  t === 'easy' ? 'bg-ff-pos/10' : t === 'tough' ? 'bg-ff-neg/10' : '',
                )}
              >
                <span className="text-ff-text2">{w.opp ?? 'BYE'}</span>
                <span className="text-ff-muted">{w.proj > 0 ? fmt(w.proj) : '–'}</span>
              </span>
            )
          })}
        </span>
      ),
    },
    {
      key: 'adds',
      label: 'Sleeper adds',
      align: 'right',
      hideBelow: 'lg',
      title: 'Sleeper managers (all leagues) who added him in the last 24 hours',
      sort: (r) => r.trending,
      render: (r) => (r.trending ? r.trending.toLocaleString() : <span className="text-ff-muted">–</span>),
    },
  ]

  // A suggested bid for every listed add. Moves prices its own few.
  const bids = useMemo(() => {
    const f = models.faab
    if (!f || !me || tab !== 'adds') return {} as Record<string, BidAdvice>
    const out: Record<string, BidAdvice> = {}
    for (const t of adds) out[t.id] = suggestBid(f, me.rosterId, { gain: t.add, value: analysis.market[t.id] ?? 0, trending: trending[t.id] ?? 0, pos: players[t.id]?.pos ?? '' })
    return out
  }, [models.faab, me, tab, adds, analysis.market, players, trending])
  const addWhy = (t: TradeTarget) => {
    const items: Reason[] = [...contextReasons(data.context[t.id], players), ...(bids[t.id]?.reasons ?? [])]
    return items.length ? <Reasons items={items} /> : null
  }

  const addCols: Column<TradeTarget>[] = [
    {
      key: 'p',
      label: 'Player',
      sticky: true,
      sort: (t) => players[t.id]?.name ?? t.id,
      render: (t) => <PlayerName player={players[t.id]} id={t.id} size={24} />,
    },
    {
      key: 'trend',
      label: '',
      hideBelow: 'sm',
      render: (t) =>
        trending[t.id] ? (
          <Badge tone="pos" title={`${trending[t.id].toLocaleString()} Sleeper managers added him in the last 24 hours`}>
            ↑{compact(trending[t.id])}
          </Badge>
        ) : null,
    },
    {
      key: 'slot',
      label: 'Starts at',
      render: (t) => <span className="font-mono text-[11px] text-ff-text2">{t.slot ?? '—'}</span>,
    },
    {
      key: 'add',
      label: 'Gain/wk',
      align: 'right',
      title: 'Points per week your best lineup gains over the horizon, after cutting your least useful player',
      sort: (t) => t.add,
      render: (t) => <Num value={t.add} signed digits={2} />,
    },
    {
      key: 'exp',
      label: 'Exp/wk',
      align: 'right',
      hideBelow: 'sm',
      sort: (t) => analysis.horizon.perWeek[t.id] ?? 0,
      render: (t) => fmt(analysis.horizon.perWeek[t.id]),
    },
    {
      key: 'value',
      label: 'Value',
      align: 'right',
      hideBelow: 'sm',
      title: 'Points per week over a replacement player: what the league at large would pay',
      sort: (t) => analysis.market[t.id] ?? 0,
      render: (t) => <Num value={analysis.market[t.id] ?? 0} signed />,
    },
    {
      key: 'play',
      label: 'Plays',
      align: 'right',
      hideBelow: 'md',
      render: (t) => pct(data.context[t.id]?.play),
    },
    ...(models.faab && me
      ? [
          {
            key: 'bid',
            label: 'Bid',
            align: 'right' as const,
            title: 'Suggested FAAB bid: the lower of what he is worth to you and what this league pays for his value, capped one dollar over the richest rival',
            sort: (t: TradeTarget) => bids[t.id]?.bid ?? 0,
            render: (t: TradeTarget) => (bids[t.id] ? <span className="text-ff-text">${bids[t.id].bid}</span> : <span className="text-ff-muted">–</span>),
          },
        ]
      : []),
    {
      key: 'why',
      label: 'Context',
      hideBelow: 'lg',
      render: (t) => <ContextNotes context={data.context[t.id]} players={players} max={2} />,
    },
  ]

  return (
    <>
      <PageHeader
        code={sectionCode('waivers')}
        title="Waivers"
        tabs={
          <Tabs<Sub>
            items={[
              { key: 'moves', label: 'Moves' },
              { key: 'stream', label: 'Streamers' },
              { key: 'adds', label: 'All adds' },
            ]}
            value={tab}
            onChange={onSub}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {!me && <Empty title="You are not in this league">Waiver picks are read against your roster.</Empty>}

        {me && tab === 'moves' && <WaiverMoves data={data} analysis={analysis} adds={adds} trending={trending} drop={dropCandidate} />}

        {me && tab === 'stream' && data.horizonSource !== 'projections' && (
          <Empty title="No projections to stream from">Streaming reads Sleeper&apos;s projections for the weeks ahead, and there are none right now (the season may be over).</Empty>
        )}

        {me && tab === 'stream' && data.horizonSource === 'projections' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<StreamPos> label="Position" value={pos} onChange={setPos} options={positions.map((p) => ({ key: p, label: p }))} />
              {weeks.length > 1 && (
                <Segmented<string>
                  label="Week"
                  value={String(week)}
                  onChange={(w) => setWeek(Number(w))}
                  options={weeks.map((w) => ({
                    key: String(w),
                    label: `Wk ${w}`,
                  }))}
                />
              )}
            </div>
            {!positions.length ? (
              <Empty title="No positions to stream">This league&apos;s lineup has no slot these positions fill.</Empty>
            ) : (
              <>
                <StatGrid>
                  <Stat
                    label={posSlots > 1 ? `Your ${pos}${posSlots}` : `Your ${posLabel}`}
                    value={myProj ? fmt(myProj.proj) : '–'}
                    sub={myProj ? `${players[myProj.id]?.name ?? myProj.id}${myOnBye ? ' · bye or out' : ''}` : 'none rostered'}
                    delta={myOnBye ? <Badge tone="warn">need one</Badge> : undefined}
                  />
                  <Stat
                    label="Best this week"
                    value={picks ? fmt(picks.week.proj) : '–'}
                    sub={picks ? players[picks.week.id]?.name : 'no free agents projected'}
                    delta={picks?.week.vsMine != null ? <DeltaChip value={picks.week.vsMine} title={`Against ${mineLabel}`} /> : undefined}
                  />
                  <Stat label="Most upside" value={picks ? pct(picks.upside.boom) : '–'} sub={picks ? `${players[picks.upside.id]?.name} · boom odds` : '–'} />
                  <Stat
                    label={`Best ${weeks.length}-wk hold`}
                    value={picks ? fmt(picks.hold.ahead.reduce((a, w) => a + w.proj, 0)) : '–'}
                    sub={picks ? `${players[picks.hold.id]?.name} · wks ${weeks[0]}–${weeks[weeks.length - 1]}` : '–'}
                  />
                </StatGrid>
                <Panel title={`Free-agent ${posLabel}s · week ${week}`} pad={false} actions={<span>{stream.rows.length} shown</span>}>
                  {stream.rows.length ? (
                    <Table
                      rows={stream.rows}
                      rowKey={(r) => r.id}
                      columns={streamCols}
                      defaultSort="proj"
                      expand={(r) => {
                        const items: Reason[] = [...streamReasons(r, pos, teamCount), ...contextReasons(data.context[r.id], players)]
                        return items.length ? <Reasons items={items} /> : null
                      }}
                    />
                  ) : (
                    <div className="p-4 text-[13px] text-ff-muted">No free agent at this position has a projection for week {week}.</div>
                  )}
                </Panel>
                <p className="text-[11.5px] leading-relaxed text-ff-muted">
                  <span className="text-ff-text2">Proj</span> blends prop lines into next week. <span className="text-ff-text2">{pos === 'DEF' ? 'Opp total' : 'Team total'}</span>{' '}
                  {pos === 'DEF' ? 'is what the offense he faces should score' : 'is what his offense should score'} (<N>m</N> = from props, else Vegas via Sleeper).{' '}
                  <span className="text-ff-text2">Matchup</span> is what this opponent {pos === 'DEF' ? 'gives up to defenses' : `allows ${pos}s`} vs average
                  {!ownSeason ? ' (needs this season’s results)' : ''}. <span className="text-ff-text2">Boom</span> is the chance of <N>{fmt(starter)}+</N>, an average starter
                  (<N>±{fmt(sd)}</N> weekly). Green weeks ahead are easy, red tough.
                </p>
              </>
            )}
          </>
        )}

        {me && tab === 'adds' && (
          <>
            <StatGrid>
              <Stat
                label="Best add"
                value={adds[0] ? <Num value={adds[0].add} signed /> : '–'}
                sub={adds[0] ? `${players[adds[0].id]?.name} · pts/wk to your lineup` : 'nobody cracks your lineup'}
              />
              <Stat
                label="Hottest add"
                value={data.trending[0] ? data.trending[0].count.toLocaleString() : '–'}
                sub={
                  data.trending[0]
                    ? `${players[data.trending[0].player_id]?.name ?? '–'} · Sleeper adds, last 24h${analysis.rosteredBy[data.trending[0].player_id] != null ? ' · rostered here' : ''}`
                    : 'no trend data'
                }
              />
              <Stat
                label="Drop candidate"
                value={dropCandidate ? (players[dropCandidate]?.name.split(' ').slice(-1)[0] ?? '–') : '–'}
                sub={dropCandidate ? `lowest value on your bench · ${fmt(analysis.market[dropCandidate] ?? 0)}/wk` : '–'}
              />
            </StatGrid>
            <Panel title={`Free agents who would start for you · wks ${data.horizon[0]?.week ?? ''}–${data.horizon[data.horizon.length - 1]?.week ?? ''}`} pad={false}>
              <Table rows={adds} rowKey={(t) => t.id} columns={addCols} defaultSort="add" empty="No free agent would crack your lineup." expand={addWhy} canExpand={(t) => !!bids[t.id]?.reasons.length || !!data.context[t.id]?.notes.length} />
            </Panel>
            <p className="text-[11.5px] leading-relaxed text-ff-muted">
              Gain = your best lineup with him in and your weakest player cut, minus today&apos;s, week by week. Anything positive is a real upgrade; a bye fill counts only that
              week. Value is what the league would pay.
            </p>
          </>
        )}
      </div>
    </>
  )
}

export default WaiversView
