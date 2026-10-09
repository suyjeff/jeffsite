import React, { useMemo } from 'react'
import { pastProjection, type Analysis } from '../../../lib/fantasy/analysis'
import { makeHorizonEval } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes, PlayoffSchedule, contextReasons } from '../ContextNotes'
import PlayerName from '../PlayerName'
import { Num, Reasons, Sparkline, Table, cx, fmt, fmtSigned, pct, type Column } from '../ui'

export type Basis = 'ahead' | 'todate'

type Row = { id: string; slot: string; starter: boolean }

const NON_START = new Set(['BN', 'IR', 'TAXI'])

/**
 * A roster as Sleeper has it set: starters in slot order, then bench, IR and
 * taxi. "Ahead" prices each player over the horizon; "to date" shows what he
 * has done.
 */
const RosterTable = ({ data, analysis, rosterId, basis }: { data: LeagueData; analysis: Analysis; rosterId: number; basis: Basis }) => {
  const team = analysis.teamById[rosterId]
  const players = data.players
  const { values, posRanks } = analysis

  const rows: Row[] = useMemo(() => {
    // Index slots on the unfiltered list: an empty slot ('0') still holds its place.
    const slotted = team.roster.starters ?? []
    const starterSet = new Set(slotted.filter((s) => s && s !== '0'))
    const slotNames = (data.league.roster_positions ?? []).filter((p) => !NON_START.has(p))
    const out: Row[] = slotted.flatMap((id, i) => (id && id !== '0' ? [{ id, slot: (slotNames[i] ?? 'ST').replace('SUPER_FLEX', 'SF'), starter: true }] : []))
    const reserve = new Set(team.roster.reserve ?? [])
    const taxi = new Set(team.roster.taxi ?? [])
    for (const id of team.players) {
      if (starterSet.has(id)) continue
      out.push({ id, slot: reserve.has(id) ? 'IR' : taxi.has(id) ? 'TX' : 'BN', starter: false })
    }
    return out
  }, [team, data.league.roster_positions])

  // What the lineup loses without each player, over the horizon.
  const loss = useMemo(() => {
    if (basis !== 'ahead' || !data.horizon.length) return {}
    const ev = makeHorizonEval(analysis.slots, players, data.horizon, analysis.horizonReplacement)
    const base = ev.total(team.players)
    const out: Record<string, number> = {}
    for (const id of team.players) out[id] = base - ev.total(team.players.filter((x) => x !== id))
    return out
  }, [basis, data.horizon, analysis.slots, analysis.horizonReplacement, players, team.players])

  const slotCol: Column<Row> = {
    key: 'slot',
    label: 'Slot',
    render: (r) => <span className={cx('font-mono text-[11px]', r.starter ? 'text-ff-text2' : 'text-ff-muted')}>{r.slot}</span>,
  }
  const playerCol: Column<Row> = { key: 'player', label: 'Player', sticky: true, sort: (r) => players[r.id]?.name ?? r.id, render: (r) => <PlayerName player={players[r.id]} id={r.id} /> }

  const ahead: Column<Row>[] = [
    slotCol,
    playerCol,
    { key: 'exp', label: 'Exp/wk', align: 'right', title: 'Expected points per week over the horizon, after injury odds and teammates’ absences', sort: (r) => analysis.horizon.perWeek[r.id] ?? 0, render: (r) => <span className="text-ff-text">{fmt(analysis.horizon.perWeek[r.id])}</span> },
    { key: 'raw', label: 'Base', align: 'right', hideBelow: 'sm', title: 'Projection per week over the horizon before injury and role adjustments: Sleeper, with the coming week blended with prop lines', sort: (r) => data.context[r.id]?.raw ?? 0, render: (r) => fmt(data.context[r.id]?.raw) },
    { key: 'play', label: 'Plays', align: 'right', hideBelow: 'sm', sort: (r) => data.context[r.id]?.play ?? 1, render: (r) => <span className={(data.context[r.id]?.play ?? 1) < 0.8 ? 'text-ff-neg' : ''}>{pct(data.context[r.id]?.play)}</span> },
    { key: 'loss', label: 'If gone', align: 'right', title: 'Points per week your optimal lineup loses without him', sort: (r) => loss[r.id] ?? 0, render: (r) => <Num value={loss[r.id] != null ? -loss[r.id] : null} signed digits={2} /> },
    { key: 'mkt', label: 'Value', align: 'right', hideBelow: 'md', title: 'Points per week above replacement at his position', sort: (r) => analysis.market[r.id] ?? -99, render: (r) => fmt(analysis.market[r.id]) },
    ...(data.playoffWeeks.length
      ? [{ key: 'po', label: 'Playoff opp', hideBelow: 'lg' as const, render: (r: Row) => <PlayoffSchedule context={data.context[r.id]} weeks={data.playoffWeeks} /> }]
      : []),
    { key: 'why', label: 'Context', hideBelow: 'md', render: (r) => <ContextNotes context={data.context[r.id]} players={players} max={2} /> },
  ]

  const todate: Column<Row>[] = [
    slotCol,
    playerCol,
    { key: 'g', label: 'G', align: 'right', sort: (r) => values[r.id]?.games ?? 0, render: (r) => values[r.id]?.games ?? 0 },
    { key: 'ppg', label: 'PPG', align: 'right', sort: (r) => values[r.id]?.ppg ?? -99, render: (r) => <span className="text-ff-text">{fmt(values[r.id]?.ppg)}</span> },
    { key: 'range', label: 'Floor–Ceil', align: 'right', hideBelow: 'md', title: '25th to 75th percentile of weekly points', render: (r) => (values[r.id] ? `${fmt(values[r.id].floor)}–${fmt(values[r.id].ceiling)}` : '–') },
    { key: 'par', label: 'PAR/G', align: 'right', hideBelow: 'sm', title: 'Points above replacement per game', sort: (r) => values[r.id]?.parPerGame ?? -99, render: (r) => fmtSigned(values[r.id]?.parPerGame) },
    { key: 'war', label: 'WAR', align: 'right', title: 'Wins above replacement to date', sort: (r) => values[r.id]?.war ?? -99, render: (r) => <Num value={values[r.id]?.war} signed digits={2} /> },
    { key: 'now', label: 'Now', align: 'right', hideBelow: 'md', title: 'Recency-weighted WAR per game', sort: (r) => values[r.id]?.recentWarPerGame ?? -99, render: (r) => fmtSigned(values[r.id]?.recentWarPerGame, 3) },
    { key: 'rk', label: 'Pos rk', align: 'right', hideBelow: 'sm', sort: (r) => -(posRanks[r.id] ?? 999), render: (r) => (posRanks[r.id] ? `${players[r.id]?.pos}${posRanks[r.id]}` : '–') },
    {
      key: 'spark',
      label: 'Weekly',
      hideBelow: 'sm',
      render: (r) => (
        <Sparkline
          points={values[r.id]?.weekly.map((w) => w.pts) ?? []}
          projected={pastProjection(data, r.id, values[r.id]?.weekly.map((w) => w.week) ?? [])}
          labels={values[r.id]?.weekly.map((w) => `Wk ${w.week}`)}
          width={84}
        />
      ),
    },
  ]

  return (
    <Table
      rows={rows}
      columns={basis === 'ahead' ? ahead : todate}
      rowKey={(r) => r.id}
      rowClass={(r) => (r.starter ? '' : 'opacity-80')}
      canExpand={(r) => !!data.context[r.id]?.notes.length}
      expand={(r) => {
        const items = contextReasons(data.context[r.id], players)
        return items.length ? <Reasons items={items} /> : null
      }}
    />
  )
}

export default RosterTable
