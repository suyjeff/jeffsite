import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ProjectionChart } from '../charts'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import FreeAgentPick from '../FreeAgentPick'
import ScoutReport, { scoutPlayers, useScout } from '../ScoutReport'
import MovesPanel from '../Moves'
import TeamName from '../TeamName'
import type { TeamInfo } from '../../../lib/fantasy/analysis'
import {
  Avatar,
  Badge,
  DeltaChip,
  Dropdown,
  Meter,
  Num,
  PageHeader,
  Panel,
  Segmented,
  Stat,
  StatGrid,
  Swap,
  Table,
  TabSection,
  type PageChange,
  Tabs,
  cx,
  usePhone,
  fmt,
  fmtSigned,
  pct,
  simOdds,
  type Column,
} from '../ui'
import { Disclosure } from '../Disclosure'
import RosterTable, { type Basis } from './RosterTable'

// Phones get a page per section, so the team's summary (figures, moves, scout) is a page of its own there.
// Wide screens show it above the tabs, and a link to the phone-only page lands on the roster.
type Inner = 'overview' | 'roster' | 'results' | 'slots'
const INNERS: Inner[] = ['overview', 'roster', 'results', 'slots']

type TeamsProps = { data: LeagueData; analysis: Analysis; sub: string | null; page: string | null; onPage: PageChange; onTeam: (id: number | null) => void }

const TeamsView = ({ data, analysis, sub, page, onPage, onTeam }: TeamsProps) => {
  const requested = sub ? Number(sub) : NaN
  // No team named: the whole league at a glance, each row opening a summary sheet.
  if (!analysis.teamById[requested]) return <TeamsIndex data={data} analysis={analysis} onTeam={onTeam} />
  return <TeamPage data={data} analysis={analysis} rosterId={requested} page={page} onPage={onPage} onTeam={onTeam} />
}

