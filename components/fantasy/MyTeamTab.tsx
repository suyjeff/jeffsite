import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { optimalLineup, type LineupPlayer } from '../../lib/fantasy/lineup'
import { lineupDelta } from '../../lib/fantasy/war'
import PlayerName from './PlayerName'
import { Card, Muted, Pill, Table, fmt, fmtSigned, PosPill } from './ui'

const MyTeamTab = ({ data, analysis }: { data: LeagueData; analysis: Analysis }) => {
  const { myRosterId, teamById, values, rosteredBy, slots } = analysis
  const players = data.players
  const weeks = data.valueWeeks
  const [partnerId, setPartnerId] = useState<number | null>(null)
  const [give, setGive] = useState<string[]>([])
  const [get, setGet] = useState<string[]>([])

  if (myRosterId == null) {
    return (
      <Card title="My team">
        <p className="text-sm">No roster in this league belongs to {data.me.display_name ?? data.me.username}. Pick a different league above.</p>
      </Card>
    )
  }
  const me = teamById[myRosterId]
  const mine = me.players

  // --- Lineup check on projections ---
  const lineupCheck = useMemo(() => {
    if (!data.projections) return null
    const proj = data.projections
    const toLP = (ids: string[]): LineupPlayer[] => ids.filter((id) => players[id]).map((id) => ({ id, fpos: players[id].fpos, pts: proj[id] ?? 0 }))
    const starters = (me.roster.starters ?? []).filter((s) => s && s !== '0')
    const current = starters.reduce((a, id) => a + (proj[id] ?? 0), 0)
    const best = optimalLineup(slots, toLP(mine))
    const bestIds = new Set(best.assignments.filter(Boolean).map((p) => p!.id))
    const starterSet = new Set(starters)
    const benchThem = starters.filter((id) => !bestIds.has(id))
    const startThem = [...bestIds].filter((id) => !starterSet.has(id))
    return { current, best: best.total, benchThem, startThem }
  }, [data.projections, me.roster.starters, mine, players, slots])

  // --- Who carries the team ---
  const essential = useMemo(
    () =>
      mine
        .filter((id) => players[id])
        .map((id) => ({ id, lost: weeks.length ? -lineupDelta(slots, data.weekPoints, weeks, players, mine, [id], []).avg : 0 }))
        .sort((a, b) => b.lost - a.lost),
    [mine, players, weeks, slots, data.weekPoints],
  )

  // --- Positional strength vs league ---
  const slotStrength = useMemo(() => {
    if (!weeks.length) return []
    const perTeam = analysis.teams.map((t) => {
      const sums = slots.map(() => 0)
      for (const w of weeks) {
        const pts = data.weekPoints[w] ?? {}
        const lineup = optimalLineup(slots, t.players.filter((id) => players[id]).map((id) => ({ id, fpos: players[id].fpos, pts: pts[id] ?? 0 })))
        lineup.assignments.forEach((p, i) => (sums[i] += p?.pts ?? 0))
      }
      return { rosterId: t.rosterId, avg: sums.map((s) => s / weeks.length) }
    })
    const mineRow = perTeam.find((t) => t.rosterId === myRosterId)!
    return slots.map((slot, i) => {
      const all = perTeam.map((t) => t.avg[i]).sort((a, b) => b - a)
      const league = all.reduce((a, b) => a + b, 0) / all.length
      const rank = all.findIndex((v) => v <= mineRow.avg[i]) + 1
      return { slot: slot.name, mine: mineRow.avg[i], league, rank }
    })
  }, [analysis.teams, slots, weeks, data.weekPoints, players, myRosterId])

  // --- Targets ---
  const targets = useMemo(() => {
    if (!weeks.length) return { trade: [], waiver: [] }
    const candidates = Object.values(values)
      .filter((v) => players[v.id] && rosteredBy[v.id] !== myRosterId && v.games >= Math.min(3, weeks.length))
      .sort((a, b) => b.recentWarPerGame - a.recentWarPerGame)
      .slice(0, 160)
      .map((v) => ({ id: v.id, gain: lineupDelta(slots, data.weekPoints, weeks, players, mine, [], [v.id]).avg, owner: rosteredBy[v.id] }))
      .sort((a, b) => b.gain - a.gain)
    return {
      trade: candidates.filter((c) => c.owner !== undefined).slice(0, 12),
      waiver: candidates.filter((c) => c.owner === undefined).slice(0, 10),
    }
  }, [values, players, rosteredBy, myRosterId, weeks, slots, data.weekPoints, mine])

  // --- Trade evaluator ---
  const partner = partnerId != null ? teamById[partnerId] : null
  const trade = useMemo(() => {
    if (!partner || (!give.length && !get.length) || !weeks.length) return null
    const meDelta = lineupDelta(slots, data.weekPoints, weeks, players, mine, give, get)
    const themDelta = lineupDelta(slots, data.weekPoints, weeks, players, partner.players, get, give)
    const warOut = give.reduce((a, id) => a + (values[id]?.recentWarPerGame ?? 0), 0)
    const warIn = get.reduce((a, id) => a + (values[id]?.recentWarPerGame ?? 0), 0)
    return { meDelta, themDelta, warOut, warIn }
  }, [partner, give, get, weeks, slots, data.weekPoints, players, mine, values])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const trending = useMemo(() => new Set(data.trending.map((t) => t.player_id)), [data.trending])

  const Chip = ({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-xs tracking-tight ${active ? 'border-stone-900 bg-stone-900 text-stone-100 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900' : 'border-stone-200 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-600'}`}
    >
      <PosPill pos={players[id]?.pos ?? '?'} />
      {players[id]?.name ?? id}
      <span className={active ? 'opacity-70' : 'text-stone-400'}>{fmtSigned(values[id]?.recentWarPerGame, 2)}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      {lineupCheck && (
        <Card title={`Week ${data.projectionWeek} lineup check`} aside="Sleeper projections, league scoring">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Current starters</div>
              <div className="text-lg tabular-nums">{fmt(lineupCheck.current)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Optimal</div>
              <div className="text-lg tabular-nums">{fmt(lineupCheck.best)}</div>
            </div>
            <div className="flex-1 min-w-[240px]">
              {lineupCheck.startThem.length === 0 ? (
                <p className="text-stone-500 dark:text-stone-400">Your lineup already matches the projected optimum.</p>
              ) : (
                <ul className="space-y-1">
                  {lineupCheck.startThem.map((id, i) => (
                    <li key={id}>
                      Start <b>{players[id]?.name}</b> <Muted>({fmt(data.projections?.[id])})</Muted>
                      {lineupCheck.benchThem[i] && (
                        <>
                          {' '}
                          over <b>{players[lineupCheck.benchThem[i]]?.name}</b> <Muted>({fmt(data.projections?.[lineupCheck.benchThem[i]])})</Muted>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Who carries this team" aside="pts/wk lost if removed">
          <Table
            rows={essential}
            columns={[
              { key: 'p', label: 'Player', render: (r) => <PlayerName player={players[r.id]} id={r.id} /> },
              { key: 'lost', label: 'Lost/wk', align: 'right', sort: (r) => r.lost, render: (r) => fmt(r.lost) },
              { key: 'war', label: 'WAR', align: 'right', sort: (r) => values[r.id]?.war ?? -99, render: (r) => fmtSigned(values[r.id]?.war, 2) },
              { key: 'now', label: 'Now', align: 'right', sort: (r) => values[r.id]?.recentWarPerGame ?? -99, render: (r) => fmtSigned(values[r.id]?.recentWarPerGame, 3) },
            ]}
            rowKey={(r) => r.id}
            defaultSort="lost"
          />
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">Players near zero are surplus: the lineup barely changes without them.</p>
        </Card>

        <Card title="Lineup slots vs league" aside="avg pts from optimal lineups">
          <Table
            rows={slotStrength}
            columns={[
              { key: 'slot', label: 'Slot', render: (r) => r.slot },
              { key: 'mine', label: 'You', align: 'right', render: (r) => fmt(r.mine) },
              { key: 'league', label: 'League', align: 'right', render: (r) => fmt(r.league) },
              { key: 'diff', label: 'Diff', align: 'right', sort: (r) => r.mine - r.league, render: (r) => <span className={r.mine - r.league < -1.5 ? 'text-rose-700 dark:text-rose-400' : r.mine - r.league > 1.5 ? 'text-emerald-700 dark:text-emerald-400' : ''}>{fmtSigned(r.mine - r.league)}</span> },
              { key: 'rank', label: 'Rank', align: 'right', sort: (r) => -r.rank, render: (r) => `${r.rank}/${analysis.teams.length}` },
            ]}
            rowKey={(r, ) => r.slot + slotStrength.indexOf(r)}
            empty="No games played yet."
          />
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">Negative diffs are where an upgrade moves the needle most.</p>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Trade targets" aside="biggest lift to your lineup">
          <Table
            rows={targets.trade}
            columns={[
              { key: 'p', label: 'Player', render: (r) => <PlayerName player={players[r.id]} id={r.id} sub={teamById[r.owner!]?.name} /> },
              { key: 'gain', label: 'To you/wk', align: 'right', sort: (r) => r.gain, render: (r) => <span className="text-emerald-700 dark:text-emerald-400">{fmtSigned(r.gain)}</span> },
              { key: 'now', label: 'Now', align: 'right', sort: (r) => values[r.id]?.recentWarPerGame ?? 0, render: (r) => fmtSigned(values[r.id]?.recentWarPerGame, 3) },
              {
                key: 'go',
                label: '',
                render: (r) => (
                  <button
                    className="text-xs underline decoration-stone-400"
                    onClick={() => {
                      setPartnerId(r.owner!)
                      setGet([r.id])
                      setGive([])
                    }}
                  >
                    evaluate
                  </button>
                ),
              },
            ]}
            rowKey={(r) => r.id}
            defaultSort="gain"
            empty="No games played yet."
          />
        </Card>
        <Card title="Waiver targets" aside="free agents">
          <Table
            rows={targets.waiver}
            columns={[
              { key: 'p', label: 'Player', render: (r) => <PlayerName player={players[r.id]} id={r.id} /> },
              { key: 'gain', label: 'To you/wk', align: 'right', sort: (r) => r.gain, render: (r) => <span className={r.gain > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}>{fmtSigned(r.gain)}</span> },
              { key: 'now', label: 'Now', align: 'right', sort: (r) => values[r.id]?.recentWarPerGame ?? 0, render: (r) => fmtSigned(values[r.id]?.recentWarPerGame, 3) },
              { key: 'hot', label: '', render: (r) => (trending.has(r.id) ? <Pill tone="good">trending</Pill> : null) },
            ]}
            rowKey={(r) => r.id}
            defaultSort="gain"
            empty="No games played yet."
          />
        </Card>
      </div>

      <Card title="Trade evaluator" aside="avg change in optimal lineup pts/wk over the value window">
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <span>Partner</span>
          <select value={partnerId ?? ''} onChange={(e) => { setPartnerId(e.target.value ? Number(e.target.value) : null); setGet([]) }} className="rounded border border-stone-200 bg-transparent px-2 py-1 text-sm dark:border-stone-800">
            <option value="">Pick a team</option>
            {analysis.teams.filter((t) => t.rosterId !== myRosterId).map((t) => (
              <option key={t.rosterId} value={t.rosterId}>{t.name}</option>
            ))}
          </select>
          {(give.length || get.length) ? <button className="text-xs underline decoration-stone-400" onClick={() => { setGive([]); setGet([]) }}>clear</button> : null}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">You give</div>
            <div className="flex flex-wrap gap-1.5">
              {mine.filter((id) => players[id]).sort((a, b) => (values[b]?.recentWarPerGame ?? 0) - (values[a]?.recentWarPerGame ?? 0)).map((id) => (
                <Chip key={id} id={id} active={give.includes(id)} onClick={() => toggle(give, setGive, id)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">You get</div>
            <div className="flex flex-wrap gap-1.5">
              {partner ? (
                partner.players.filter((id) => players[id]).sort((a, b) => (values[b]?.recentWarPerGame ?? 0) - (values[a]?.recentWarPerGame ?? 0)).map((id) => (
                  <Chip key={id} id={id} active={get.includes(id)} onClick={() => toggle(get, setGet, id)} />
                ))
              ) : (
                <Muted>Pick a partner.</Muted>
              )}
            </div>
          </div>
        </div>
        {trade && (
          <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded border border-stone-200 dark:border-stone-800 p-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Your lineup</div>
              <div className={`text-2xl tabular-nums ${trade.meDelta.avg > 0 ? 'text-emerald-700 dark:text-emerald-400' : trade.meDelta.avg < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{fmtSigned(trade.meDelta.avg)} <span className="text-sm">pts/wk</span></div>
              <div className="text-xs text-stone-400 dark:text-stone-500">WAR/G in {fmtSigned(trade.warIn, 3)} · out {fmtSigned(trade.warOut, 3)}</div>
            </div>
            <div className="rounded border border-stone-200 dark:border-stone-800 p-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">{partner?.name}</div>
              <div className={`text-2xl tabular-nums ${trade.themDelta.avg > 0 ? 'text-emerald-700 dark:text-emerald-400' : trade.themDelta.avg < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{fmtSigned(trade.themDelta.avg)} <span className="text-sm">pts/wk</span></div>
              <div className="text-xs text-stone-400 dark:text-stone-500">WAR/G in {fmtSigned(trade.warOut, 3)} · out {fmtSigned(trade.warIn, 3)}</div>
            </div>
          </div>
        )}
        {!weeks.length && <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">Needs scoring data. Check back after week 1.</p>}
      </Card>
    </div>
  )
}

export default MyTeamTab
