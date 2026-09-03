import React, { useMemo } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { optimalLineup } from '../../lib/fantasy/lineup'
import PlayerName from './PlayerName'
import { Avatar, Card, Muted, Pill, Sparkline, Table, fmt, fmtSigned, pct, type Column } from './ui'

type PlayerRow = { id: string; slot: string; starter: boolean }

const TeamsTab = ({ data, analysis, rosterId, onSelectTeam }: { data: LeagueData; analysis: Analysis; rosterId: number; onSelectTeam: (id: number) => void }) => {
  const { teamById, seasonById, powerById, values, posRanks, myRosterId } = analysis
  const team = teamById[rosterId] ?? analysis.teams[0]
  const season = seasonById[team.rosterId]
  const power = powerById[team.rosterId]
  const players = data.players

  const rows: PlayerRow[] = useMemo(() => {
    const starters = (team.roster.starters ?? []).filter((s) => s && s !== '0')
    const starterSet = new Set(starters)
    const slotNames = (data.league.roster_positions ?? []).filter((p) => !['BN', 'IR', 'TAXI'].includes(p))
    const out: PlayerRow[] = starters.map((id, i) => ({ id, slot: slotNames[i] ?? 'ST', starter: true }))
    const reserve = new Set(team.roster.reserve ?? [])
    const taxi = new Set(team.roster.taxi ?? [])
    for (const id of team.players) {
      if (starterSet.has(id)) continue
      out.push({ id, slot: reserve.has(id) ? 'IR' : taxi.has(id) ? 'TAXI' : 'BN', starter: false })
    }
    return out
  }, [team, data.league.roster_positions])

  const projectedNow = useMemo(() => {
    if (!data.projections) return null
    const lineup = optimalLineup(
      analysis.slots,
      team.players.filter((id) => players[id]).map((id) => ({ id, fpos: players[id].fpos, pts: data.projections![id] ?? 0 })),
    )
    return lineup.total
  }, [data.projections, analysis.slots, team.players, players])

  const columns: Column<PlayerRow>[] = [
    { key: 'slot', label: 'Slot', render: (r) => <span className={r.starter ? 'text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500'}>{r.slot}</span> },
    { key: 'player', label: 'Player', sort: (r) => players[r.id]?.name ?? r.id, render: (r) => <PlayerName player={players[r.id]} id={r.id} sub={players[r.id]?.age ? `${players[r.id].age}y` : undefined} /> },
    { key: 'games', label: 'G', align: 'right', sort: (r) => values[r.id]?.games ?? 0, render: (r) => values[r.id]?.games ?? <Muted>0</Muted> },
    { key: 'ppg', label: 'PPG', align: 'right', sort: (r) => values[r.id]?.ppg ?? -99, render: (r) => fmt(values[r.id]?.ppg) },
    { key: 'range', label: 'Floor–Ceil', align: 'right', title: '25th to 75th percentile of weekly points', render: (r) => (values[r.id] ? `${fmt(values[r.id].floor)}–${fmt(values[r.id].ceiling)}` : '–') },
    { key: 'par', label: 'PAR/G', align: 'right', title: 'Points above replacement per game', sort: (r) => values[r.id]?.parPerGame ?? -99, render: (r) => fmtSigned(values[r.id]?.parPerGame) },
    { key: 'war', label: 'WAR', align: 'right', title: 'Wins above replacement over the value window', sort: (r) => values[r.id]?.war ?? -99, render: (r) => fmtSigned(values[r.id]?.war, 2) },
    { key: 'rwar', label: 'Now', align: 'right', title: 'Recency-weighted WAR per game', sort: (r) => values[r.id]?.recentWarPerGame ?? -99, render: (r) => fmtSigned(values[r.id]?.recentWarPerGame, 3) },
    { key: 'rank', label: 'Pos rk', align: 'right', sort: (r) => -(posRanks[r.id] ?? 999), render: (r) => (posRanks[r.id] ? `${players[r.id]?.pos}${posRanks[r.id]}` : '–') },
    ...(data.projections
      ? [{ key: 'proj', label: `Wk ${data.projectionWeek} proj`, align: 'right' as const, sort: (r: PlayerRow) => data.projections![r.id] ?? -1, render: (r: PlayerRow) => fmt(data.projections![r.id]) }]
      : []),
    { key: 'spark', label: 'Weekly', render: (r) => <Sparkline points={values[r.id]?.weekly.map((w) => w.pts) ?? []} labels={values[r.id]?.weekly.map((w) => `Wk ${w.week}`)} baseline={values[r.id] ? analysis.levels[values[r.id].weekly[0]?.week]?.[players[r.id]?.pos] : undefined} /> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {analysis.teams.map((t) => (
          <button
            key={t.rosterId}
            onClick={() => onSelectTeam(t.rosterId)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs tracking-tight transition-colors ${
              t.rosterId === team.rosterId
                ? 'border-stone-900 bg-stone-900 text-stone-100 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                : 'border-stone-200 text-stone-600 hover:border-stone-400 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600'
            }`}
          >
            <Avatar src={t.avatar} name={t.name} size={16} />
            {t.name}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-3">
            <Avatar src={team.avatar} name={team.name} size={40} />
            <div>
              <h2 className="text-lg font-medium tracking-tight leading-tight">
                {team.name} {team.rosterId === myRosterId && <Pill tone="accent">you</Pill>}
              </h2>
              <div className="text-sm text-stone-400 dark:text-stone-500">{team.owner}</div>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {[
              ['Power', `#${power.rank} · ${fmt(power.score, 0)}`],
              ['Record', `${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}`],
              ['All-play', `${fmt(season.allPlayWins, 0)}-${fmt(season.allPlayLosses, 0)}`],
              ['Luck', fmtSigned(season.luck, 1)],
              ['PF/G', fmt(season.ppg)],
              ['Eff', pct(season.efficiency)],
              ['Roster', fmtSigned(analysis.strength[team.rosterId], 2)],
              ...(projectedNow !== null ? [[`Wk ${data.projectionWeek} optimal proj`, fmt(projectedNow)]] : []),
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card title="Roster" aside={`values from ${data.valueSeason} · ${data.valueWeeks.length} wks`}>
        <Table rows={rows} columns={columns} rowKey={(r) => r.id} rowClass={(r) => (r.starter ? '' : 'text-stone-500 dark:text-stone-400')} />
      </Card>

      {season.weeks.length > 0 && (
        <Card title="Results">
          <Table
            rows={season.weeks}
            columns={[
              { key: 'week', label: 'Wk', render: (w) => w.week },
              { key: 'opp', label: 'Opponent', render: (w) => (w.opponentId != null ? teamById[w.opponentId]?.name : <Muted>bye</Muted>) },
              { key: 'score', label: 'Score', align: 'right', render: (w) => `${fmt(w.points)} – ${fmt(w.opponentPoints)}` },
              { key: 'result', label: 'Res', align: 'right', render: (w) => <Pill tone={w.result === 'W' ? 'good' : w.result === 'L' ? 'bad' : 'neutral'}>{w.result ?? '–'}</Pill> },
              { key: 'opt', label: 'Optimal', align: 'right', title: 'Best lineup you could have started', render: (w) => fmt(w.optimalPoints) },
              { key: 'left', label: 'Left on bench', align: 'right', render: (w) => fmt(w.optimalPoints - w.points) },
              {
                key: 'allplay',
                label: 'All-play',
                align: 'right',
                render: (w) => {
                  const others = (analysis.teamWeeks[w.week] ?? []).filter((t) => t.rosterId !== w.rosterId)
                  const wins = others.filter((t) => t.points < w.points).length
                  return `${wins}-${others.length - wins}`
                },
              },
            ]}
            rowKey={(w) => w.week}
            defaultSort="week"
            defaultDesc={false}
          />
        </Card>
      )}
    </div>
  )
}

export default TeamsTab
