import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { DEFAULT_TRADE_CONFIG, findTargets, findTrades, scoreTrade, type TradeIdea, type TradeShape } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes, PlayoffSchedule } from '../ContextNotes'
import PlayerName from '../PlayerName'
import TradeCard, { SHAPE_LABEL } from '../TradeCard'
import { IconFilter } from '../icons'
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Label,
  Meter,
  Num,
  PageHeader,
  Panel,
  PlayerAvatar,
  Segmented,
  Select,
  Slider,
  Table,
  Tabs,
  WeekBars,
  cx,
  fmt,
  fmtSigned,
  pct,
} from '../ui'

type Sub = 'suggested' | 'targets' | 'needs' | 'injuries' | 'builder'
const SUBS: Sub[] = ['suggested', 'targets', 'needs', 'injuries', 'builder']
type Sort = 'mine' | 'likely' | 'balanced'
type Makeup = 'any' | TradeShape

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']

const TradesView = ({
  data,
  analysis,
  sub,
  onSub,
}: {
  data: LeagueData
  analysis: Analysis
  sub: string | null
  onSub: (s: string) => void
}) => {
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'suggested'
  const { myRosterId, teamById, needs, slots } = analysis
  const players = data.players
  const me = myRosterId != null ? teamById[myRosterId] : null

  // ---- Search controls ----
  const [sort, setSort] = useState<Sort>('mine')
  const [makeup, setMakeup] = useState<Makeup>('any')
  const [partner, setPartner] = useState<number | 'all'>('all')
  const [minTheirGain, setMinTheirGain] = useState(DEFAULT_TRADE_CONFIG.minTheirGain)
  const [maxValueAsk, setMaxValueAsk] = useState(DEFAULT_TRADE_CONFIG.maxValueAsk)
  const [showFilters, setShowFilters] = useState(false)
  const [visible, setVisible] = useState(10)

  const others = useMemo(
    () => analysis.teams.filter((t) => t.rosterId !== myRosterId).map((t) => ({ rosterId: t.rosterId, players: t.players })),
    [analysis.teams, myRosterId],
  )
  const base = useMemo(
    () =>
      me
        ? {
            slots,
            players,
            horizon: data.horizon,
            pts: analysis.horizon.perWeek,
            me: { rosterId: me.rosterId, players: me.players },
            capacity: analysis.capacity,
            market: analysis.market,
            floor: analysis.horizonReplacement,
          }
        : null,
    [me, slots, players, data.horizon, analysis],
  )

  const search = useMemo(() => {
    if (!base) return { ideas: [] as TradeIdea[], ms: 0 }
    const t0 = performance.now()
    const ideas = findTrades({ ...base, others, config: { minTheirGain, maxValueAsk, limit: 80, perPartner: 8 } })
    return { ideas, ms: performance.now() - t0 }
  }, [base, others, minTheirGain, maxValueAsk])

  const shown = useMemo(() => {
    let xs = search.ideas
    if (makeup !== 'any') xs = xs.filter((i) => i.shape === makeup)
    if (partner !== 'all') xs = xs.filter((i) => i.partnerId === partner)
    const key: Record<Sort, (i: TradeIdea) => number> = {
      mine: (i) => i.myGain + 0.01 * i.theirGain,
      likely: (i) => i.theirGain + 0.25 * i.myGain,
      balanced: (i) => i.mutual + 0.05 * (i.myGain + i.theirGain),
    }
    const sorted = [...xs].sort((a, b) => key[sort](b) - key[sort](a))
    // One card per player-set from one team; other ways to pay for it become versions.
    const groups = new Map<string, TradeIdea[]>()
    for (const i of sorted) {
      const k = `${i.partnerId}|${[...i.get].sort().join(',')}`
      const g = groups.get(k)
      if (g) g.push(i)
      else groups.set(k, [i])
    }
    return [...groups.values()]
  }, [search.ideas, makeup, partner, sort])
  useEffect(() => setVisible(10), [makeup, partner, sort, minTheirGain, maxValueAsk])

  const tags = useMemo(() => {
    const out = new Map<TradeIdea, string>()
    const xs = search.ideas
    if (!xs.length) return out
    const best = [...xs].sort((a, b) => b.myGain - a.myGain)[0]
    const strong = xs.filter((i) => i.myGain >= best.myGain * 0.4)
    const likely = [...strong].sort((a, b) => b.theirGain - a.theirGain)[0]
    const balanced = [...xs].sort((a, b) => b.mutual - a.mutual)[0]
    out.set(best, 'Best for you')
    if (likely && !out.has(likely)) out.set(likely, 'Easiest sell')
    if (balanced && !out.has(balanced)) out.set(balanced, 'Most even')
    return out
  }, [search.ideas])

  const shapeCounts = useMemo(() => {
    const c: Record<string, number> = { any: search.ideas.length }
    for (const i of search.ideas) c[i.shape] = (c[i.shape] ?? 0) + 1
    return c
  }, [search.ideas])

  // ---- Targets ----
  const [targetScope, setTargetScope] = useState<'all' | 'rostered' | 'fa'>('all')
  const freeAgents = useMemo(() => {
    const perWeek = analysis.horizon.perWeek
    return Object.keys(perWeek)
      .filter((id) => players[id] && analysis.rosteredBy[id] === undefined)
      .sort((a, b) => perWeek[b] - perWeek[a])
      .slice(0, 120)
  }, [analysis.horizon.perWeek, analysis.rosteredBy, players])
  const targets = useMemo(() => {
    if (!base) return []
    return findTargets({ ...base, others, rosteredBy: analysis.rosteredBy, freeAgents, limit: 80 })
  }, [base, others, analysis.rosteredBy, freeAgents])
  const shownTargets = targets.filter((t) => (targetScope === 'all' ? true : targetScope === 'fa' ? t.ownerId == null : t.ownerId != null))

  // ---- Needs ----
  const [needsView, setNeedsView] = useState<'position' | 'slot'>('position')
  const positions = useMemo(() => POS_ORDER.filter((p) => (analysis.horizonStarter[p] ?? 0) > 0), [analysis.horizonStarter])
  const maxNeed = Math.max(0.5, ...Object.values(needs).flatMap((n) => Object.values(n.byPos)))

  // ---- Injuries and roles ----
  const situations = useMemo(() => {
    const ctx = data.context
    const rows = Object.keys(ctx)
      .filter((id) => players[id])
      .filter((id) => {
        const kinds = ctx[id].notes.map((n) => n.kind)
        const rostered = analysis.rosteredBy[id] !== undefined
        const bump = ctx[id].notes.find((n) => n.kind === 'bump')
        if (kinds.includes('returns') || kinds.includes('status') || kinds.includes('temporary')) return rostered || ctx[id].raw >= 4
        return !!bump && bump.kind === 'bump' && bump.pts >= (rostered ? 1 : 1.5)
      })
      .map((id) => ({ id, owner: analysis.rosteredBy[id] ?? null }))
    const rank = (r: { owner: number | null }) => (r.owner === myRosterId ? 0 : r.owner != null ? 1 : 2)
    return rows.sort((a, b) => rank(a) - rank(b) || ctx[b.id].raw - ctx[a.id].raw).slice(0, 40)
  }, [data.context, players, analysis.rosteredBy, myRosterId])
  const [situationScope, setSituationScope] = useState<'all' | 'mine' | 'league' | 'fa'>('all')
  const shownSituations = situations.filter((r) =>
    situationScope === 'all' ? true : situationScope === 'mine' ? r.owner === myRosterId : situationScope === 'fa' ? r.owner == null : r.owner != null && r.owner !== myRosterId,
  )

  // ---- Builder ----
  const [bPartner, setBPartner] = useState<number | null>(null)
  const [bGive, setBGive] = useState<string[]>([])
  const [bGet, setBGet] = useState<string[]>([])
  const openInBuilder = (idea: TradeIdea) => {
    setBPartner(idea.partnerId)
    setBGive(idea.give)
    setBGet(idea.get)
    onSub('builder')
    window.scrollTo({ top: 0 })
  }
  const built = useMemo(() => {
    if (!base || bPartner == null) return null
    const p = teamById[bPartner]
    if (!p) return null
    return scoreTrade({ ...base, partner: { rosterId: p.rosterId, players: p.players }, give: bGive, get: bGet })
  }, [base, bPartner, bGive, bGet, teamById])

  if (!me) {
    return (
      <>
        <PageHeader title="Trades" />
        <div className="mt-4">
          <Empty title="No roster of yours in this league">Pick a league you are in from the menu.</Empty>
        </div>
      </>
    )
  }
  if (!data.horizon.length) {
    return (
      <>
        <PageHeader title="Trades" />
        <div className="mt-4">
          <Empty title="Nothing left to project">Trades are priced over the weeks still to be played, and this season has none left.</Empty>
        </div>
      </>
    )
  }

  const horizonWeeks = data.horizon.map((h) => h.week)
  const meta = (
    <>
      <span className="num">
        wks {horizonWeeks[0]}–{horizonWeeks[horizonWeeks.length - 1]}
      </span>
      {data.playoffWeeks.length > 0 && data.horizonMode === 'playoffs' && (
        <>
          {' '}· playoffs <span className="num">×{data.playoffWeight}</span>
        </>
      )}{' '}
      · <span className="num">{search.ideas.length}</span> deals across <span className="num">{new Set(search.ideas.map((i) => i.partnerId)).size}</span> teams ·{' '}
      <span className="num">{Math.round(search.ms)}ms</span>
    </>
  )

  const filterControls = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Slider
        label="They gain at least"
        value={minTheirGain}
        min={-2}
        max={1}
        step={0.25}
        onChange={setMinTheirGain}
        defaultValue={DEFAULT_TRADE_CONFIG.minTheirGain}
        format={(v) => `${fmtSigned(v, 2)} /wk`}
        hint="Zero means deals they should take on the merits. Below zero shows the ones you would have to talk them into."
      />
      <Slider
        label="Premium you may ask"
        value={maxValueAsk}
        min={0}
        max={12}
        step={0.5}
        onChange={setMaxValueAsk}
        defaultValue={DEFAULT_TRADE_CONFIG.maxValueAsk}
        format={(v) => `${v.toFixed(1)} /wk`}
        hint="Most open-market value you may take beyond what you send before an offer reads as a lowball."
      />
    </div>
  )

  return (
    <>
      <PageHeader
        title="Trades"
        meta={meta}
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={(k) => onSub(k)}
            items={[
              { key: 'suggested', label: 'Suggested', count: search.ideas.length },
              { key: 'targets', label: 'Targets', count: targets.length },
              { key: 'needs', label: 'League needs' },
              { key: 'injuries', label: 'Injuries & roles', count: situations.length },
              { key: 'builder', label: 'Builder' },
            ]}
          />
        }
      />

      <div className="mt-4 space-y-3">
        {tab === 'suggested' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<Sort>
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { key: 'mine', label: 'Best for you', title: 'Most points per week added to your lineup' },
                  { key: 'likely', label: 'Likeliest', title: 'Most points per week added to theirs, among deals that help you' },
                  { key: 'balanced', label: 'Balanced', title: 'Highest gain for the side that gains less' },
                ]}
              />
              <Segmented<Makeup>
                label="Makeup"
                value={makeup}
                onChange={setMakeup}
                options={[
                  { key: 'any', label: <>Any <span className="num text-ff-muted">{shapeCounts.any ?? 0}</span></> },
                  { key: 'one-for-one', label: <>1-for-1 <span className="num text-ff-muted">{shapeCounts['one-for-one'] ?? 0}</span></>, title: 'One player each way' },
                  { key: 'consolidate', label: <>Consolidate <span className="num text-ff-muted">{shapeCounts.consolidate ?? 0}</span></>, title: 'You send more players than you get' },
                  { key: 'depth', label: <>Depth <span className="num text-ff-muted">{shapeCounts.depth ?? 0}</span></>, title: 'You get more players than you send' },
                  { key: 'swap', label: <>Packages <span className="num text-ff-muted">{shapeCounts.swap ?? 0}</span></>, title: 'Several players each way, even count' },
                ]}
              />
              <Select label="Partner" value={String(partner)} onChange={(v) => setPartner(v === 'all' ? 'all' : Number(v))} className="max-w-[200px]">
                <option value="all">All teams</option>
                {analysis.teams
                  .filter((t) => t.rosterId !== myRosterId)
                  .map((t) => (
                    <option key={t.rosterId} value={t.rosterId}>
                      {t.name}
                    </option>
                  ))}
              </Select>
              <Button size="md" variant={showFilters ? 'primary' : 'outline'} onClick={() => setShowFilters((s) => !s)}>
                <IconFilter size={14} /> Limits
                {(minTheirGain !== DEFAULT_TRADE_CONFIG.minTheirGain || maxValueAsk !== DEFAULT_TRADE_CONFIG.maxValueAsk) && <span className="h-1.5 w-1.5 rounded-full bg-ff-warn" />}
              </Button>
            </div>
            {showFilters && <Panel title="Search limits">{filterControls}</Panel>}

            {shown.length === 0 ? (
              <Empty title={search.ideas.length ? 'No deals match these filters' : 'No deal here makes both lineups better'}>
                {minTheirGain >= 0 ? 'Lower "They gain at least" under Limits to see offers you would have to talk someone into.' : 'Try a different makeup or partner.'}
              </Empty>
            ) : (
              <>
                <div className="grid items-start gap-3 lg:grid-cols-2">
                  {shown.slice(0, visible).map((versions) => (
                    <TradeCard
                      key={`${versions[0].partnerId}:${versions[0].get.join('+')}`}
                      versions={versions}
                      data={data}
                      analysis={analysis}
                      tag={versions.map((x) => tags.get(x)).find(Boolean)}
                      onBuild={openInBuilder}
                    />
                  ))}
                </div>
                {shown.length > visible && (
                  <div className="flex justify-center">
                    <Button onClick={() => setVisible((v) => v + 10)}>
                      Show {Math.min(10, shown.length - visible)} more <span className="num text-ff-muted">of {shown.length - visible}</span>
                    </Button>
                  </div>
                )}
              </>
            )}
            <p className="text-[11.5px] leading-relaxed text-ff-muted">
              Deals are grown one player at a time from every one-for-one that helps you, keeping an extra piece only when it improves the deal: a sweetener when they need more,
              a second ask when there is room. Every number is points per week added to an optimal lineup, solved week by week with injury odds and teammates&apos; absences priced in.
              Uneven deals cost the side taking more bodies its least useful player.
            </p>
          </>
        )}

        {tab === 'targets' && (
          <Panel
            title="Who would lift your lineup"
            pad={false}
            actions={
              <Segmented
                size="sm"
                value={targetScope}
                onChange={setTargetScope}
                options={[
                  { key: 'all', label: 'All' },
                  { key: 'rostered', label: 'Rostered' },
                  { key: 'fa', label: 'Free agents' },
                ]}
              />
            }
          >
            <Table
              rows={shownTargets}
              rowKey={(t) => t.id}
              defaultSort="add"
              empty="Nobody outside your roster would improve your lineup."
              columns={[
                { key: 'p', label: 'Player', sticky: true, render: (t) => <PlayerName player={players[t.id]} id={t.id} sub={t.ownerId == null ? <span className="text-ff-pos">free agent</span> : teamById[t.ownerId]?.name} /> },
                { key: 'slot', label: 'Starts at', hideBelow: 'sm', render: (t) => <span className="font-mono text-[11.5px] text-ff-text2">{t.slot ?? '—'}</span> },
                { key: 'add', label: 'Adds', align: 'right', title: 'Points per week added to your optimal lineup', sort: (t) => t.add, render: (t) => <Num value={t.add} digits={2} signed /> },
                { key: 'cost', label: 'Owner loses', align: 'right', title: 'Points per week his own lineup loses without him', sort: (t) => t.ownerCost, render: (t) => (t.ownerId == null ? <span className="text-ff-muted">–</span> : <Num value={t.ownerCost} digits={2} />) },
                {
                  key: 'surplus',
                  label: 'Surplus',
                  align: 'right',
                  title: 'Adds to you minus what his owner loses. Positive: worth more to you than to them.',
                  sort: (t) => t.surplus,
                  render: (t) => (t.ownerId == null ? <span className="text-ff-muted">–</span> : <Num value={t.surplus} digits={2} signed />),
                },
                { key: 'play', label: 'Plays', align: 'right', hideBelow: 'md', sort: (t) => data.context[t.id]?.play ?? 1, render: (t) => <span className={(data.context[t.id]?.play ?? 1) < 0.8 ? 'text-ff-neg' : ''}>{pct(data.context[t.id]?.play)}</span> },
                { key: 'mkt', label: 'Value', align: 'right', hideBelow: 'md', title: 'Points per week above replacement', sort: (t) => t.market, render: (t) => fmt(t.market, 1) },
                ...(data.playoffWeeks.length
                  ? [{ key: 'po', label: 'Playoff opp', hideBelow: 'lg' as const, render: (t: (typeof targets)[number]) => <PlayoffSchedule context={data.context[t.id]} weeks={data.playoffWeeks} /> }]
                  : []),
                { key: 'why', label: 'Context', hideBelow: 'lg', render: (t) => <ContextNotes context={data.context[t.id]} players={players} max={3} /> },
              ]}
            />
          </Panel>
        )}

        {tab === 'needs' && (
          <Panel
            title={needsView === 'position' ? 'Points per week an average starter would add' : 'Each slot against the league average'}
            pad={false}
            actions={
              <Segmented
                size="sm"
                value={needsView}
                onChange={setNeedsView}
                options={[
                  { key: 'position', label: 'By position' },
                  { key: 'slot', label: 'By slot' },
                ]}
              />
            }
          >
            {needsView === 'position' ? (
              <Table
                rows={analysis.teams}
                rowKey={(t) => t.rosterId}
                defaultSort="lineup"
                rowClass={(t) => (t.rosterId === myRosterId ? 'ff-mine' : '')}
                columns={[
                  {
                    key: 'team',
                    label: 'Team',
                    sticky: true,
                    sort: (t) => t.name,
                    render: (t) => (
                      <span className="flex items-center gap-2">
                        <Avatar src={t.avatar} name={t.name} size={20} />
                        <span className={cx('max-w-[150px] truncate', t.rosterId === myRosterId && 'font-medium')}>{t.name}</span>
                        {t.rosterId === myRosterId && <Badge tone="accent">you</Badge>}
                      </span>
                    ),
                  },
                  { key: 'lineup', label: 'Lineup', align: 'right', title: 'Projected optimal lineup, points per week', sort: (t) => needs[t.rosterId]?.lineup ?? 0, render: (t) => fmt(needs[t.rosterId]?.lineup) },
                  ...positions.map((pos) => ({
                    key: pos,
                    label: pos,
                    align: 'right' as const,
                    title: `Points per week a league-average starting ${pos} would add`,
                    sort: (t: (typeof analysis.teams)[number]) => needs[t.rosterId]?.byPos[pos] ?? 0,
                    render: (t: (typeof analysis.teams)[number]) => {
                      const v = needs[t.rosterId]?.byPos[pos] ?? 0
                      return (
                        <span className="inline-flex items-center justify-end gap-2">
                          <Meter value={v} max={maxNeed} width={36} tone={v >= maxNeed * 0.66 ? 'neg' : 'accent'} />
                          <span className={cx('w-7', v >= maxNeed * 0.66 && 'text-ff-neg')}>{fmt(v)}</span>
                        </span>
                      )
                    },
                  })),
                ]}
              />
            ) : (
              <SlotGrid analysis={analysis} />
            )}
            <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
              {needsView === 'position'
                ? 'A big number is a hole worth filling: it already accounts for the flex absorbing part of an upgrade and for what the waiver wire offers.'
                : 'Points per week each lineup slot produces, minus the league average for that slot. Blue is above average, red below.'}
            </p>
          </Panel>
        )}

        {tab === 'injuries' && (
          <Panel
            title="Injuries and role changes"
            pad={false}
            actions={
              <Segmented
                size="sm"
                value={situationScope}
                onChange={setSituationScope}
                options={[
                  { key: 'all', label: 'All' },
                  { key: 'mine', label: 'Yours' },
                  { key: 'league', label: 'League' },
                  { key: 'fa', label: 'Free agents' },
                ]}
              />
            }
          >
            <Table
              rows={shownSituations}
              rowKey={(r) => r.id}
              empty="Nothing to flag."
              columns={[
                {
                  key: 'p',
                  label: 'Player',
                  sticky: true,
                  render: (r) => (
                    <PlayerName player={players[r.id]} id={r.id} sub={r.owner == null ? <span className="text-ff-pos">free agent</span> : r.owner === myRosterId ? <span className="text-ff-accent">you</span> : teamById[r.owner]?.name} />
                  ),
                },
                { key: 'play', label: 'Plays', align: 'right', sort: (r) => data.context[r.id]?.play ?? 1, render: (r) => pct(data.context[r.id]?.play) },
                { key: 'raw', label: 'Sleeper', align: 'right', hideBelow: 'sm', title: "Sleeper's projection, points per week", sort: (r) => data.context[r.id]?.raw ?? 0, render: (r) => fmt(data.context[r.id]?.raw) },
                { key: 'adj', label: 'Expected', align: 'right', title: 'After chance of playing and teammates’ absences', sort: (r) => data.context[r.id]?.adjusted ?? 0, render: (r) => fmt(data.context[r.id]?.adjusted) },
                {
                  key: 'chg',
                  label: 'Δ',
                  align: 'right',
                  sort: (r) => (data.context[r.id]?.adjusted ?? 0) - (data.context[r.id]?.raw ?? 0),
                  render: (r) => <Num value={(data.context[r.id]?.adjusted ?? 0) - (data.context[r.id]?.raw ?? 0)} signed />,
                },
                { key: 'why', label: 'What changed', render: (r) => <ContextNotes context={data.context[r.id]} players={players} max={4} /> },
              ]}
            />
          </Panel>
        )}

        {tab === 'builder' && (
          <Builder
            data={data}
            analysis={analysis}
            partnerId={bPartner}
            setPartnerId={(id) => {
              setBPartner(id)
              setBGet([])
            }}
            give={bGive}
            setGive={setBGive}
            get={bGet}
            setGet={setBGet}
            result={built}
          />
        )}
      </div>
    </>
  )
}

