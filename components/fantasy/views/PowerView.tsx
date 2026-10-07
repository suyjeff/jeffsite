import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { PowerWeights } from '../../../lib/fantasy/power'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { DivergingStacks, Legend } from '../charts'
import { Avatar, Badge, Meter, Num, PageHeader, Panel, Segmented, Sparkline, Stat, StatGrid, Table, Tabs, cx, fmt, fmtSigned, pct, type Column } from '../ui'

type Sub = 'rankings' | 'standings' | 'schedule'
const SUBS: Sub[] = ['rankings', 'standings', 'schedule']

export const COMPONENTS: { key: keyof PowerWeights; label: string; slot: string }[] = [
  { key: 'allPlay', label: 'All-play', slot: 's1' },
  { key: 'points', label: 'Scoring', slot: 's2' },
  { key: 'recent', label: 'Recent form', slot: 's3' },
  { key: 'roster', label: 'Roster', slot: 's4' },
  { key: 'efficiency', label: 'Efficiency', slot: 's5' },
]

const TeamCell = ({ analysis, rosterId, sub }: { analysis: Analysis; rosterId: number; sub?: React.ReactNode }) => {
  const t = analysis.teamById[rosterId]
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar src={t.avatar} name={t.name} size={22} />
      <span className="min-w-0 leading-tight">
        <span className={cx('block max-w-[170px] truncate text-[13px]', rosterId === analysis.myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t.name}</span>
        <span className="block max-w-[170px] truncate text-[11px] text-ff-muted">{sub ?? t.owner}</span>
      </span>
    </span>
  )
}

