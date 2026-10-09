import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { SIM } from '../../../lib/fantasy/forecast'
import { opponentsByWeek, RESULTS_PRIOR_GAMES, type PowerWeights } from '../../../lib/fantasy/power'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { DivergingStacks, Legend } from '../charts'
import ModelExplainer, { type RankingModel } from '../ModelExplainer'
import { useFantasy } from '../FantasyContext'
import { sectionCode } from '../Shell'
import { Avatar, Badge, CenterMeter, Meter, Num, PageHeader, Panel, Segmented, Sparkline, N, Stat, StatGrid, Swap, Table, TabSection, Tabs, DeltaChip, usePhone, cx, fmt, fmtSigned, pct, simOdds, type Column } from '../ui'

type Sub = 'rankings' | 'odds' | 'standings' | 'schedule'
const SUBS: Sub[] = ['rankings', 'odds', 'standings', 'schedule']
type RankModel = RankingModel

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
  // Phones stack every section in one scroll, steered by the tab strip.
  const stacked = usePhone()
  const [view, setView] = useState<'table' | 'breakdown'>('table')
  const { models } = useFantasy()
  const forecast = models.forecast
  const [rankModel, setRankModel] = useState<RankModel>(forecast ? 'forecast' : 'composite')
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
  const forecastOrder = useMemo(() => (forecast ? [...forecast.ratings].sort((a, b) => b.rating - a.rating).map((r) => r.rosterId) : []), [forecast])
  const eloOrder = useMemo(() => [...teams].sort((a, b) => (models.elo.final[b.rosterId] ?? 0) - (models.elo.final[a.rosterId] ?? 0)).map((t) => t.rosterId), [teams, models.elo])
  const rankIn = (order: number[], id: number) => order.indexOf(id) + 1
  // Rating bars grow from the league average, so a gap shows at its real size rather than stretched end to end.
  const ratingAvg = forecast ? forecast.ratings.reduce((a, r) => a + r.rating, 0) / (forecast.ratings.length || 1) : 0
  const ratingReach = forecast ? Math.max(15, ...forecast.ratings.map((r) => Math.abs(r.rating - ratingAvg))) : 1

  const forecastColumns: Column<{ rosterId: number }>[] = [
    { key: 'rank', label: '#', sort: (r) => -rankIn(forecastOrder, r.rosterId), render: (r) => <span className="num text-ff-muted">{rankIn(forecastOrder, r.rosterId)}</span> },
    { key: 'team', label: 'Team', sticky: true, sort: (r) => analysis.teamById[r.rosterId].name, render: (r) => <TeamCell analysis={analysis} rosterId={r.rosterId} /> },
    {
      key: 'rating',
      label: 'Rating',
      align: 'right',
      title: 'Expected points per week ahead: projected optimal lineup (injury odds and byes priced in) × efficiency (points per projected point)',
      sort: (r) => forecast!.byId[r.rosterId].rating,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <CenterMeter value={(forecast!.byId[r.rosterId].rating - ratingAvg) / ratingReach} width={48} />
          <span className="w-10 text-ff-text">{fmt(forecast!.byId[r.rosterId].rating)}</span>
        </span>
      ),
    },
    { key: 'proj', label: 'Lineup', align: 'right', title: 'Projected optimal lineup per week, before lineup efficiency', sort: (r) => forecast!.byId[r.rosterId].projected, render: (r) => fmt(forecast!.byId[r.rosterId].projected) },
    { key: 'eff', label: 'Eff', align: 'right', title: 'Points scored per point of projected optimal lineup, shrunk toward the league. Captures lineup calls and how a roster runs against its projections.', sort: (r) => forecast!.byId[r.rosterId].efficiency, render: (r) => pct(forecast!.byId[r.rosterId].efficiency, 1) },
    {
      key: 'form',
      label: 'Form',
      align: 'right',
      hideBelow: 'md',
      title: 'Points per week beyond its own projections, shrunk. Shown, not counted: the backtest finds it adds noise.',
      sort: (r) => forecast!.byId[r.rosterId].form,
      render: (r) => <span className="text-ff-muted">{fmtSigned(forecast!.byId[r.rosterId].form)}</span>,
    },
    {
      key: 'record',
      label: 'W-L',
      align: 'right',
      sort: (r) => seasonById[r.rosterId].wins + seasonById[r.rosterId].ties / 2,
      render: (r) => `${seasonById[r.rosterId].wins}-${seasonById[r.rosterId].losses}`,
    },
    { key: 'xw', label: 'Proj W', align: 'right', hideBelow: 'sm', title: 'Mean simulated wins at season end', sort: (r) => forecast!.sim[r.rosterId].wins, render: (r) => fmt(forecast!.sim[r.rosterId].wins) },
    { key: 'po', label: 'Playoffs', align: 'right', sort: (r) => forecast!.sim[r.rosterId].playoffs, render: (r) => <span className={forecast!.sim[r.rosterId].playoffs >= 0.5 ? 'text-ff-text' : 'text-ff-muted'}>{simOdds(forecast!.sim[r.rosterId], 'playoffs')}</span> },
    { key: 'title', label: 'Title', align: 'right', sort: (r) => forecast!.sim[r.rosterId].title, render: (r) => simOdds(forecast!.sim[r.rosterId], 'title', forecast!.sim[r.rosterId].title < 0.1 ? 1 : 0) },
    { key: 'elo', label: 'Elo', align: 'right', hideBelow: 'xl', sort: (r) => models.elo.final[r.rosterId] ?? 1500, render: (r) => <span className="text-ff-muted">{Math.round(models.elo.final[r.rosterId] ?? 1500)}</span> },
  ]

  const eloColumns: Column<{ rosterId: number }>[] = [
    { key: 'rank', label: '#', sort: (r) => -rankIn(eloOrder, r.rosterId), render: (r) => <span className="num text-ff-muted">{rankIn(eloOrder, r.rosterId)}</span> },
    { key: 'team', label: 'Team', sticky: true, render: (r) => <TeamCell analysis={analysis} rosterId={r.rosterId} /> },
    { key: 'elo', label: 'Elo', align: 'right', sort: (r) => models.elo.final[r.rosterId] ?? 1500, render: (r) => <span className="text-ff-text">{Math.round(models.elo.final[r.rosterId] ?? 1500)}</span> },
    {
      key: 'prior',
      label: 'Preseason',
      align: 'right',
      title: "Last season's closing Elo, regressed a third of the way to 1500 (1500 when there is no last season)",
      sort: (r) => models.eloPrior[r.rosterId] ?? 1500,
      render: (r) => <span className="text-ff-muted">{Math.round(models.eloPrior[r.rosterId] ?? 1500)}</span>,
    },
    { key: 'delta', label: 'Season Δ', align: 'right', sort: (r) => (models.elo.final[r.rosterId] ?? 1500) - (models.eloPrior[r.rosterId] ?? 1500), render: (r) => <Num value={(models.elo.final[r.rosterId] ?? 1500) - (models.eloPrior[r.rosterId] ?? 1500)} signed digits={0} /> },
    { key: 'record', label: 'W-L', align: 'right', render: (r) => `${seasonById[r.rosterId].wins}-${seasonById[r.rosterId].losses}` },
    { key: 'pf', label: 'PF/G', align: 'right', render: (r) => fmt(seasonById[r.rosterId].ppg) },
  ]
  const order = rankModel === 'forecast' ? forecastOrder : rankModel === 'elo' ? eloOrder : analysis.power.map((p) => p.rosterId)
  const standingRank = myRosterId != null ? standings.findIndex((t) => t.rosterId === myRosterId) + 1 : null

  const powerColumns: Column<{ rosterId: number }>[] = [
    { key: 'rank', label: '#', sort: (r) => -powerById[r.rosterId].rank, render: (r) => <span className="num text-ff-muted">{powerById[r.rosterId].rank}</span> },
    { key: 'team', label: 'Team', sticky: true, sort: (r) => analysis.teamById[r.rosterId].name, render: (r) => <TeamCell analysis={analysis} rosterId={r.rosterId} /> },
    {
      key: 'score',
      label: 'Power',
      align: 'right',
      title: 'Chance to beat a league-average team in a given week. 50 is average. Blends all-play record, scoring, recent form, roster strength and lineup efficiency, with results regressed toward average while the sample is small',
      sort: (r) => powerById[r.rosterId].score,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <CenterMeter value={(powerById[r.rosterId].score - 50) / 30} width={48} />
          <span className="w-7 text-ff-text">{fmt(powerById[r.rosterId].score, 0)}</span>
        </span>
      ),
    },
    {
      key: 'margin',
      label: 'vs avg',
      align: 'right',
      hideBelow: 'sm',
      title: 'Points per week above or below a league-average team, after regression',
      sort: (r) => powerById[r.rosterId].margin,
      render: (r) => <Num value={powerById[r.rosterId].margin} signed digits={1} />,
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
        return <Sparkline points={s.weeks.map((w) => w.points)} projected={s.weeks.map((w) => models.expectedPast[r.rosterId]?.[w.week])} labels={s.weeks.map((w) => `Wk ${w.week}`)} width={84} />
      },
    },
  ]

  return (
    <>
      <PageHeader
        code={sectionCode('power')}
        title="Power"
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            stacked={stacked}
            items={[
              { key: 'rankings', label: 'Rankings' },
              ...(forecast ? [{ key: 'odds' as const, label: 'Playoff odds' }] : []),
              { key: 'standings', label: 'Standings' },
              { key: 'schedule', label: 'Remaining schedule' },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        {me && (
          <StatGrid>
            <Stat label="Your rank" value={`#${rankIn(order, myRosterId!)}`} sub={rankModel === 'forecast' ? `rating ${fmt(forecast?.byId[myRosterId!]?.rating)} pts/wk` : rankModel === 'elo' ? `elo ${Math.round(models.elo.final[myRosterId!] ?? 1500)}` : `${fmt(me.power.score, 0)}% vs avg team`} />
            {forecast && (
              <Stat
                label="Playoff odds"
                value={simOdds(forecast.sim[myRosterId!], 'playoffs')}
                meter={forecast.sim[myRosterId!].playoffs}
                sub={`title ${simOdds(forecast.sim[myRosterId!], 'title', 1)} · bye ${simOdds(forecast.sim[myRosterId!], 'bye')}`}
              />
            )}
            <Stat
              label="Standing"
              value={standingRank ? `#${standingRank}` : '–'}
              badge={
                standingRank && playoffTeams
                  ? standingRank <= playoffTeams
                    ? { text: 'in a playoff spot', tone: 'pos' }
                    : { text: `${standingRank - playoffTeams} spot${standingRank - playoffTeams === 1 ? '' : 's'} out`, tone: 'warn' }
                  : undefined
              }
              sub={playoffTeams ? `top ${playoffTeams} make it` : undefined}
            />
            <Stat label="Record" value={`${me.season.wins}-${me.season.losses}${me.season.ties ? `-${me.season.ties}` : ''}`} sub={`all-play ${pct(me.season.allPlayPct)}`} />
            <Stat label="Points per game" value={fmt(me.season.ppg)} delta={<DeltaChip value={me.season.ppg - leagueAvgPpg} title="Against the league average" />} sub={`league ${fmt(leagueAvgPpg)}`} />
            {!forecast && <Stat label="Luck" value={fmtSigned(me.season.luck, 1)} sub="wins above all-play expectation" />}
            <Stat
              label="Schedule ahead"
              value={fmt(me.power.sos, 0)}
              badge={me.power.sos != null && Math.abs(me.power.sos - 50) >= 1 ? { text: me.power.sos > 50 ? 'harder than average' : 'easier than average', tone: me.power.sos > 50 ? 'warn' : 'pos' } : undefined}
              sub="opponents' power, 50 = average"
            />
          </StatGrid>
        )}

        <TabSection id="rankings" label="Rankings" active={tab === 'rankings'} stacked={stacked}>
          <div>
            <Panel
              title={rankModel !== 'composite' ? 'Power rankings' : view === 'table' ? 'Power rankings' : 'Where each score comes from'}
              pad={false}
              actions={
                <>
                  {/* The composite's own picker opens to the left, so the model picker never moves under the pointer. */}
                  <span className={cx('ff-reveal-x', rankModel === 'composite' && 'is-open')} aria-hidden={rankModel !== 'composite'}>
                    <span>
                      <Segmented
                        size="sm"
                        label="Composite view"
                        value={view}
                        onChange={setView}
                        options={[
                          { key: 'table', label: 'Table' },
                          { key: 'breakdown', label: 'Breakdown' },
                        ]}
                      />
                    </span>
                  </span>
                  <Segmented<RankModel>
                    size="sm"
                    label="Ranking model"
                    value={rankModel}
                    onChange={setRankModel}
                    options={[
                      ...(forecast ? [{ key: 'forecast' as const, label: 'Forecast', title: 'Expected points per week: projected lineup × lineup efficiency. Best calibrated in the backtest.' }] : []),
                      { key: 'composite', label: 'Composite', title: 'Weighted z-scores of all-play, scoring, form, roster and efficiency' },
                      { key: 'elo', label: 'Elo', title: 'Results-only Elo with a carried-over prior' },
                    ]}
                  />
                </>
              }
            >
              <Swap k={`${rankModel}-${view}`}>
                {rankModel === 'forecast' && forecast ? (
                  <Table rows={forecastOrder.map((rosterId) => ({ rosterId }))} columns={forecastColumns} rowKey={(r) => r.rosterId} onRowClick={(r) => onTeam(r.rosterId)} rowClass={(r) => (r.rosterId === myRosterId ? 'ff-mine' : '')} />
                ) : rankModel === 'elo' ? (
                  <Table rows={eloOrder.map((rosterId) => ({ rosterId }))} columns={eloColumns} rowKey={(r) => r.rosterId} onRowClick={(r) => onTeam(r.rosterId)} rowClass={(r) => (r.rosterId === myRosterId ? 'ff-mine' : '')} />
                ) : view === 'table' ? (
                  <Table
                    rows={analysis.power.map((p) => ({ rosterId: p.rosterId }))}
                    columns={powerColumns}
                    rowKey={(r) => r.rosterId}
                    onRowClick={(r) => onTeam(r.rosterId)}
                    rowClass={(r) => (r.rosterId === myRosterId ? 'ff-mine' : '')}
                  />
                ) : (
                  <div className="space-y-3 p-3">
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
                      Each bar is a component&apos;s z-score × its weight. Results count <N>{Math.round((played / (played + RESULTS_PRIOR_GAMES)) * 100)}%</N> after <N>{played}</N>{' '}
                      {played === 1 ? 'game' : 'games'}; roster strength counts in full. Right helps, left hurts; <N>50</N> = average. Weights are in Tuning.
                    </p>
                  </div>
                )}
              </Swap>
            </Panel>
            <ModelExplainer model={rankModel === 'forecast' && !forecast ? 'composite' : rankModel} />
          </div>
        </TabSection>

        {forecast && (
          <TabSection id="odds" label="Playoff odds" active={tab === 'odds'} stacked={stacked} bare>
            <OddsGrid onTeam={onTeam} />
          </TabSection>
        )}

        <TabSection id="standings" label="Standings" active={tab === 'standings'} stacked={stacked} bare>
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
        </TabSection>

        <TabSection id="schedule" label="Remaining schedule" active={tab === 'schedule'} stacked={stacked} bare>
          <ScheduleGrid data={data} analysis={analysis} onTeam={onTeam} />
        </TabSection>
      </div>
    </>
  )
}

/** Seed probabilities from the season simulation, one row per team, plus the odds that matter. */
const OddsGrid = ({ onTeam }: { onTeam: (id: number) => void }) => {
  const { models, analysis, data } = useFantasy()
  const f = models.forecast!
  const n = analysis.teams.length
  const cut = Number(data.league.settings?.playoff_teams ?? 0)
  const rows = [...analysis.teams]
    .map((t) => ({ id: t.rosterId, mean: f.sim[t.rosterId].seeds.reduce((a, p, i) => a + p * i, 0) }))
    .sort((a, b) => a.mean - b.mean)
  return (
    <Panel title="Seed distribution" pad={false} actions={<span>{f.sims.toLocaleString()} sims · shade = probability</span>}>
      <div className="ff-scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="ff-label sticky left-0 z-10 h-8 border-b border-ff-line bg-ff-panel px-3 text-left font-normal">team</th>
              {Array.from({ length: n }, (_, i) => (
                <th key={i} className={cx('ff-label h-8 w-11 border-b border-ff-line text-center font-normal', i + 1 === cut && 'border-r border-r-ff-line2')}>
                  {i + 1}
                </th>
              ))}
              {['wins', 'playoffs', 'bye', 'final', 'title'].map((k) => (
                <th key={k} className="ff-label h-8 border-b border-ff-line px-2 text-right font-normal">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id }) => {
              const s = f.sim[id]
              return (
                <tr key={id} onClick={() => onTeam(id)} className="cursor-pointer hover:bg-ff-raised">
                  <td className="sticky left-0 z-[1] h-8 border-b border-ff-line/60 bg-ff-panel px-3">
                    <span className={cx('block max-w-[160px] truncate', id === analysis.myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>{analysis.teamById[id].name}</span>
                  </td>
                  {Array.from({ length: n }, (_, i) => {
                    const p = s.seeds[i + 1] ?? 0
                    return (
                      <td
                        key={i}
                        title={`${analysis.teamById[id].name}: ${pct(p, 1)} to finish ${i + 1}`}
                        className={cx('num h-8 border-b border-ff-line/60 text-center text-[10.5px]', p >= 0.25 ? 'text-ff-panel' : p >= 0.02 ? 'text-ff-text2' : 'text-ff-muted/50', i + 1 === cut && 'border-r border-r-ff-line2')}
                        style={{ background: p > 0.005 ? `rgb(var(--ff-accent) / ${Math.min(0.95, 0.08 + p * 1.6).toFixed(2)})` : undefined }}
                      >
                        {p >= 0.005 ? Math.round(p * 100) : '·'}
                      </td>
                    )
                  })}
                  <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text2">{fmt(s.wins)}</td>
                  <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text">{simOdds(s, 'playoffs')}</td>
                  <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text2">{simOdds(s, 'bye')}</td>
                  <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text2">{simOdds(s, 'final')}</td>
                  <td className="num h-8 border-b border-ff-line/60 px-2 text-right text-ff-text">{simOdds(s, 'title', 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ff-line px-3 py-2 text-[11.5px] leading-snug text-ff-muted">
        Scores ~ <N>N(rating, σ={fmt(f.sigma)})</N> around a season level (<N>τ={fmt(f.tau)}</N>), <N>{Math.round(SIM.persistence * 100)}%</N> of edges persisting, then the bracket. Fitted on{' '}
        <N>148</N> finished leagues. <N>100%</N> and <N>0%</N> only once clinched. The rule after seed <N>{cut}</N> is the playoff line.
      </p>
    </Panel>
  )
}

/** Remaining regular-season opponents, shaded by how strong each one is. */
const ScheduleGrid = ({ data, analysis, onTeam }: { data: LeagueData; analysis: Analysis; onTeam: (id: number) => void }) => {
  const { teams, powerById, myRosterId, teamById } = analysis
  const weeks = data.futureWeeks
  const short = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name)
  const rows = [...teams].sort((a, b) => (powerById[b.rosterId].sos ?? 0) - (powerById[a.rosterId].sos ?? 0))
  const byWeek = useMemo(() => opponentsByWeek(data.matchupsByWeek, weeks), [data.matchupsByWeek, weeks])
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
              const opps = byWeek[t.rosterId] ?? {}
              return (
                <tr key={t.rosterId}>
                  <td className="sticky left-0 z-10 bg-ff-panel px-2 py-1">
                    <button onClick={() => onTeam(t.rosterId)} className={cx('max-w-[140px] truncate text-left hover:underline', t.rosterId === myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>
                      {t.name}
                    </button>
                  </td>
                  <td className="num px-1 text-center text-ff-text">{fmt(powerById[t.rosterId].sos, 0)}</td>
                  {weeks.map((w) => {
                    const opp = opps[w]
                    if (opp == null) return <td key={w} className="h-8 rounded-[1px] bg-ff-sunken text-center text-ff-muted">–</td>
                    const score = powerById[opp]?.score ?? 50
                    return (
                      <td
                        key={w}
                        title={`Week ${w}: ${teamById[opp]?.name} (power ${fmt(score, 0)})`}
                        className={cx('h-8 min-w-[64px] rounded-[1px] px-1 text-center', opp === myRosterId ? 'font-medium text-ff-accent ring-1 ring-inset ring-ff-accent/60' : 'text-ff-text')}
                        // Scores bunch around 50 (a coin flip against an average team), so shade the 35–65 band across the full range.
                        style={{ background: `rgb(var(--ff-accent) / ${(0.06 + Math.max(0, Math.min(1, (score - 35) / 30)) * 0.55).toFixed(2)})` }}
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
        <span className="h-2 w-28 " style={{ background: 'linear-gradient(to right, rgb(var(--ff-accent) / 0.06), rgb(var(--ff-accent) / 0.61))' }} />
        stronger
        <Badge className="ml-2">SOS = average opponent power</Badge>
      </div>
    </Panel>
  )
}

export default PowerView