/** Teams by lineup slot, colored by distance from the league average at that slot. */
const SlotGrid = ({ analysis }: { analysis: Analysis }) => {
  const { needs, slots, teams, myRosterId } = analysis
  const maxGap = Math.max(1, ...teams.flatMap((t) => needs[t.rosterId]?.slots.map((s) => Math.abs(s.gap)) ?? []))
  return (
    <div className="ff-scroll overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-ff-panel px-2 py-1.5 text-left font-mono text-[10.5px] font-normal uppercase tracking-wider text-ff-muted">Team</th>
            {slots.map((s, i) => (
              <th key={i} className="px-1 py-1.5 text-center font-mono text-[10.5px] font-normal uppercase tracking-wider text-ff-muted">
                {s.name.replace('SUPER_FLEX', 'SF')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.rosterId}>
              <td className={cx('sticky left-0 z-10 max-w-[140px] truncate bg-ff-panel px-2 py-1', t.rosterId === myRosterId ? 'font-medium text-ff-accent' : 'text-ff-text')}>{t.name}</td>
              {needs[t.rosterId]?.slots.map((s) => {
                const a = Math.min(1, Math.abs(s.gap) / maxGap)
                const bg = s.gap >= 0 ? `rgb(var(--ff-accent) / ${0.08 + a * 0.5})` : `rgb(var(--ff-neg) / ${0.08 + a * 0.5})`
                return (
                  <td key={s.index} className="num h-8 min-w-[52px] rounded-[4px] px-1 text-center text-ff-text" style={{ background: Math.abs(s.gap) < 0.25 ? 'rgb(var(--ff-sunken))' : bg }} title={`${s.slot}: ${s.pts.toFixed(1)} pts/wk, league ${s.leagueAvg.toFixed(1)}`}>
                    {fmtSigned(s.gap, 1)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Builder = ({
  data,
  analysis,
  partnerId,
  setPartnerId,
  give,
  setGive,
  get,
  setGet,
  result,
}: {
  data: LeagueData
  analysis: Analysis
  partnerId: number | null
  setPartnerId: (id: number | null) => void
  give: string[]
  setGive: (ids: string[]) => void
  get: string[]
  setGet: (ids: string[]) => void
  result: TradeIdea | null
}) => {
  const { teamById, myRosterId } = analysis
  const players = data.players
  const me = teamById[myRosterId!]
  const partner = partnerId != null ? teamById[partnerId] : null
  const perWeek = analysis.horizon.perWeek
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const sortIds = (ids: string[]) => ids.filter((id) => players[id]).sort((a, b) => (perWeek[b] ?? 0) - (perWeek[a] ?? 0))

  const Chip = ({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
        active ? 'border-ff-accent bg-ff-accent/10' : 'border-ff-line bg-ff-panel hover:border-ff-line2 hover:bg-ff-raised',
      )}
    >
      <PlayerAvatar id={id} player={players[id]} size={26} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] text-ff-text">{players[id]?.name}</span>
        <span className="block font-mono text-[10px] text-ff-muted">
          {players[id]?.pos} · {fmt(perWeek[id])}/wk
        </span>
      </span>
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Partner</Label>
        <Select label="Partner" value={partnerId ?? ''} onChange={(v) => setPartnerId(v ? Number(v) : null)} className="min-w-[200px]">
          <option value="">Pick a team</option>
          {analysis.teams
            .filter((t) => t.rosterId !== myRosterId)
            .map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.name}
              </option>
            ))}
        </Select>
        {(give.length > 0 || get.length > 0) && (
          <Button
            variant="ghost"
            onClick={() => {
              setGive([])
              setGet([])
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {result && (
        <Panel title={`${give.length}-for-${get.length} · ${SHAPE_LABEL[result.shape]}`}>
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <Label>Your lineup</Label>
                <div className="mt-0.5 text-[22px] leading-tight">
                  <Num value={result.myGain} digits={2} signed suffix=" /wk" />
                </div>
              </div>
              <div>
                <Label>{partner?.name ?? 'Theirs'}</Label>
                <div className="mt-0.5 text-[22px] leading-tight">
                  <Num value={result.theirGain} digits={2} signed suffix=" /wk" />
                </div>
              </div>
              <div>
                <Label>Weeks better</Label>
                <div className="num mt-0.5 text-[22px] leading-tight text-ff-text">
                  {result.weeksBetter}
                  <span className="text-ff-muted">/{result.weeks}</span>
                </div>
              </div>
              <div>
                <Label>Value ask</Label>
                <div className="num mt-0.5 text-[22px] leading-tight text-ff-text">{fmtSigned(result.valueAsk, 1)}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-12 font-mono text-[10px] uppercase tracking-wider text-ff-muted">You</span>
                <WeekBars weeks={result.perWeek.map((w) => ({ week: w.week, value: w.mine }))} highlight={data.playoffWeeks} barWidth={8} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 font-mono text-[10px] uppercase tracking-wider text-ff-muted">Them</span>
                <WeekBars weeks={result.perWeek.map((w) => ({ week: w.week, value: w.theirs }))} highlight={data.playoffWeeks} barWidth={8} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ff-line pt-2 text-[11.5px] text-ff-muted">
            {result.fills && (
              <span>
                Fills their <span className="font-mono text-ff-text2">{result.fills.slot}</span> <span className="num">{result.fills.before.toFixed(1)} → {result.fills.after.toFixed(1)}</span>
              </span>
            )}
            {result.myCuts.length > 0 && <span>You drop {result.myCuts.map((id) => players[id]?.name ?? id).join(', ')}</span>}
            {result.theirCuts.length > 0 && <span>They drop {result.theirCuts.map((id) => players[id]?.name ?? id).join(', ')}</span>}
            <span>
              Sending costs you <span className="num text-ff-text2">{result.myCost.toFixed(2)}</span>/wk before the return
            </span>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title={`You send · ${give.length}`} actions={<span className="num">{me.name}</span>}>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {sortIds(me.players).map((id) => (
              <Chip key={id} id={id} active={give.includes(id)} onClick={() => toggle(give, setGive, id)} />
            ))}
          </div>
        </Panel>
        <Panel title={`You get · ${get.length}`} actions={partner ? <span className="num">{partner.name}</span> : null}>
          {partner ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {sortIds(partner.players).map((id) => (
                <Chip key={id} id={id} active={get.includes(id)} onClick={() => toggle(get, setGet, id)} />
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[13px] text-ff-muted">Pick a partner to see their roster.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

export default TradesView
