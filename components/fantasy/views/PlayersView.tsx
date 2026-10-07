import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { applyTrade, makeHorizonEval } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes, PlayoffSchedule } from '../ContextNotes'
import PlayerName from '../PlayerName'
import { Badge, Button, Num, PageHeader, Panel, Segmented, Sparkline, Table, compact, cx, fmt, fmtSigned, pct, type Column } from '../ui'

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type Pos = (typeof POSITIONS)[number]
type Own = 'all' | 'fa' | 'rostered' | 'mine'
type Basis = 'ahead' | 'todate'
const PAGE = 60

const PlayersView = ({ data, analysis, sub, onSub }: { data: LeagueData; analysis: Analysis; sub: string | null; onSub: (s: string) => void }) => {
  const basis: Basis = sub === 'todate' ? 'todate' : 'ahead'
  const [pos, setPos] = useState<Pos>('ALL')
  const [own, setOwn] = useState<Own>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const { values, rosteredBy, myRosterId, teamById, posRanks, market } = analysis
  const players = data.players
  const perWeek = analysis.horizon.perWeek
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  useEffect(() => setLimit(PAGE), [pos, own, query, basis])

  const ids = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = basis === 'ahead' ? Object.keys(perWeek).filter((id) => perWeek[id] > 0.5) : Object.keys(values)
    return pool
      .filter((id) => {
        const p = players[id]
        if (!p) return false
        if (pos !== 'ALL' && p.pos !== pos) return false
        const owner = rosteredBy[id]
        if (own === 'fa' && owner !== undefined) return false
        if (own === 'rostered' && owner === undefined) return false
        if (own === 'mine' && owner !== myRosterId) return false
        if (q && !p.name.toLowerCase().includes(q) && !(p.team ?? '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => (basis === 'ahead' ? (market[b] ?? -99) - (market[a] ?? -99) : (values[b]?.war ?? -99) - (values[a]?.war ?? -99)))
  }, [basis, perWeek, values, players, pos, own, query, rosteredBy, myRosterId, market])

  // Positional rank on the forward-looking number.
  const aheadRank = useMemo(() => {
    const byPos: Record<string, string[]> = {}
    for (const id of Object.keys(perWeek)) {
      const p = players[id]?.pos
      if (p) (byPos[p] ??= []).push(id)
    }
    const out: Record<string, number> = {}
    for (const p of Object.keys(byPos)) byPos[p].sort((a, b) => (market[b] ?? 0) - (market[a] ?? 0)).forEach((id, i) => (out[id] = i + 1))
    return out
  }, [perWeek, players, market])

  const visible = ids.slice(0, limit)
  const toYou = useMemo(() => {
    if (basis !== 'ahead' || myRosterId == null || !data.horizon.length) return {}
    const mine = teamById[myRosterId].players
    const ev = makeHorizonEval(analysis.slots, players, data.horizon, analysis.horizonReplacement)
    const base = ev.total(mine)
    const out: Record<string, number> = {}
    for (const id of visible) if (rosteredBy[id] !== myRosterId) out[id] = base === 0 ? 0 : ev.total(applyTrade(mine, [], [id], analysis.capacity, perWeek)) - base
    return out
  }, [basis, myRosterId, data.horizon, teamById, analysis, players, visible.join(','), rosteredBy, perWeek]) // eslint-disable-line react-hooks/exhaustive-deps

  const owner = (id: string) =>
    rosteredBy[id] !== undefined ? (
      <span className={rosteredBy[id] === myRosterId ? 'text-ff-accent' : ''}>{rosteredBy[id] === myRosterId ? 'you' : teamById[rosteredBy[id]]?.name}</span>
    ) : (
      <span className="text-ff-pos">free agent</span>
    )

  const ahead: Column<string>[] = [
    {
      key: 'rk',
      label: 'Rk',
      sort: (id) => -(aheadRank[id] ?? 999),
      render: (id) => (
        <span className="font-mono text-[11px] text-ff-muted">
          {players[id].pos}
          {aheadRank[id]}
        </span>
      ),
    },
    { key: 'p', label: 'Player', sticky: true, sort: (id) => players[id].name, render: (id) => <PlayerName player={players[id]} id={id} sub={owner(id)} /> },
    {
      key: 'hot',
      label: '',
      hideBelow: 'md',
      render: (id) =>
        trending[id] ? (
          <Badge tone="pos" title={`${trending[id].toLocaleString()} adds across Sleeper in the last 24h`}>
            ↑{compact(trending[id])}
          </Badge>
        ) : null,
    },
    {
      key: 'exp',
      label: 'Exp/wk',
      align: 'right',
      title: 'Expected points per week over the horizon',
      sort: (id) => perWeek[id] ?? 0,
      render: (id) => <span className="text-ff-text">{fmt(perWeek[id])}</span>,
    },
    { key: 'raw', label: 'Sleeper', align: 'right', hideBelow: 'sm', sort: (id) => data.context[id]?.raw ?? perWeek[id] ?? 0, render: (id) => fmt(data.context[id]?.raw ?? perWeek[id]) },
    {
      key: 'play',
      label: 'Plays',
      align: 'right',
      hideBelow: 'sm',
      sort: (id) => data.context[id]?.play ?? 1,
      render: (id) => <span className={(data.context[id]?.play ?? 1) < 0.8 ? 'text-ff-neg' : ''}>{pct(data.context[id]?.play)}</span>,
    },
    { key: 'val', label: 'Value', align: 'right', title: 'Points per week above replacement at the position', sort: (id) => market[id] ?? -99, render: (id) => <Num value={market[id]} /> },
    ...(data.consensus
      ? [
          {
            key: 'ecr',
            label: 'ECR',
            align: 'right' as const,
            title: 'FantasyPros expert consensus, rank at the position, rest of season',
            sort: (id: string) => -(data.consensus!.byId[id]?.posRank ?? 999),
            render: (id: string) => {
              const e = data.consensus!.byId[id]
              return e?.posRank ? (
                <span className="text-ff-text2" title={e.sd != null ? `overall ${e.rank ?? '–'} · spread ±${e.sd} (best ${e.best}, worst ${e.worst})` : undefined}>
                  {players[id].pos}
                  {Math.round(e.posRank)}
                </span>
              ) : (
                <span className="text-ff-muted">–</span>
              )
            },
          },
          {
            key: 'gap',
            label: 'vs ECR',
            align: 'right' as const,
            hideBelow: 'md' as const,
            title: 'Consensus position rank minus the model’s. Positive: the model likes this player more than the experts do.',
            sort: (id: string) => (data.consensus!.byId[id]?.posRank != null && aheadRank[id] ? data.consensus!.byId[id].posRank! - aheadRank[id] : -999),
            render: (id: string) => {
              const e = data.consensus!.byId[id]?.posRank
              return e != null && aheadRank[id] ? <Num value={e - aheadRank[id]} signed digits={0} /> : <span className="text-ff-muted">–</span>
            },
          },
        ]
      : []),
    ...(myRosterId != null
      ? [
          {
            key: 'you',
            label: 'To you',
            align: 'right' as const,
            title: 'Points per week this player would add to your optimal lineup, after cutting your least useful player',
            sort: (id: string) => toYou[id] ?? -99,
            render: (id: string) => (rosteredBy[id] === myRosterId ? <span className="text-ff-muted">yours</span> : <Num value={toYou[id]} signed digits={2} />),
          },
        ]
      : []),
    ...(data.playoffWeeks.length
      ? [{ key: 'po', label: 'Playoff opp', hideBelow: 'lg' as const, render: (id: string) => <PlayoffSchedule context={data.context[id]} weeks={data.playoffWeeks} /> }]
      : []),
    { key: 'why', label: 'Context', hideBelow: 'lg', render: (id) => <ContextNotes context={data.context[id]} players={players} max={2} /> },
  ]

  const todate: Column<string>[] = [
    {
      key: 'rk',
      label: 'Rk',
      sort: (id) => -(posRanks[id] ?? 999),
      render: (id) => (
        <span className="font-mono text-[11px] text-ff-muted">
          {players[id].pos}
          {posRanks[id]}
        </span>
      ),
    },
    { key: 'p', label: 'Player', sticky: true, sort: (id) => players[id].name, render: (id) => <PlayerName player={players[id]} id={id} sub={owner(id)} /> },
    { key: 'g', label: 'G', align: 'right', sort: (id) => values[id].games, render: (id) => values[id].games },
    { key: 'ppg', label: 'PPG', align: 'right', sort: (id) => values[id].ppg, render: (id) => <span className="text-ff-text">{fmt(values[id].ppg)}</span> },
    {
      key: 'risk',
      label: 'Risk-adj',
      align: 'right',
      hideBelow: 'md',
      title: 'PPG minus a penalty for week-to-week variance (Model)',
      sort: (id) => values[id].riskAdjPpg,
      render: (id) => fmt(values[id].riskAdjPpg),
    },
    { key: 'range', label: 'Floor–Ceil', align: 'right', hideBelow: 'lg', render: (id) => `${fmt(values[id].floor)}–${fmt(values[id].ceiling)}` },
    { key: 'par', label: 'PAR/G', align: 'right', hideBelow: 'sm', sort: (id) => values[id].parPerGame, render: (id) => fmtSigned(values[id].parPerGame) },
    { key: 'war', label: 'WAR', align: 'right', sort: (id) => values[id].war, render: (id) => <Num value={values[id].war} signed digits={2} className="font-medium" /> },
    {
      key: 'now',
      label: 'Now',
      align: 'right',
      hideBelow: 'md',
      title: 'Recency-weighted WAR per game',
      sort: (id) => values[id].recentWarPerGame,
      render: (id) => fmtSigned(values[id].recentWarPerGame, 3),
    },
    { key: 'spark', label: 'Weekly', hideBelow: 'sm', render: (id) => <Sparkline points={values[id].weekly.map((w) => w.pts)} labels={values[id].weekly.map((w) => `Wk ${w.week}`)} width={84} /> },
  ]

  return (
    <>
      <PageHeader
        code="06"
        title="Players"
        meta={
          basis === 'ahead' ? (
            <>
              <span className="num">{ids.length}</span> players · priced over wks{' '}
              <span className="num">
                {data.horizon[0]?.week}–{data.horizon[data.horizon.length - 1]?.week}
              </span>
            </>
          ) : (
            <>
              <span className="num">{ids.length}</span> players · {data.valueSeason} wks{' '}
              <span className="num">
                {data.valueWeeks[0] ?? '–'}–{data.valueWeeks[data.valueWeeks.length - 1] ?? '–'}
              </span>
            </>
          )
        }
        tabs={<div className="h-px" />}
      />
      <div className="mt-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            <Segmented<Basis>
              label="Basis"
              value={basis}
              onChange={(b) => onSub(b)}
              options={[
                { key: 'ahead', label: 'Rest of season' },
                { key: 'todate', label: 'Season to date' },
              ]}
            />
            <Segmented<Pos> label="Position" value={pos} onChange={setPos} options={POSITIONS.map((p) => ({ key: p, label: p === 'ALL' ? 'All' : p }))} />
            <Segmented<Own>
              label="Ownership"
              value={own}
              onChange={setOwn}
              options={[
                { key: 'all', label: 'All' },
                { key: 'fa', label: 'Free agents' },
                { key: 'rostered', label: 'Rostered' },
                ...(myRosterId != null ? [{ key: 'mine' as const, label: 'Mine' }] : []),
              ]}
            />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or team"
            aria-label="Search players"
            className="h-8 min-w-[160px] rounded-sm md:max-w-[260px] md:flex-1 border border-ff-line bg-ff-panel px-2.5 text-[13px] text-ff-text outline-none placeholder:text-ff-muted focus-visible:ring-2 focus-visible:ring-ff-accent/40"
          />
        </div>
        <Panel pad={false}>
          <Table
            rows={visible}
            rowKey={(id) => id}
            columns={basis === 'ahead' ? ahead : todate}
            defaultSort={basis === 'ahead' ? 'val' : 'war'}
            rowClass={(id) => cx(rosteredBy[id] === myRosterId && 'ff-mine')}
            empty="No players match."
          />
        </Panel>
        {ids.length > limit && (
          <div className="flex justify-center">
            <Button onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, ids.length - limit)} more <span className="num text-ff-muted">of {ids.length - limit}</span>
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

export default PlayersView
