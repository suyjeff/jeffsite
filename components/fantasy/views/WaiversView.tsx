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
import { ContextNotes } from '../ContextNotes'
import PlayerName from '../PlayerName'
import { sectionCode } from '../Shell'
import { DeltaChip, Badge, CenterMeter, Empty, Num, PageHeader, Panel, Segmented, Stat, StatGrid, Table, Tabs, compact, cx, fmt, pct, type Column } from '../ui'

type Sub = 'stream' | 'adds'
const SUBS: Sub[] = ['stream', 'adds']
const AHEAD = 3

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
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'stream'
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
      }),
    [pos, week, weeks, players, analysis.rosteredBy, me, data.horizon, data.schedule, totals, allowed, lines, starter, sd, data.trending],
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
  const adds = useMemo(() => (tab === 'adds' && me ? waiverTargets(data, analysis) : []), [tab, me, data, analysis])
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  const dropCandidate = useMemo(() => {
    if (!me) return null
    const lineup = new Set(analysis.needs[me.rosterId]?.slots.map((s) => s.starter).filter(Boolean) ?? [])
    return [...me.players].filter((id) => !lineup.has(id)).sort((a, b) => (analysis.market[a] ?? -99) - (analysis.market[b] ?? -99))[0] ?? null
  }, [me, analysis])

  const posLabel = pos === 'DEF' ? 'defense' : pos === 'K' ? 'kicker' : 'quarterback'
  const myProj = stream.mine
  const myOnBye = myProj && !(myProj.proj > 0)

  const streamCols: Column<StreamRow>[] = [
    {
      key: 'player',
      label: 'Player',
      sticky: true,
      sort: (r) => players[r.id]?.name ?? r.id,
      render: (r) => {
        const why = streamReasons(r, pos, teamCount)
        return (
          <span className="block min-w-0">
            <PlayerName id={r.id} player={players[r.id]} size={24} sub={r.opp ? `${r.home === false ? '@' : 'vs'} ${r.opp}` : 'bye'} />
            {why.length > 0 && (
              <span title={why.join(' · ')} className="mt-0.5 hidden max-w-[360px] truncate pl-8 text-[11px] text-ff-muted md:block">
                {why.join(' · ')}
              </span>
            )}
          </span>
        )
      },
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
      title: `Projection minus your best ${posLabel} this week`,
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
      label: 'Adds',
      align: 'right',
      hideBelow: 'lg',
      title: 'Sleeper-wide adds in the last 24 hours',
      sort: (r) => r.trending,
      render: (r) => (r.trending ? r.trending.toLocaleString() : <span className="text-ff-muted">–</span>),
    },
  ]

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
          <Badge tone="pos" title={`${trending[t.id].toLocaleString()} adds across Sleeper in the last 24h`}>
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
    {
      key: 'why',
      label: 'Context',
      hideBelow: 'lg',
      render: (t) => <ContextNotes context={data.context[t.id]} players={players} max={3} />,
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
              { key: 'stream', label: 'Streamers' },
              { key: 'adds', label: 'Adds' },
            ]}
            value={tab}
            onChange={onSub}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {!me && <Empty title="You are not in this league">Waiver picks are read against your roster.</Empty>}

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
              <Empty title="No streaming slots">This league starts no quarterback, kicker or defense slot to stream.</Empty>
            ) : (
              <>
                <StatGrid>
                  <Stat
                    label={`Your ${posLabel}`}
                    value={myProj ? fmt(myProj.proj) : '–'}
                    sub={myProj ? `${players[myProj.id]?.name ?? myProj.id}${myOnBye ? ' · bye or out' : ''}` : 'none rostered'}
                    delta={myOnBye ? <Badge tone="warn">need one</Badge> : undefined}
                  />
                  <Stat
                    label="Best this week"
                    value={picks ? fmt(picks.week.proj) : '–'}
                    sub={picks ? players[picks.week.id]?.name : 'no free agents projected'}
                    delta={picks?.week.vsMine != null ? <DeltaChip value={picks.week.vsMine} title="Against your best at the position" /> : undefined}
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
                    <Table rows={stream.rows} rowKey={(r) => r.id} columns={streamCols} defaultSort="proj" />
                  ) : (
                    <div className="p-4 text-[13px] text-ff-muted">No free agent at this position has a projection for week {week}.</div>
                  )}
                </Panel>
                <p className="text-[11.5px] leading-relaxed text-ff-muted">
                  <span className="text-ff-text2">How to read it.</span> Proj is the week&apos;s projection (blended with prop lines for the coming week).{' '}
                  {pos === 'DEF' ? 'Opp total is what the offense across from him is expected to score' : 'Team total is what his offense is expected to score'}: from the
                  kicker&apos;s extra-point and field-goal props where the board has them (marked m), otherwise Sleeper&apos;s projected points allowed, which is built on the Vegas
                  line. Matchup is what this opponent has {pos === 'DEF' ? 'handed defenses' : `allowed to ${pos}s`} per game this season against the league average
                  {!ownSeason ? ' (not available until this season has results)' : ''}. Boom is the chance of a week at or above the league&apos;s average starting {posLabel} (
                  {fmt(starter)}), using the position&apos;s measured week-to-week spread of ±{fmt(sd)}. Shaded weeks ahead are easy (green) or tough (red) matchups.
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
                    ? `${players[data.trending[0].player_id]?.name ?? '–'} · adds 24h${analysis.rosteredBy[data.trending[0].player_id] != null ? ' · rostered here' : ''}`
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
              <Table rows={adds} rowKey={(t) => t.id} columns={addCols} defaultSort="add" empty="No free agent would crack your lineup." />
            </Panel>
            <p className="text-[11.5px] leading-relaxed text-ff-muted">
              Gain is solved week by week over the pricing horizon: your best lineup with him added and your least useful player cut, minus your lineup today, so any positive
              number is a real upgrade and a player who only covers a bye counts for that week alone. Value is what the league at large would pay.
            </p>
          </>
        )}
      </div>
    </>
  )
}

export default WaiversView
