import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ProjectionChart } from '../charts'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import ScoutReport from '../ScoutReport'
import { sectionCode } from '../Shell'
import { Avatar, Badge, DeltaChip, Num, PageHeader, Panel, Segmented, Stat, StatGrid, Table, Tabs, cx, fmt, fmtSigned, pct } from '../ui'
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
  const { models } = useFantasy()
  const expected = models.expectedPast[rosterId] ?? {}
  const ahead = models.forecast?.byId[rosterId]?.byWeek ?? {}
  const chartWeeks = [...data.regularWeeks, ...data.futureWeeks.filter((w) => ahead[w] != null)]
  const scored: Record<number, number> = Object.fromEntries(season.weeks.map((w) => [w.week, w.points]))

  // The league's averages, so each figure reads as above or below.
  const league = useMemo(() => {
    const all = analysis.teams.map((t) => seasonById[t.rosterId]).filter((x) => x && x.games > 0)
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    return { ppg: mean(all.map((x) => x.ppg)), eff: mean(all.map((x) => x.efficiency)), lineup: mean(analysis.teams.map((t) => needs[t.rosterId]?.lineup ?? 0).filter((x) => x > 0)) }
  }, [analysis.teams, seasonById, needs])

  return (
    <>
      <PageHeader
        code={sectionCode('teams')}
        mobileTitle
        meta={team.owner && team.owner !== team.name ? `@${team.owner}` : undefined}
        title={
          <span className="inline-flex items-baseline gap-2">
            {team.name}
            {rosterId === myRosterId && <Badge tone="accent">you</Badge>}
          </span>
        }
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
          <Stat label="Power" value={`#${power.rank}`} badge={{ text: `${fmt(power.score, 0)}% vs avg team`, tone: power.score >= 55 ? 'pos' : power.score <= 45 ? 'neg' : 'neutral' }} sub="chance to beat an average team" />
          <Stat label="Record" value={`${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''}`} sub={`all-play ${fmt(season.allPlayWins, 0)}-${fmt(season.allPlayLosses, 0)}`} />
          <Stat label="Points per game" value={fmt(season.ppg)} delta={league.ppg ? <DeltaChip value={season.ppg - league.ppg} title="Against the league average" /> : undefined} sub={`last 3: ${fmt(season.recentPpg)}`} />
          <Stat label="Luck" value={fmtSigned(season.luck, 1)} tone={season.luck >= 0.5 ? 'warn' : undefined} sub="wins vs all-play" />
          <Stat
            label="Lineup efficiency"
            value={pct(season.efficiency)}
            delta={league.eff ? <DeltaChip value={(season.efficiency - league.eff) * 100} digits={0} suffix="pt" title="Against the league average" /> : undefined}
            sub="of optimal points scored"
          />
          <Stat
            label="Projected lineup"
            value={fmt(needs[rosterId]?.lineup)}
            delta={needs[rosterId] && league.lineup ? <DeltaChip value={needs[rosterId].lineup - league.lineup} title="Against the league average" /> : undefined}
            sub={needs[rosterId]?.worstPos ? `thinnest at ${needs[rosterId].worstPos}` : 'pts/wk'}
          />
        </StatGrid>

        <ScoutReport rosterId={rosterId} mine={rosterId === myRosterId} />

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
          <Panel title="Weekly results" pad={false} actions={<span>scored vs projected</span>}>
            {chartWeeks.length > 0 && (
              <div className="border-b border-ff-line px-2 pb-2 pt-3">
                <ProjectionChart weeks={chartWeeks} actual={chartWeeks.map((w) => scored[w] ?? null)} projected={chartWeeks.map((w) => expected[w] ?? ahead[w] ?? null)} />
                <p className="mt-1.5 px-1 text-[11px] leading-snug text-ff-muted">
                  Projected is the best lineup this roster could have started, on Sleeper&apos;s pre-game projections, times the manager&apos;s efficiency. It assumes byes get
                  swapped out, so a week with a bye or empty slot left in the lineup shows as a miss. Dashed weeks are still to come.
                </p>
              </div>
            )}
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
                {
                  key: 'proj',
                  label: 'vs proj',
                  align: 'right',
                  hideBelow: 'sm',
                  title: 'Points scored against the pre-game projection',
                  sort: (w) => (expected[w.week] != null ? w.points - expected[w.week] : -999),
                  render: (w) => (expected[w.week] != null ? <Num value={w.points - expected[w.week]} signed /> : <span className="text-ff-muted">–</span>),
                },
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
