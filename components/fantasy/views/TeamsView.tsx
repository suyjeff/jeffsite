import React, { useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import PlayerName from '../PlayerName'
import { Avatar, Badge, Num, PageHeader, Panel, Segmented, Sparkline, Stat, StatGrid, Table, Tabs, cx, fmt, fmtSigned, pct } from '../ui'
import RosterTable, { type Basis } from './RosterTable'

type Inner = 'roster' | 'results' | 'slots'

const TeamsView = ({ data, analysis, sub, onTeam }: { data: LeagueData; analysis: Analysis; sub: string | null; onTeam: (id: number) => void }) => {
  const { teamById, seasonById, powerById, myRosterId, needs } = analysis
  const requested = sub ? Number(sub) : NaN
  const rosterId = teamById[requested] ? requested : (myRosterId ?? analysis.teams[0].rosterId)
  const team = teamById[rosterId]
  const season = seasonById[rosterId]
  const power = powerById[rosterId]
  const [inner, setInner] = useState<Inner>('roster')
  const [basis, setBasis] = useState<Basis>('ahead')
  const players = data.players

  return (
    <>
      <PageHeader
        code="05"
        title={
          <span className="flex items-center gap-2.5">
            <Avatar src={team.avatar} name={team.name} size={28} />
            {team.name}
            {rosterId === myRosterId && <Badge tone="accent">you</Badge>}
          </span>
        }
        meta={`${team.owner} · ${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''} · power #${power.rank} of ${analysis.teams.length}`}
        tabs={
          <>
            <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-2 md:mx-0 md:px-0">
              {analysis.teams.map((t) => (
                <button
                  key={t.rosterId}
                  onClick={() => onTeam(t.rosterId)}
                  className={cx(
                    'flex shrink-0 items-center gap-1.5  border py-0.5 pl-0.5 pr-2.5 text-[12px] transition-colors',
                    t.rosterId === rosterId ? 'border-ff-accent bg-ff-accent/10 text-ff-text' : 'border-ff-line bg-ff-panel text-ff-text2 hover:border-ff-line2',
                  )}
                >
                  <Avatar src={t.avatar} name={t.name} size={20} />
                  <span className="max-w-[120px] truncate">{t.name}</span>
                </button>
              ))}
            </div>
            <Tabs<Inner>
              value={inner}
              onChange={setInner}
              items={[
                { key: 'roster', label: 'Roster', count: team.players.length },
                { key: 'results', label: 'Results', count: season.weeks.length },
                { key: 'slots', label: 'Lineup slots' },
              ]}
            />
          </>
        }
      />
      <div className="mt-4 space-y-3">
        <StatGrid>
          <Stat label="Power" value={`#${power.rank}`} sub={`score ${fmt(power.score, 0)}`} />
          <Stat label="Record" value={`${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}`} sub={`all-play ${fmt(season.allPlayWins, 0)}-${fmt(season.allPlayLosses, 0)}`} />
          <Stat label="Points per game" value={fmt(season.ppg)} sub={`last 3: ${fmt(season.recentPpg)}`} />
          <Stat label="Luck" value={fmtSigned(season.luck, 1)} sub="wins vs all-play" />
          <Stat label="Lineup efficiency" value={pct(season.efficiency)} sub="of optimal points scored" />
          <Stat label="Projected lineup" value={fmt(needs[rosterId]?.lineup)} sub={needs[rosterId]?.worstPos ? `thinnest at ${needs[rosterId].worstPos}` : 'pts/wk'} />
        </StatGrid>

        {inner === 'roster' && (
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
            <RosterTable data={data} analysis={analysis} rosterId={rosterId} basis={basis} />
          </Panel>
        )}

        {inner === 'results' && (
          <Panel title="Weekly results" pad={false} actions={<Sparkline points={season.weeks.map((w) => w.points)} labels={season.weeks.map((w) => `Wk ${w.week}`)} width={120} />}>
            <Table
              rows={season.weeks}
              rowKey={(w) => w.week}
              defaultSort="week"
              defaultDesc={false}
              empty="No games played yet."
              columns={[
                { key: 'week', label: 'Wk', sort: (w) => w.week, render: (w) => <span className="num text-ff-muted">{w.week}</span> },
                {
                  key: 'res',
                  label: '',
                  render: (w) => <Badge tone={w.result === 'W' ? 'pos' : w.result === 'L' ? 'neg' : 'neutral'}>{w.result ?? '–'}</Badge>,
                },
                { key: 'opp', label: 'Opponent', sticky: true, render: (w) => (w.opponentId != null ? <span className="truncate text-ff-text">{teamById[w.opponentId]?.name}</span> : <span className="text-ff-muted">bye</span>) },
                { key: 'score', label: 'Score', align: 'right', render: (w) => `${fmt(w.points)} – ${fmt(w.opponentPoints)}` },
                { key: 'margin', label: 'Margin', align: 'right', sort: (w) => w.points - (w.opponentPoints ?? 0), render: (w) => <Num value={w.points - (w.opponentPoints ?? 0)} signed /> },
                { key: 'opt', label: 'Optimal', align: 'right', hideBelow: 'sm', title: 'Best lineup that could have been started', render: (w) => fmt(w.optimalPoints) },
                { key: 'left', label: 'Benched', align: 'right', hideBelow: 'sm', title: 'Points left on the bench', render: (w) => <span className={w.optimalPoints - w.points > 10 ? 'text-ff-warn' : ''}>{fmt(w.optimalPoints - w.points)}</span> },
                {
                  key: 'ap',
                  label: 'All-play',
                  align: 'right',
                  hideBelow: 'md',
                  render: (w) => {
                    const others = (analysis.teamWeeks[w.week] ?? []).filter((t) => t.rosterId !== w.rosterId)
                    const wins = others.filter((t) => t.points < w.points).length
                    return `${wins}-${others.length - wins}`
                  },
                },
              ]}
            />
          </Panel>
        )}

        {inner === 'slots' && (
          <Panel title={`Lineup slots · week ${data.horizon[0]?.week ?? ''} starters, horizon averages`} pad={false}>
            <Table
              rows={needs[rosterId]?.slots ?? []}
              rowKey={(s) => s.index}
              columns={[
                { key: 'slot', label: 'Slot', render: (s) => <span className="font-mono text-[11px] text-ff-text2">{s.slot.replace('SUPER_FLEX', 'SF')}</span> },
                { key: 'who', label: 'Starter', sticky: true, render: (s) => (s.starter ? <PlayerName player={players[s.starter]} id={s.starter} size={22} /> : <span className="text-ff-muted">waiver fill</span>) },
                { key: 'pts', label: 'Pts/wk', align: 'right', render: (s) => <span className="text-ff-text">{fmt(s.pts)}</span> },
                { key: 'lg', label: 'League', align: 'right', render: (s) => fmt(s.leagueAvg) },
                { key: 'gap', label: 'Δ', align: 'right', render: (s) => <Num value={s.gap} signed /> },
              ]}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
              <span>An average starter would add, per week:</span>
              {Object.entries(needs[rosterId]?.byPos ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([pos, v]) => (
                  <span key={pos}>
                    <span className="font-mono text-ff-text2">{pos}</span> <span className="num">{fmt(v)}</span>
                  </span>
                ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}

export default TeamsView