const PowerView = ({
  data,
  analysis,
  sub,
  onSub,
  onTeam,
  weights,
}: {
  data: LeagueData
  analysis: Analysis
  sub: string | null
  onSub: (s: string) => void
  onTeam: (rosterId: number) => void
  weights: PowerWeights
}) => {
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'rankings'
  const [view, setView] = useState<'table' | 'breakdown'>('table')
  const { seasonById, powerById, strength, myRosterId, teams } = analysis
  const played = data.regularWeeks.length
  const maxStrength = Math.max(...Object.values(strength), 0.0001)
  const playoffTeams = Number(data.league.settings?.playoff_teams ?? 0)

  const leagueAvgPpg = useMemo(() => {
    const xs = teams.map((t) => seasonById[t.rosterId]?.ppg ?? 0).filter((x) => x > 0)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  }, [teams, seasonById])

  const standings = useMemo(
    () =>
      [...teams].sort((a, b) => {
        const sa = seasonById[a.rosterId]
        const sb = seasonById[b.rosterId]
        return sb.wins + sb.ties / 2 - (sa.wins + sa.ties / 2) || sb.pf - sa.pf
      }),
    [teams, seasonById],
  )

  const weightSum = COMPONENTS.reduce((a, c) => a + Math.max(0, weights[c.key]), 0) || 1
  const me = myRosterId != null ? { season: seasonById[myRosterId], power: powerById[myRosterId] } : null
  const standingRank = myRosterId != null ? standings.findIndex((t) => t.rosterId === myRosterId) + 1 : null

  const powerColumns: Column<{ rosterId: number }>[] = [
    { key: 'rank', label: '#', sort: (r) => -powerById[r.rosterId].rank, render: (r) => <span className="num text-ff-muted">{powerById[r.rosterId].rank}</span> },
    { key: 'team', label: 'Team', sticky: true, sort: (r) => analysis.teamById[r.rosterId].name, render: (r) => <TeamCell analysis={analysis} rosterId={r.rosterId} /> },
    {
      key: 'score',
      label: 'Power',
      align: 'right',
      title: 'Composite of all-play record, scoring, recent form, roster strength and lineup efficiency, scaled 0–100',
      sort: (r) => powerById[r.rosterId].score,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <Meter value={powerById[r.rosterId].score} max={100} width={56} />
          <span className="w-7 text-ff-text">{fmt(powerById[r.rosterId].score, 0)}</span>
        </span>
      ),
    },
    {
      key: 'record',
      label: 'W-L',
      align: 'right',
      sort: (r) => seasonById[r.rosterId].wins + seasonById[r.rosterId].ties / 2,
      render: (r) => {
        const s = seasonById[r.rosterId]
        return s.games ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : '–'
      },
    },
    { key: 'allplay', label: 'All-play', align: 'right', title: 'Win rate if you played every team every week', sort: (r) => seasonById[r.rosterId].allPlayPct, render: (r) => (seasonById[r.rosterId].games ? pct(seasonById[r.rosterId].allPlayPct) : '–') },
    {
      key: 'luck',
      label: 'Luck',
      align: 'right',
      title: 'Actual wins minus expected wins from all-play',
      sort: (r) => seasonById[r.rosterId].luck,
      render: (r) => (seasonById[r.rosterId].games ? <Num value={seasonById[r.rosterId].luck} signed /> : '–'),
    },
    { key: 'pf', label: 'PF/G', align: 'right', sort: (r) => seasonById[r.rosterId].ppg, render: (r) => fmt(seasonById[r.rosterId].ppg) },
    { key: 'recent', label: 'L3', align: 'right', hideBelow: 'md', title: 'Points per game over the last three weeks', sort: (r) => seasonById[r.rosterId].recentPpg, render: (r) => fmt(seasonById[r.rosterId].recentPpg) },
    {
      key: 'roster',
      label: 'Roster',
      align: 'right',
      hideBelow: 'md',
      title: 'Forward-looking roster strength: recent WAR/game of the optimal lineup plus a discounted bench',
      sort: (r) => strength[r.rosterId],
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <Meter value={strength[r.rosterId]} max={maxStrength} width={40} />
          <span className="w-10">{fmtSigned(strength[r.rosterId], 2)}</span>
        </span>
      ),
    },
    { key: 'eff', label: 'Eff', align: 'right', hideBelow: 'lg', title: 'Points scored as a share of the best possible lineup', sort: (r) => seasonById[r.rosterId].efficiency, render: (r) => pct(seasonById[r.rosterId].efficiency) },
    { key: 'sos', label: 'SOS', align: 'right', hideBelow: 'lg', title: 'Average power score of remaining opponents', sort: (r) => powerById[r.rosterId].sos ?? -1, render: (r) => fmt(powerById[r.rosterId].sos, 0) },
    {
      key: 'spark',
      label: 'Weekly',
      hideBelow: 'sm',
      render: (r) => {
        const s = seasonById[r.rosterId]
        return <Sparkline points={s.weeks.map((w) => w.points)} labels={s.weeks.map((w) => `Wk ${w.week}`)} width={84} />
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Power"
        meta={
          <>
            <span className="num">{played}</span> week{played === 1 ? '' : 's'} played · composite of all-play, scoring, form, roster and efficiency
          </>
        }
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            items={[
              { key: 'rankings', label: 'Rankings' },
              { key: 'standings', label: 'Standings' },
              { key: 'schedule', label: 'Remaining schedule' },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {me && (
          <StatGrid>
            <Stat label="Your power rank" value={`#${me.power.rank}`} sub={`score ${fmt(me.power.score, 0)} of 100`} />
            <Stat label="Standing" value={standingRank ? `#${standingRank}` : '–'} sub={playoffTeams ? `top ${playoffTeams} make the playoffs` : undefined} />
            <Stat label="Record" value={`${me.season.wins}-${me.season.losses}${me.season.ties ? `-${me.season.ties}` : ''}`} sub={`all-play ${pct(me.season.allPlayPct)}`} />
            <Stat label="Points per game" value={fmt(me.season.ppg)} delta={<Num value={me.season.ppg - leagueAvgPpg} signed />} sub="vs league average" />
            <Stat label="Luck" value={fmtSigned(me.season.luck, 1)} sub="wins above all-play expectation" />
            <Stat label="Schedule ahead" value={fmt(me.power.sos, 0)} sub="avg power of remaining opponents" />
          </StatGrid>
        )}

        {tab === 'rankings' && (
          <Panel
            title={view === 'table' ? 'Power rankings' : 'Where each score comes from'}
            pad={view === 'breakdown'}
            actions={
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { key: 'table', label: 'Table' },
                  { key: 'breakdown', label: 'Breakdown' },
                ]}
              />
            }
          >
            {view === 'table' ? (
              <Table
                rows={analysis.power.map((p) => ({ rosterId: p.rosterId }))}
                columns={powerColumns}
                rowKey={(r) => r.rosterId}
                onRowClick={(r) => onTeam(r.rosterId)}
                rowClass={(r) => (r.rosterId === myRosterId ? 'ff-mine' : '')}
              />
            ) : (
              <div className="space-y-3">
                <Legend items={COMPONENTS.map((c) => ({ label: c.label, slot: c.slot, value: `${Math.round((Math.max(0, weights[c.key]) / weightSum) * 100)}%` }))} />
                <DivergingStacks
                  parts={COMPONENTS}
                  rows={analysis.power.map((p) => ({
                    key: p.rosterId,
                    label: (
                      <span className={p.rosterId === myRosterId ? 'font-medium text-ff-accent' : ''}>
                        <span className="num mr-1.5 text-ff-muted">{p.rank}</span>
                        {analysis.teamById[p.rosterId].name}
                      </span>
                    ),
                    values: COMPONENTS.map((c) => (p.components[c.key] * Math.max(0, weights[c.key])) / weightSum),
                    total: p.score,
                  }))}
                  label={(score) => fmt(score, 0)}
                />
                <p className="text-[11.5px] text-ff-muted">
                  Each component is a z-score across the league times its weight; right of the line helps, left hurts. The number is the final 0–100 score. Weights live in Model.
                </p>
              </div>
            )}
          </Panel>
        )}

        {tab === 'standings' && (
          <Panel title="Standings" pad={false} actions={playoffTeams ? <span>playoff line after #{playoffTeams}</span> : null}>
            <Table
              rows={standings.map((t, i) => ({ rosterId: t.rosterId, seed: i + 1 }))}
              rowKey={(r) => r.rosterId}
              onRowClick={(r) => onTeam(r.rosterId)}
              rowClass={(r) => cx(r.rosterId === myRosterId && 'ff-mine', r.seed === playoffTeams && '[&>td]:border-b-2 [&>td]:border-b-ff-accent/50')}
              columns={[
                { key: 'seed', label: '#', render: (r) => <span className="num text-ff-muted">{r.seed}</span> },
                { key: 'team', label: 'Team', sticky: true, render: (r) => <TeamCell analysis={analysis} rosterId={r.rosterId} /> },
                {
                  key: 'wl',
                  label: 'W-L',
                  align: 'right',
                  render: (r) => {
                    const s = seasonById[r.rosterId]
                    return `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`
                  },
                },
                { key: 'pf', label: 'PF', align: 'right', render: (r) => fmt(seasonById[r.rosterId].pf, 1) },
                { key: 'pa', label: 'PA', align: 'right', render: (r) => fmt(seasonById[r.rosterId].pa, 1) },
                {
                  key: 'ap',
                  label: 'All-play',
                  align: 'right',
                  render: (r) => `${fmt(seasonById[r.rosterId].allPlayWins, 0)}-${fmt(seasonById[r.rosterId].allPlayLosses, 0)}`,
                },
                { key: 'xw', label: 'xW', align: 'right', title: 'Expected wins from all-play', render: (r) => fmt(seasonById[r.rosterId].expectedWins, 1) },
                { key: 'luck', label: 'Luck', align: 'right', render: (r) => <Num value={seasonById[r.rosterId].luck} signed /> },
                { key: 'streak', label: 'Strk', align: 'right', render: (r) => seasonById[r.rosterId].streak || '–' },
                { key: 'power', label: 'Power', align: 'right', hideBelow: 'sm', render: (r) => <span className="text-ff-muted">#{powerById[r.rosterId].rank}</span> },
              ]}
            />
          </Panel>
        )}

        {tab === 'schedule' && <ScheduleGrid data={data} analysis={analysis} onTeam={onTeam} />}
      </div>
    </>
  )
}

/** Remaining regular-season opponents, shaded by how strong each one is. */
const ScheduleGrid = ({ data, analysis, onTeam }: { data: LeagueData; analysis: Analysis; onTeam: (id: number) => void }) => {
  const { teams, powerById, seasonById, myRosterId, teamById } = analysis
  const weeks = data.futureWeeks
  const short = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name)
  const rows = [...teams].sort((a, b) => (powerById[b.rosterId].sos ?? 0) - (powerById[a.rosterId].sos ?? 0))
  if (!weeks.length) return <Panel title="Remaining schedule">No regular-season weeks left.</Panel>
  return (
    <Panel title="Remaining schedule · hardest first" pad={false} actions={<span>shade = opponent power</span>}>
      <div className="ff-scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-[11.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-ff-panel px-2 py-1.5 text-left font-mono text-[10.5px] font-normal uppercase tracking-wider text-ff-muted">Team</th>
              <th className="px-1 font-mono text-[10.5px] font-normal uppercase tracking-wider text-ff-muted">SOS</th>
              {weeks.map((w) => (
                <th key={w} className="px-1 font-mono text-[10.5px] font-normal text-ff-muted">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const opps = seasonById[t.rosterId]?.remainingOpponents ?? []
              return (
                <tr key={t.rosterId}>
                  <td className="sticky left-0 z-10 bg-ff-panel px-2 py-1">
                    <button onClick={() => onTeam(t.rosterId)} className={cx('max-w-[140px] truncate text-left hover:underline', t.rosterId === myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>
                      {t.name}
                    </button>
                  </td>
                  <td className="num px-1 text-center text-ff-text">{fmt(powerById[t.rosterId].sos, 0)}</td>
                  {weeks.map((w, i) => {
                    const opp = opps[i]
                    if (opp == null) return <td key={w} className="h-8 rounded-[4px] bg-ff-sunken text-center text-ff-muted">–</td>
                    const score = powerById[opp]?.score ?? 50
                    return (
                      <td
                        key={w}
                        title={`Week ${w}: ${teamById[opp]?.name} (power ${fmt(score, 0)})`}
                        className={cx('h-8 min-w-[64px] rounded-[4px] px-1 text-center', opp === myRosterId ? 'font-medium text-ff-accent ring-1 ring-inset ring-ff-accent/60' : 'text-ff-text')}
                        style={{ background: `rgb(var(--ff-accent) / ${(0.06 + (score / 100) * 0.55).toFixed(2)})` }}
                      >
                        {short(teamById[opp]?.name ?? '?')}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-ff-line px-3 py-2 text-[11px] text-ff-muted">
        weaker
        <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(to right, rgb(var(--ff-accent) / 0.06), rgb(var(--ff-accent) / 0.61))' }} />
        stronger
        <Badge className="ml-2">SOS = average opponent power</Badge>
      </div>
    </Panel>
  )
}

export default PowerView
