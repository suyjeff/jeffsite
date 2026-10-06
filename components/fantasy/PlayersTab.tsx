import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { lineupDelta } from '../../lib/fantasy/war'
import PlayerName from './PlayerName'
import { Card, Muted, Pill, Sparkline, Table, fmt, fmtSigned, type Column } from './ui'

type Row = { id: string; valueToMe: number | null }

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF']
const PAGE = 75

const PlayersTab = ({ data, analysis }: { data: LeagueData; analysis: Analysis }) => {
  const [pos, setPos] = useState('ALL')
  const [avail, setAvail] = useState<'all' | 'fa' | 'rostered' | 'mine'>('all')
  const [query, setQuery] = useState('')
  const [minGames, setMinGames] = useState(1)
  const [limit, setLimit] = useState(PAGE)
  const { values, players, rosteredBy, myRosterId, teamById, posRanks } = { ...analysis, players: data.players }
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  const myPlayers = myRosterId != null ? teamById[myRosterId].players : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return Object.values(values)
      .filter((v) => {
        const p = players[v.id]
        if (!p) return false
        if (pos !== 'ALL' && p.pos !== pos) return false
        if (v.games < minGames) return false
        const owner = rosteredBy[v.id]
        if (avail === 'fa' && owner !== undefined) return false
        if (avail === 'rostered' && owner === undefined) return false
        if (avail === 'mine' && owner !== myRosterId) return false
        if (q && !p.name.toLowerCase().includes(q) && !(p.team ?? '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => b.war - a.war)
  }, [values, players, pos, minGames, avail, rosteredBy, myRosterId, query])

  const rows: Row[] = useMemo(
    () =>
      filtered.slice(0, limit).map((v) => {
        let valueToMe: number | null = null
        if (myRosterId != null && rosteredBy[v.id] !== myRosterId && data.valueWeeks.length) {
          valueToMe = lineupDelta(analysis.slots, data.weekPoints, data.valueWeeks, players, myPlayers, [], [v.id]).avg
        }
        return { id: v.id, valueToMe }
      }),
    [filtered, limit, myRosterId, rosteredBy, data.valueWeeks, data.weekPoints, analysis.slots, players, myPlayers],
  )

  const columns: Column<Row>[] = [
    { key: 'rank', label: 'Pos rk', sort: (r) => -(posRanks[r.id] ?? 999), render: (r) => <Muted>{players[r.id].pos}{posRanks[r.id]}</Muted> },
    {
      key: 'player',
      label: 'Player',
      sort: (r) => players[r.id].name,
      render: (r) => (
        <PlayerName
          player={players[r.id]}
          id={r.id}
          sub={
            rosteredBy[r.id] !== undefined ? (
              <span className={rosteredBy[r.id] === myRosterId ? 'text-sky-700 dark:text-sky-300' : ''}>{teamById[rosteredBy[r.id]].name}</span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-400">free agent</span>
            )
          }
        />
      ),
    },
    { key: 'trend', label: '', render: (r) => (trending[r.id] ? <Pill tone="good">+{trending[r.id]} adds</Pill> : null) },
    { key: 'games', label: 'G', align: 'right', sort: (r) => values[r.id].games, render: (r) => values[r.id].games },
    { key: 'ppg', label: 'PPG', align: 'right', sort: (r) => values[r.id].ppg, render: (r) => fmt(values[r.id].ppg) },
    { key: 'risk', label: 'Risk-adj', align: 'right', title: 'PPG minus a penalty for week-to-week variance (Model tab)', sort: (r) => values[r.id].riskAdjPpg, render: (r) => fmt(values[r.id].riskAdjPpg) },
    { key: 'range', label: 'Floor–Ceil', align: 'right', render: (r) => `${fmt(values[r.id].floor)}–${fmt(values[r.id].ceiling)}` },
    { key: 'par', label: 'PAR/G', align: 'right', sort: (r) => values[r.id].parPerGame, render: (r) => fmtSigned(values[r.id].parPerGame) },
    { key: 'war', label: 'WAR', align: 'right', sort: (r) => values[r.id].war, render: (r) => <span className="font-medium">{fmtSigned(values[r.id].war, 2)}</span> },
    { key: 'warg', label: 'WAR/G', align: 'right', sort: (r) => values[r.id].warPerGame, render: (r) => fmtSigned(values[r.id].warPerGame, 3) },
    { key: 'now', label: 'Now', align: 'right', title: 'Recency-weighted WAR per game', sort: (r) => values[r.id].recentWarPerGame, render: (r) => fmtSigned(values[r.id].recentWarPerGame, 3) },
    ...(myRosterId != null
      ? [
          {
            key: 'me',
            label: 'To me',
            align: 'right' as const,
            title: 'Points per week this player would have added to your optimal lineup',
            sort: (r: Row) => r.valueToMe ?? -99,
            render: (r: Row) => (r.valueToMe === null ? <Muted>–</Muted> : <span className={r.valueToMe > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}>{fmtSigned(r.valueToMe)}</span>),
          },
        ]
      : []),
    { key: 'spark', label: 'Weekly', render: (r) => <Sparkline points={values[r.id].weekly.map((w) => w.pts)} labels={values[r.id].weekly.map((w) => `Wk ${w.week}`)} width={90} /> },
  ]

  const select = 'rounded border border-stone-200 bg-transparent px-2 py-1 text-sm dark:border-stone-800'
  return (
    <Card
      title="Player values"
      aside={`${filtered.length} players · ${data.valueSeason} wks ${data.valueWeeks[0] ?? '–'}–${data.valueWeeks[data.valueWeeks.length - 1] ?? '–'}`}
    >
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="flex gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPos(p)}
              className={`rounded px-2 py-1 text-xs ${pos === p ? 'bg-stone-900 text-stone-100 dark:bg-stone-100 dark:text-stone-900' : 'bg-stone-200/60 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <select value={avail} onChange={(e) => setAvail(e.target.value as typeof avail)} className={select}>
          <option value="all">Everyone</option>
          <option value="fa">Free agents</option>
          <option value="rostered">Rostered</option>
          {myRosterId != null && <option value="mine">My team</option>}
        </select>
        <select value={minGames} onChange={(e) => setMinGames(Number(e.target.value))} className={select}>
          {[1, 3, 5, 8].map((n) => (
            <option key={n} value={n}>
              {n}+ games
            </option>
          ))}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or team" className={`${select} flex-1 min-w-[140px]`} />
      </div>
      <Table rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort="war" empty="No scoring data for this filter." />
      {filtered.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="mt-3 text-sm underline decoration-stone-400">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </button>
      )}
    </Card>
  )
}

export default PlayersTab