/** Every team in one dense table: standing, form, what each projects, and where each is thin. */
const TeamsIndex = ({ data, analysis, onTeam }: { data: LeagueData; analysis: Analysis; onTeam: (id: number | null) => void }) => {
  const { models, openTeam } = useFantasy()
  const { seasonById, powerById, myRosterId, needs } = analysis
  const sim = models.forecast?.sim
  const next = models.forecast?.nextWeek ?? []
  const leagueLineup = useMemo(() => {
    const xs = analysis.teams.map((t) => needs[t.rosterId]?.lineup ?? 0).filter((x) => x > 0)
    return xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  }, [analysis.teams, needs])
  const rows = useMemo(() => [...analysis.teams].sort((a, b) => (powerById[a.rosterId]?.rank ?? 99) - (powerById[b.rosterId]?.rank ?? 99)), [analysis.teams, powerById])
  const game = (rid: number) => next.find((g) => g.a === rid || g.b === rid)

  const columns: Column<TeamInfo>[] = [
    { key: 'rank', label: '#', title: 'Power rank', sort: (t) => -(powerById[t.rosterId]?.rank ?? 99), render: (t) => <span className="num text-ff-muted">{powerById[t.rosterId]?.rank ?? '–'}</span> },
    {
      key: 'team',
      label: 'Team',
      sticky: true,
      render: (t) => (
        <span className="flex max-w-[240px] items-center gap-1.5">
          <TeamName id={t.rosterId} size={24} sub={t.owner && t.owner !== t.name ? `@${t.owner}` : undefined} className="text-[13px]" />
          {t.rosterId === myRosterId && <Badge tone="accent">you</Badge>}
        </span>
      ),
    },
    {
      key: 'rec',
      label: 'Record',
      sort: (t) => (seasonById[t.rosterId]?.wins ?? 0) + (seasonById[t.rosterId]?.ppg ?? 0) / 1000,
      render: (t) => {
        const s = seasonById[t.rosterId]
        return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : '–'
      },
    },
    {
      key: 'form',
      label: 'Last 5',
      hideBelow: 'md',
      render: (t) => (
        <span className="flex gap-0.5" role="img" aria-label={(seasonById[t.rosterId]?.weeks ?? []).slice(-5).map((w) => w.result ?? '–').join(' ')}>
          {(seasonById[t.rosterId]?.weeks ?? []).slice(-5).map((w) => (
            <span
              key={w.week}
              aria-hidden
              title={`Week ${w.week}: ${w.result ?? '–'} ${fmt(w.points)}–${fmt(w.opponentPoints)}`}
              className={cx('flex h-4 w-4 items-center justify-center font-mono text-[9px] font-medium', w.result === 'W' ? 'bg-ff-pos/15 text-ff-pos' : w.result === 'L' ? 'bg-ff-neg/10 text-ff-neg' : 'bg-ff-sunken text-ff-muted')}
            >
              {w.result ?? '–'}
            </span>
          ))}
        </span>
      ),
    },
    { key: 'ppg', label: 'Pts/g', align: 'right', sort: (t) => seasonById[t.rosterId]?.ppg ?? 0, render: (t) => fmt(seasonById[t.rosterId]?.ppg) },
    {
      key: 'power',
      label: 'Power',
      align: 'right',
      hideBelow: 'sm',
      title: 'Chance to beat an average team',
      sort: (t) => powerById[t.rosterId]?.score ?? 0,
      render: (t) => <span>{fmt(powerById[t.rosterId]?.score, 0)}%</span>,
    },
    ...(sim
      ? [
          {
            key: 'odds',
            label: 'Playoffs',
            align: 'right' as const,
            sort: (t: TeamInfo) => sim[t.rosterId]?.playoffs ?? 0,
            render: (t: TeamInfo) => (
              <span className="inline-flex items-center gap-2">
                <Meter value={sim[t.rosterId]?.playoffs ?? 0} max={1} width={40} thin className="hidden lg:inline-block" />
                <span className="w-9 text-right text-ff-text">{simOdds(sim[t.rosterId], 'playoffs')}</span>
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'lineup',
      label: 'Lineup',
      align: 'right',
      hideBelow: 'md',
      title: 'Best lineup, points per week ahead, against the league average',
      sort: (t) => needs[t.rosterId]?.lineup ?? 0,
      render: (t) => (
        <span className="inline-flex items-baseline gap-1.5">
          {fmt(needs[t.rosterId]?.lineup)}
          <Num value={(needs[t.rosterId]?.lineup ?? 0) - leagueLineup} signed className="w-9 text-right text-[11px]" />
        </span>
      ),
    },
    { key: 'need', label: 'Need', hideBelow: 'lg', title: 'Thinnest position', render: (t) => <span className="font-mono text-[11px] text-ff-warn">{needs[t.rosterId]?.worstPos ?? '–'}</span> },
    {
      key: 'next',
      label: next[0] ? `Wk ${next[0].week}` : 'Next',
      hideBelow: 'lg',
      title: 'Next opponent, and the win odds against them',
      render: (t) => {
        const g = game(t.rosterId)
        if (!g) return <span className="text-ff-muted">–</span>
        const opp = g.a === t.rosterId ? g.b : g.a
        const p = g.a === t.rosterId ? g.pA : 1 - g.pA
        return (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
            <span className="text-ff-muted">vs</span>
            <span className="flex max-w-[130px]">
              <TeamName id={opp} avatar={false} />
            </span>
            <span className={cx('num', p >= 0.6 ? 'text-ff-pos' : p <= 0.4 ? 'text-ff-neg' : 'text-ff-text2')}>{pct(p)}</span>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader title="Teams" meta={`${analysis.teams.length} teams${next[0] ? ` · wk ${next[0].week}` : ''}`} />
      <div className="mt-4 space-y-3">
        <Panel title="League" pad={false} actions={<span>by power · <span className="max-md:hidden">click</span><span className="md:hidden">tap</span> a team for its summary</span>}>
          <Table rows={rows} rowKey={(t) => t.rosterId} columns={columns} dense onRowClick={(t) => openTeam(t.rosterId)} rowClass={(t) => (t.rosterId === myRosterId ? 'ff-mine' : '')} />
        </Panel>
        <p className="text-[11.5px] text-ff-muted">
          <span className="hidden md:inline">Power: chance to beat an average team. Lineup: the best lineup&apos;s points per week ahead, against the league average. </span>
          {myRosterId != null && (
            <button type="button" onClick={() => onTeam(myRosterId)} className="ff-hit text-ff-text2 underline-offset-2 hover:underline">
              Your team page →
            </button>
          )}
        </p>
      </div>
    </>
  )
}

/** One team in full: roster, results and lineup slots, with a switcher to move between teams. */
const TeamPage = ({ data, analysis, rosterId, page, onPage, onTeam }: Omit<TeamsProps, 'sub'> & { rosterId: number }) => {
  const { teamById, seasonById, powerById, myRosterId, needs } = analysis
  const team = teamById[rosterId]
  const season = seasonById[rosterId]
  const power = powerById[rosterId]
  // The page within the team lives in the route after the team (#teams/3/results). Null: the default for the screen.
  const inner = INNERS.find((k) => k === page) ?? null
  const stacked = usePhone()
  const tab: Inner = stacked ? inner ?? 'overview' : !inner || inner === 'overview' ? 'roster' : inner
  const [basis, setBasis] = useState<Basis>('ahead')
  // The players the scouting line is built on, marked where they stand in the roster.
  const scout = useScout(rosterId)
  const scouted = useMemo(() => scoutPlayers(scout), [scout])
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

  // Teams in power order, for the switcher and prev/next.
  const order = [...analysis.teams].sort((a, b) => (powerById[a.rosterId]?.rank ?? 99) - (powerById[b.rosterId]?.rank ?? 99))
  const at = order.findIndex((t) => t.rosterId === rosterId)
  const step = (d: number) => onTeam(order[(at + d + order.length) % order.length].rosterId)
  // In the header on wide screens; on phones its own full-width row above the page, where the top bar names the section.
  const switcher = (
    <div className="flex w-full items-center gap-1 md:w-auto">
      <button type="button" onClick={() => onTeam(null)} className="h-7 shrink-0 px-2 font-mono text-[11px] text-ff-text2 hover:bg-ff-raised hover:text-ff-text">
        ← All teams
      </button>
      <span className="flex min-w-0 flex-1 items-stretch border border-ff-line bg-ff-panel md:flex-none">
        <button type="button" onClick={() => step(-1)} aria-label="Previous team" className="h-7 w-7 border-r border-ff-line font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text">
          ‹
        </button>
        <Dropdown
          label="Team"
          className="min-w-0 flex-1"
          value={String(rosterId)}
          onChange={(v) => onTeam(Number(v))}
          options={order.map((t) => ({ value: String(t.rosterId), label: t.name, text: t.name, sub: `#${powerById[t.rosterId]?.rank ?? '–'} · ${seasonById[t.rosterId]?.wins ?? 0}-${seasonById[t.rosterId]?.losses ?? 0}` }))}
          menuClassName="!right-0 !left-auto w-[240px]"
          renderButton={(cur, open) => (
            <span className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-[12px] text-ff-text hover:bg-ff-raised md:w-[190px]">
              <span className="min-w-0 flex-1 truncate">{cur?.label}</span>
              <span aria-hidden className="font-mono text-[10px] text-ff-muted">
                {open ? '▴' : '▾'}
              </span>
            </span>
          )}
        />
        <button type="button" onClick={() => step(1)} aria-label="Next team" className="h-7 w-7 border-l border-ff-line font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text">
          ›
        </button>
      </span>
    </div>
  )

  return (
    <>
      <PageHeader
        mobileTitle
        meta={team.owner && team.owner !== team.name ? `@${team.owner}` : undefined}
        title={
          <span className="inline-flex items-center gap-2">
            <Avatar src={team.avatar} name={team.name} size={20} />
            {team.name}
            {rosterId === myRosterId && <Badge tone="accent">you</Badge>}
          </span>
        }
        actions={stacked ? undefined : switcher}
        tabs={
          <>
            <Tabs<Inner>
              requested={page}
              value={tab}
              onChange={onPage}
              stacked={stacked}
              items={[
                ...(stacked ? [{ key: 'overview' as Inner, label: 'Overview' }] : []),
                { key: 'roster', label: 'Roster', count: team.players.length },
                { key: 'results', label: 'Results', count: season.weeks.length },
                { key: 'slots', label: 'Lineup slots' },
              ]}
            />
          </>
        }
      />
      <div className="mt-4 space-y-3">
        {stacked && switcher}
        {(!stacked || tab === 'overview') && (
          <>
        <StatGrid>
          <Stat label="Power Rank" value={`#${power.rank}`} badge={{ text: `${fmt(power.score, 0)}% vs avg team`, tone: power.score >= 55 ? 'pos' : power.score <= 45 ? 'neg' : 'neutral' }} sub="chance to beat an average team" />
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

        {rosterId === myRosterId && <MovesPanel rosterId={rosterId} />}
        <ScoutReport rosterId={rosterId} scout={scout} mine={rosterId === myRosterId} />
          </>
        )}

        <TabSection id="roster" active={tab === 'roster'}>
          <Panel
            title="Roster"
            pad={false}
            actions={
              <Segmented
                size="sm"
                value={basis}
                onChange={setBasis}
                options={[
                  { key: 'ahead', label: 'Ahead', title: 'Rest of season' },
                  { key: 'todate', label: 'To date', title: 'Season to date' },
                ]}
              />
            }
          >
            <Swap k={basis}>
              <RosterTable data={data} analysis={analysis} rosterId={rosterId} basis={basis} marked={scouted} />
            </Swap>
          </Panel>
        </TabSection>

        <TabSection id="results" active={tab === 'results'}>
          <Panel title="Weekly results" pad={false} actions={<span>scored vs projected</span>}>
            {chartWeeks.length > 0 && (
              <div className="border-b border-ff-line px-2 pb-2 pt-3">
                <ProjectionChart weeks={chartWeeks} actual={chartWeeks.map((w) => scored[w] ?? null)} projected={chartWeeks.map((w) => expected[w] ?? ahead[w] ?? null)} />
                {/* On a phone the explainer folds away so the chart and the table share the screen. */}
                <Disclosure from="md" summary="How projected is figured" className="text-[11px] leading-snug text-ff-muted md:mt-1.5 md:px-1">
                  Projected = best possible lineup on pre-game projections × the manager&apos;s efficiency. A bye or empty slot left in shows as a miss. Dashed weeks are ahead.
                </Disclosure>
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
                { key: 'opp', label: 'Opponent', sticky: true, render: (w) => (w.opponentId != null ? <TeamName id={w.opponentId} size={18} /> : <span className="text-ff-muted">bye</span>) },
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
        </TabSection>

        <TabSection id="slots" active={tab === 'slots'}>
          <Panel title="Lineup slots" actions={<span>wk {data.horizon[0]?.week ?? ''} starters · pts/wk ahead</span>} pad={false}>
            <Table
              rows={needs[rosterId]?.slots ?? []}
              rowKey={(s) => s.index}
              columns={[
                { key: 'slot', label: 'Slot', render: (s) => <span className="font-mono text-[11px] text-ff-text2">{s.slot.replace('SUPER_FLEX', 'SF')}</span> },
                { key: 'who', label: 'Starter', sticky: true, render: (s) => (s.starter ? <PlayerName player={players[s.starter]} id={s.starter} size={22} /> : <FreeAgentPick eligible={s.eligible} week={data.horizon[0]?.week} />) },
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
        </TabSection>
      </div>
    </>
  )
}

export default TeamsView
