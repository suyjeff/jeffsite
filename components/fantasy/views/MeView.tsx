import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { optimalLineup, type LineupPlayer } from '../../../lib/fantasy/lineup'
import { availabilityDrag } from '../../../lib/fantasy/scout'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes } from '../ContextNotes'
import PlayerName from '../PlayerName'
import ScoutReport from '../ScoutReport'
import { sectionCode } from '../Shell'
import { Badge, Button, DeltaChip, Empty, Num, PageHeader, Panel, Segmented, Stat, StatGrid, Table, Tabs, ago, cx, fmt, fmtSigned, pct } from '../ui'
import RosterTable, { type Basis } from './RosterTable'

type Sub = 'overview' | 'roster'
const SUBS: Sub[] = ['overview', 'roster']

const MeView = ({
  data,
  analysis,
  sub,
  onSub,
  onTeam,
}: {
  data: LeagueData
  analysis: Analysis
  sub: string | null
  onSub: (s: string) => void
  onTeam: (id: number) => void
}) => {
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'overview'
  const [basis, setBasis] = useState<Basis>('ahead')
  const [slotBasis, setSlotBasis] = useState<Basis>('ahead')
  const { myRosterId, teamById, needs, slots } = analysis
  const players = data.players
  const me = myRosterId != null ? teamById[myRosterId] : null

  // ---- This week's lineup against Sleeper's projections ----
  const lineupCheck = useMemo(() => {
    if (!me || !data.projections) return null
    const proj = data.projections
    const toLP = (ids: string[]): LineupPlayer[] => ids.filter((id) => players[id]).map((id) => ({ id, fpos: players[id].fpos, pts: proj[id] ?? 0 }))
    const starters = (me.roster.starters ?? []).filter((s) => s && s !== '0')
    const current = starters.reduce((a, id) => a + (proj[id] ?? 0), 0)
    const best = optimalLineup(slots, toLP(me.players))
    const bestIds = new Set(best.assignments.filter(Boolean).map((p) => p!.id))
    const starterSet = new Set(starters)
    return {
      current,
      best: best.total,
      bench: starters.filter((id) => !bestIds.has(id)),
      start: [...bestIds].filter((id) => !starterSet.has(id)),
      assignments: best.assignments,
    }
  }, [me, data.projections, players, slots])

  // ---- Fresh news: players on your roster Sleeper flagged in the day before the player file was pulled ----
  // The file refreshes once a day (Sleeper asks for no more), so the window is anchored to it rather than to now.
  const newsAsOf = useMemo(() => Object.values(players).reduce((a, p) => Math.max(a, p.newsAt ?? 0), 0), [players])
  const fresh = useMemo(() => {
    if (!me || !newsAsOf) return []
    const cutoff = newsAsOf - 24 * 3600_000
    return me.players.filter((id) => (players[id]?.newsAt ?? 0) > cutoff).sort((a, b) => (players[b].newsAt ?? 0) - (players[a].newsAt ?? 0))
  }, [me, players, newsAsOf])

  // ---- Headline numbers ----
  const kpis = useMemo(() => {
    if (!me || !data.horizon.length) return null
    const lineups = analysis.teams.map((t) => needs[t.rosterId]?.lineup ?? 0).sort((a, b) => b - a)
    const mine = needs[me.rosterId]?.lineup ?? 0
    const avg = lineups.reduce((a, b) => a + b, 0) / (lineups.length || 1)
    const hole = needs[me.rosterId]?.worstPos
    return { mine, rank: lineups.indexOf(mine) + 1, avg, drag: -availabilityDrag(data, analysis, me.players), hole, holePts: hole ? needs[me.rosterId].byPos[hole] : 0 }
  }, [me, data, analysis, needs])

  // ---- Slots: ahead (horizon) or to date (results) ----
  const slotRows = useMemo(() => {
    if (!me) return []
    if (slotBasis === 'ahead') {
      return (needs[me.rosterId]?.slots ?? []).map((s) => {
        const all = analysis.teams.map((t) => needs[t.rosterId]?.slots[s.index]?.pts ?? 0).sort((a, b) => b - a)
        return { key: String(s.index), slot: s.slot, starter: s.starter, mine: s.pts, league: s.leagueAvg, rank: all.findIndex((v) => v <= s.pts) + 1 }
      })
    }
    const weeks = data.valueWeeks
    if (!weeks.length) return []
    const perTeam = analysis.teams.map((t) => {
      const sums = slots.map(() => 0)
      for (const w of weeks) {
        const pts = data.weekPoints[w] ?? {}
        optimalLineup(slots, t.players.filter((id) => players[id]).map((id) => ({ id, fpos: players[id].fpos, pts: pts[id] ?? 0 }))).assignments.forEach((p, i) => (sums[i] += p?.pts ?? 0))
      }
      return { rosterId: t.rosterId, avg: sums.map((x) => x / weeks.length) }
    })
    const mineRow = perTeam.find((t) => t.rosterId === me.rosterId)!
    return slots.map((slot, i) => {
      const all = perTeam.map((t) => t.avg[i]).sort((a, b) => b - a)
      return { key: String(i), slot: slot.name, starter: null as string | null, mine: mineRow.avg[i], league: all.reduce((a, b) => a + b, 0) / all.length, rank: all.findIndex((v) => v <= mineRow.avg[i]) + 1 }
    })
  }, [me, slotBasis, needs, analysis.teams, data.valueWeeks, data.weekPoints, slots, players])


  if (!me) {
    return (
      <>
        <PageHeader code={sectionCode('me')} title="My team" />
        <div className="mt-4">
          <Empty title="No roster of yours in this league">Pick a league you are in from the menu.</Empty>
        </div>
      </>
    )
  }
  const season = analysis.seasonById[me.rosterId]

  return (
    <>
      <PageHeader
        code={sectionCode('me')}
        title={me.name}
        actions={
          <Button size="sm" variant="ghost" onClick={() => onTeam(me.rosterId)} title="The same team as the league sees it">
            Team page →
          </Button>
        }
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            items={[
              { key: 'overview', label: 'Overview' },
              { key: 'roster', label: 'Roster', count: me.players.length },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {tab === 'overview' && (
          <>
            {kpis && (
              <StatGrid>
                <Stat
                  label="Projected lineup"
                  value={fmt(kpis.mine)}
                  delta={<DeltaChip value={kpis.mine - kpis.avg} title="Against the league's average lineup" />}
                  badge={{ text: `#${kpis.rank} of ${analysis.teams.length}`, tone: kpis.rank <= Math.ceil(analysis.teams.length / 3) ? 'pos' : kpis.rank > analysis.teams.length - Math.ceil(analysis.teams.length / 3) ? 'neg' : 'neutral' }}
                  sub={`pts/wk · league ${fmt(kpis.avg)}`}
                />
                <Stat label="Injury drag" value={fmtSigned(-kpis.drag, 1)} tone={kpis.drag > 1.5 ? 'neg' : undefined} sub="pts/wk to expected absences, net" />
                <Stat label="Biggest hole" value={kpis.hole ?? '–'} tone={kpis.hole ? 'warn' : undefined} sub={kpis.hole ? `an average starter adds ${fmt(kpis.holePts)}/wk` : undefined} />
                <Stat
                  label="All-play"
                  value={pct(season.allPlayPct)}
                  meter={season.allPlayPct}
                  badge={Math.abs(season.luck) >= 0.5 ? { text: `${season.luck > 0 ? 'lucky' : 'unlucky'} ${fmtSigned(season.luck, 1)} W`, tone: season.luck > 0 ? 'warn' : 'neutral' } : undefined}
                  sub="win rate against every team, every week"
                />
                {lineupCheck ? (
                  <Stat
                    label={`Week ${data.projectionWeek} optimal`}
                    value={fmt(lineupCheck.best)}
                    delta={<DeltaChip value={lineupCheck.best - lineupCheck.current} title="Against the lineup you have set" />}
                    badge={lineupCheck.start.length ? { text: `${lineupCheck.start.length} swap${lineupCheck.start.length === 1 ? '' : 's'} to make`, tone: 'warn' } : { text: 'lineup is optimal', tone: 'pos' }}
                    sub="vs your set lineup"
                  />
                ) : (
                  <Stat label="Points per game" value={fmt(season.ppg)} />
                )}
              </StatGrid>
            )}

            <ScoutReport rosterId={me.rosterId} mine />

            {fresh.length > 0 && (
              <Panel title="Recent news on your roster" actions={<span>player file {ago(newsAsOf)} old</span>} pad={false}>
                {fresh.map((id) => (
                  <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ff-line/60 px-3 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <PlayerName player={players[id]} id={id} size={22} sub={`news ${ago(players[id].newsAt!)} ago`} />
                    </span>
                    <ContextNotes context={data.context[id]} players={players} max={2} />
                  </div>
                ))}
                <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
                  News in the day before Sleeper&apos;s player file was pulled; the file refreshes once a day, so later stories show up tomorrow. Sleeper flags that a player has news but
                  not what it says: read it in the Sleeper app, and if it changes your view, set your read on him from Players or the dashboard player card.
                </p>
              </Panel>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              {lineupCheck && (
                <Panel title={`Week ${data.projectionWeek} lineup`} actions={<span>Sleeper projections</span>} pad={false}>
                  {lineupCheck.start.length === 0 ? (
                    <div className="flex items-center gap-2 border-b border-ff-line px-3 py-2 text-[12.5px] text-ff-pos">
                      <span className="h-1.5 w-1.5  bg-ff-pos" />
                      Your lineup matches the projected optimum.
                    </div>
                  ) : (
                    <div className="space-y-1 border-b border-ff-line px-3 py-2">
                      {lineupCheck.start.map((id, i) => (
                        <div key={id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                          <Badge tone="warn">swap</Badge>
                          <span className="whitespace-nowrap text-ff-text">
                            Start {players[id]?.name} <span className="num text-ff-muted">{fmt(data.projections?.[id])}</span>
                          </span>
                          {lineupCheck.bench[i] && (
                            <span className="whitespace-nowrap text-ff-text">
                              <span className="text-ff-muted">over</span> {players[lineupCheck.bench[i]]?.name} <span className="num text-ff-muted">{fmt(data.projections?.[lineupCheck.bench[i]])}</span>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <Table
                    dense
                    rows={slots.map((s, i) => ({ i, slot: s.name, p: lineupCheck.assignments[i] }))}
                    rowKey={(r) => r.i}
                    columns={[
                      { key: 'slot', label: 'Slot', render: (r) => <span className="font-mono text-[11px] text-ff-text2">{r.slot.replace('SUPER_FLEX', 'SF')}</span> },
                      { key: 'p', label: 'Optimal', render: (r) => (r.p ? <PlayerName player={players[r.p.id]} id={r.p.id} size={22} /> : <span className="text-ff-muted">empty</span>) },
                      { key: 'pts', label: 'Proj', align: 'right', render: (r) => fmt(r.p?.pts) },
                      { key: 'ctx', label: '', hideBelow: 'sm', render: (r) => (r.p ? <ContextNotes context={data.context[r.p.id]} players={players} max={1} /> : null) },
                    ]}
                  />
                </Panel>
              )}

              <Panel
                title="Slots vs league"
                pad={false}
                actions={
                  <Segmented
                    size="sm"
                    value={slotBasis}
                    onChange={setSlotBasis}
                    options={[
                      { key: 'ahead', label: 'Ahead' },
                      { key: 'todate', label: 'To date' },
                    ]}
                  />
                }
              >
                <Table
                  dense
                  rows={slotRows}
                  rowKey={(r) => r.key}
                  empty="No games played yet."
                  columns={[
                    { key: 'slot', label: 'Slot', render: (r) => <span className="font-mono text-[11px] text-ff-text2">{r.slot.replace('SUPER_FLEX', 'SF')}</span> },
                    ...(slotBasis === 'ahead'
                      ? [{ key: 'who', label: `Wk ${data.horizon[0]?.week ?? ''}`, render: (r: (typeof slotRows)[number]) => (r.starter ? <PlayerName player={players[r.starter]} id={r.starter} size={22} /> : <span className="text-ff-muted">waiver fill</span>) }]
                      : []),
                    { key: 'mine', label: 'You', align: 'right', render: (r) => <span className="text-ff-text">{fmt(r.mine)}</span> },
                    { key: 'lg', label: 'League', align: 'right', hideBelow: 'sm', render: (r) => fmt(r.league) },
                    { key: 'gap', label: 'Δ', align: 'right', sort: (r) => r.mine - r.league, render: (r) => <Num value={r.mine - r.league} signed /> },
                    { key: 'rank', label: 'Rank', align: 'right', hideBelow: 'sm', sort: (r) => -r.rank, render: (r) => <span className={cx(r.rank <= 3 ? 'text-ff-pos' : r.rank > analysis.teams.length - 3 ? 'text-ff-neg' : 'text-ff-text2')}>{r.rank}/{analysis.teams.length}</span> },
                  ]}
                />
                <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
                  {slotBasis === 'ahead' ? 'Points per week each slot is expected to produce over the horizon, against the league average.' : 'Average points each slot of your best possible lineup produced in weeks played.'}
                </p>
              </Panel>
            </div>
          </>
        )}

        {tab === 'roster' && (
          <Panel
            title="Roster"
            pad={false}
            actions={
              <Segmented
                size="sm"
                value={basis}
                onChange={setBasis}
                options={[
                  { key: 'ahead', label: 'Rest of season' },
                  { key: 'todate', label: 'Season to date' },
                ]}
              />
            }
          >
            <RosterTable data={data} analysis={analysis} rosterId={me.rosterId} basis={basis} />
          </Panel>
        )}

      </div>
    </>
  )
}

export default MeView
