import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { ideaKey } from '../../../lib/fantasy/grades'
import { searchTrades, tradeBase } from '../../../lib/fantasy/search'
import { DEFAULT_TRADE_CONFIG, findTargets, scoreTrade, type TradeIdea, type TradeShape } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes, PlayoffSchedule, contextReasons } from '../ContextNotes'
import PlayerName from '../PlayerName'
import TradeCard, { SHAPE_LABEL } from '../TradeCard'
import { useFantasy, useTradeRead } from '../FantasyContext'
import { sectionCode } from '../Shell'
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
  Reasons,
  Segmented,
  Select,
  Slider,
  Table,
  TabSection,
  Tabs,
  GridFill,
  BuildGlyph,
  Fab,
  spyTo,
  WeekBars,
  cx,
  fmt,
  fmtSigned,
  pct,
  usePhone,
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
  // Phones stack every section in one scroll, steered by the tab strip.
  const stacked = usePhone()
  const { myRosterId, teamById, needs } = analysis
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
  const base = useMemo(() => tradeBase(data, analysis), [data, analysis])

  const { grades } = useFantasy()
  const search = useMemo(() => searchTrades(data, analysis, { minTheirGain, maxValueAsk }), [data, analysis, minTheirGain, maxValueAsk])
  const readOf = useTradeRead()
  const reads = useMemo(() => new Map(search.ideas.map((i) => [i, readOf(i)])), [search.ideas, readOf])
  // Deals your grades rule out (a "no way", or a player you said they keep) step aside unless asked for.
  const [showRuledOut, setShowRuledOut] = useState(false)
  const openedAt = useRef(Date.now())
  const ruledOut = useMemo(() => search.ideas.filter((i) => reads.get(i)?.ruledOut).length, [search.ideas, reads])

  const shown = useMemo(() => {
    let xs = search.ideas
    // A deal you grade stays where it is until you leave, so it never vanishes under the pointer.
    if (!showRuledOut) xs = xs.filter((i) => !reads.get(i)?.ruledOut || (grades.all[ideaKey(i)]?.at ?? 0) >= openedAt.current)
    if (makeup !== 'any') xs = xs.filter((i) => i.shape === makeup)
    if (partner !== 'all') xs = xs.filter((i) => i.partnerId === partner)
    const key: Record<Sort, (i: TradeIdea) => number> = {
      mine: (i) => i.myGain + 0.01 * i.theirGain,
      // How likely they are to say yes, among deals that still help you.
      likely: (i) => (reads.get(i)?.index ?? 0) + 4 * Math.min(1, i.myGain),
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
  }, [search.ideas, makeup, partner, sort, reads, showRuledOut, grades.all])
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

  // What the grades changed, in a sentence: whose odds moved, and what is off the table.
  const gradeSummary = useMemo(() => {
    const L = grades.lessons
    const name = (id: number) => teamById[id]?.name ?? 'a team'
    const up = Object.entries(L.partner).filter(([, p]) => p.offset >= 0.2 && !p.dormant).map(([id]) => name(Number(id)))
    const down = Object.entries(L.partner).filter(([, p]) => p.offset <= -0.2 || p.dormant).map(([id]) => name(Number(id)))
    const kept = Object.values(L.untouchable).reduce((a, xs) => a + xs.length, 0)
    const parts = [
      up.length ? `raise the odds for ${up.join(', ')}` : '',
      down.length ? `lower them for ${down.join(', ')}` : '',
      kept ? `take ${kept} player${kept === 1 ? '' : 's'} off the table` : '',
      Math.abs(L.global) >= 0.15 ? `nudge every other team's odds ${L.global > 0 ? 'up' : 'down'} a little` : '',
    ].filter(Boolean)
    // Subject is "Your grade" or "Your N grades", so each verb agrees with it.
    const one = L.n === 1
    const fixed = parts.map((x) => (one ? x.replace(/^raise /, 'raises ').replace(/^lower /, 'lowers ').replace(/^take /, 'takes ').replace(/^nudge /, 'nudges ') : x))
    return fixed.length ? `${fixed.join('; ')}.` : one ? 'is saved; a few more and grades start to move the odds.' : 'are saved; a few more and they start to move the odds.'
  }, [grades.lessons, teamById])

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
  // Per team: its holes, its strongest slot, and whether your bench holds what it lacks.
  const needCards = useMemo(() => {
    const perWeek = analysis.horizon.perWeek
    const myStarters = new Set(myRosterId != null ? (needs[myRosterId]?.slots.map((x) => x.starter).filter(Boolean) as string[]) : [])
    const myBench: Record<string, { id: string; pts: number }> = {}
    for (const id of me?.players ?? []) {
      const pos = players[id]?.pos
      if (!pos || myStarters.has(id) || pos === 'K' || pos === 'DEF') continue
      const pts = perWeek[id] ?? 0
      if (pts >= (analysis.horizonStarter[pos] ?? Infinity) * 0.85 && pts > (myBench[pos]?.pts ?? 0)) myBench[pos] = { id, pts }
    }
    const ideasBy: Record<number, number> = {}
    for (const i of search.ideas) ideasBy[i.partnerId] = (ideasBy[i.partnerId] ?? 0) + 1
    return analysis.teams
      .map((team) => {
        const n = needs[team.rosterId]
        const holes = Object.entries(n?.byPos ?? {})
          .filter(([, v]) => v >= 0.5)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([pos, pts]) => ({ pos, pts, big: pts >= maxNeed * 0.66 }))
        const strong = [...(n?.slots ?? [])].sort((a, b) => b.gap - a.gap)[0]
        const mine = team.rosterId === myRosterId
        const supplyPos = mine ? undefined : holes.find((h) => myBench[h.pos])?.pos
        return {
          team,
          mine,
          lineup: n?.lineup ?? 0,
          holes,
          strong: strong && strong.gap >= 0.5 ? strong : null,
          supply: supplyPos ? { pos: supplyPos, ...myBench[supplyPos] } : null,
          ideas: ideasBy[team.rosterId] ?? 0,
          need: holes[0]?.pts ?? 0,
        }
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(!!b.supply) - Number(!!a.supply) || b.need - a.need)
  }, [analysis.teams, analysis.horizon.perWeek, analysis.horizonStarter, needs, myRosterId, me, players, search.ideas, maxNeed])

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
    // A stacked (phone) page already holds the builder further down: go there instead of switching views.
    if (stacked) window.setTimeout(() => spyTo('builder'), 0)
    else {
      onSub('builder')
      window.scrollTo({ top: 0 })
    }
  }
  // On phones the build action floats; it steps aside once the builder itself is on screen.
  const [builderInView, setBuilderInView] = useState(false)
  useEffect(() => {
    if (!stacked) return
    const el = document.querySelector('[data-spy="builder"]')
    if (!el) return
    const io = new IntersectionObserver(([e]) => setBuilderInView(e.isIntersecting), { rootMargin: '0px 0px -40% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [stacked, me])
  const built = useMemo(() => {
    if (!base || bPartner == null) return null
    const p = teamById[bPartner]
    if (!p) return null
    return scoreTrade({ ...base, partner: { rosterId: p.rosterId, players: p.players }, give: bGive, get: bGet })
  }, [base, bPartner, bGive, bGet, teamById])

  if (!me) {
    return (
      <>
        <PageHeader code={sectionCode('trades')} title="Trades" />
        <div className="mt-4">
          <Empty title="No roster of yours in this league">Pick a league you are in from the menu.</Empty>
        </div>
      </>
    )
  }
  if (!data.horizon.length) {
    return (
      <>
        <PageHeader code={sectionCode('trades')} title="Trades" />
        <div className="mt-4">
          <Empty title="Nothing left to project">Trades are priced over the weeks still to be played, and this season has none left.</Empty>
        </div>
      </>
    )
  }

  const filterControls = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        hint="Most trade value you may take beyond what you send before an offer reads as a lowball. Priced as managers price players: streamers count for little, and the players they drafted cost a premium."
      />
    </div>
  )

  return (
    <>
      <PageHeader
        code={sectionCode('trades')}
        title="Trades"
        actions={
          !stacked &&
          tab !== 'builder' && (
            <Button variant="aqua" onClick={() => onSub('builder')} title="Put together any deal and see it priced">
              <BuildGlyph />
              Build a trade
            </Button>
          )
        }
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={(k) => onSub(k)}
            stacked={stacked}
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
        <TabSection id="suggested" label="Suggested" count={search.ideas.length} active={tab === 'suggested'} stacked={stacked}>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<Sort>
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { key: 'mine', label: 'Best for you', title: 'Most points per week added to your lineup' },
                  { key: 'likely', label: 'Likeliest', title: 'Highest yes-odds: their gain, how the deal looks by consensus rankings, and how active they are' },
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
                Limits
                {(minTheirGain !== DEFAULT_TRADE_CONFIG.minTheirGain || maxValueAsk !== DEFAULT_TRADE_CONFIG.maxValueAsk) && <span className="h-1.5 w-1.5  bg-ff-warn" />}
              </Button>
            </div>
            {showFilters && <Panel title="Search limits">{filterControls}</Panel>}
            {grades.lessons.n > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-ff-accent/50 pl-3 text-[12px] leading-[1.45] text-ff-text2">
                <span>
                  <span className="text-ff-text">{grades.lessons.n === 1 ? 'Your grade' : `Your ${grades.lessons.n} grades`}</span> {gradeSummary}
                </span>
                {ruledOut > 0 && (
                  <button type="button" onClick={() => setShowRuledOut((x) => !x)} className="font-mono text-[11px] text-ff-accent hover:underline">
                    {showRuledOut ? `hide the ${ruledOut} ruled out` : `${ruledOut} ruled out · show`}
                  </button>
                )}
              </div>
            )}

            {shown.length === 0 ? (
              <Empty title={search.ideas.length ? 'No deals match these filters' : 'No deal here makes both lineups better'}>
                {minTheirGain >= 0 ? 'Lower "They gain at least" under Limits to see offers you would have to talk someone into.' : 'Try a different makeup or partner.'}
              </Empty>
            ) : (
              <>
                <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
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
              Deals start from every one-for-one that helps you and add a piece only when it improves the deal. Every number is points per week added to a best lineup, week by
              week, injuries priced in. The side taking more bodies cuts its weakest player.
            </p>
          
        </TabSection>

        <TabSection id="targets" label="Targets" count={targets.length} active={tab === 'targets'} stacked={stacked} bare>
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
              canExpand={(t) => !!data.context[t.id]?.notes.length}
              expand={(t) => {
                const items = contextReasons(data.context[t.id], players)
                return items.length ? <Reasons items={items} /> : null
              }}
              defaultSort="add"
              empty="Nobody outside your roster would improve your lineup."
              columns={[
                { key: 'p', label: 'Player', sticky: true, render: (t) => <PlayerName player={players[t.id]} id={t.id} sub={t.ownerId == null ? <span className="text-ff-pos">free agent</span> : teamById[t.ownerId]?.name} /> },
                { key: 'slot', label: 'Starts at', hideBelow: 'sm', render: (t) => <span className="font-mono text-[11.5px] text-ff-text2">{t.slot ?? '—'}</span> },
                { key: 'add', label: 'Adds', align: 'right', title: 'Points per week added to your optimal lineup', sort: (t) => t.add, render: (t) => <Num value={t.add} digits={2} signed /> },
                { key: 'cost', label: 'Owner loses', align: 'right', hideBelow: 'sm', title: 'Points per week his own lineup loses without him', sort: (t) => t.ownerCost, render: (t) => (t.ownerId == null ? <span className="text-ff-muted">–</span> : <Num value={t.ownerCost} digits={2} />) },
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
        </TabSection>

        <TabSection id="needs" label="League needs" active={tab === 'needs'} stacked={stacked}>
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
            {needsView === 'position' ? (
              <div className="space-y-2 border-t border-ff-line px-3 py-2.5 text-[11.5px] leading-[1.5] text-ff-muted">
                <p className="max-w-[78ch]">
                  <span className="text-ff-text2">How to read it.</span> Each cell is what one league-average starter at that position would add to the team&apos;s projected lineup, in
                  points per week, after its flex and the waiver wire have done what they can. Zero means the spot is covered; the bigger the number, the more that team should pay
                  to fill it. <span className="text-ff-text2">Lineup</span> is the projected best lineup, points per week.
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legend">
                  <span className="inline-flex items-center gap-1.5">
                    <Meter value={maxNeed * 0.08} max={maxNeed} width={36} tone="accent" />
                    covered
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Meter value={maxNeed * 0.45} max={maxNeed} width={36} tone="accent" />
                    could use one
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Meter value={maxNeed * 0.9} max={maxNeed} width={36} tone="neg" />
                    <span className="text-ff-neg">big hole</span>
                    <span>(within a third of the league&apos;s largest, {fmt(maxNeed)}/wk)</span>
                  </span>
                </div>
              </div>
            ) : (
              <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">Points per week each slot produces against the league average. Blue above, red below.</p>
            )}
          </Panel>

          <Panel title="Biggest needs, team by team" actions={<span>who to call, and with what</span>} pad={false}>
            <div className="grid grid-cols-1 gap-px bg-ff-line/60 sm:grid-cols-2 xl:grid-cols-3">
              {needCards.map((c) => (
                <div key={c.team.rosterId} className={cx('flex min-w-0 flex-col gap-2 bg-ff-panel px-3 py-2.5', c.mine && 'shadow-[inset_2px_0_0_rgb(var(--ff-accent))]')}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar src={c.team.avatar} name={c.team.name} size={20} />
                    <span className={cx('min-w-0 flex-1 truncate text-[13px] text-ff-text', c.mine && 'font-medium')}>{c.team.name}</span>
                    {c.mine ? <Badge tone="accent">you</Badge> : <span className="num text-[11px] text-ff-muted">{fmt(c.lineup)}/wk</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.holes.length ? (
                      c.holes.map((h) => (
                        <span key={h.pos} className={cx('inline-flex items-baseline gap-1 border px-1.5 py-0.5 font-mono text-[11px]', h.big ? 'border-ff-neg/40 bg-ff-neg/10 text-ff-neg' : 'border-ff-line text-ff-text2')}>
                          {h.pos}
                          <span className="num">+{fmt(h.pts)}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-ff-muted">No hole worth half a point a week</span>
                    )}
                    {c.strong && (
                      <span className="text-[11.5px] text-ff-muted">
                        · strongest at <span className="font-mono text-ff-text2">{c.strong.slot.replace('SUPER_FLEX', 'SF')}</span> <span className="num text-ff-pos">+{fmt(c.strong.gap)}</span>
                      </span>
                    )}
                  </div>
                  {c.supply && (
                    <p className="text-[12px] leading-[1.45] text-ff-text2">
                      <span className="mr-1 font-mono text-ff-pos" aria-hidden>
                        +
                      </span>
                      Your bench fits: {players[c.supply.id]?.name} <span className="num text-ff-muted">{c.supply.pos} · {fmt(c.supply.pts)}/wk</span>
                    </p>
                  )}
                  {!c.mine && c.ideas > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPartner(c.team.rosterId)
                        if (stacked) spyTo('suggested')
                        else onSub('suggested')
                      }}
                      className="mt-auto self-start font-mono text-[11px] text-ff-accent hover:underline"
                    >
                      See {c.ideas} deal{c.ideas === 1 ? '' : 's'} with them
                    </button>
                  )}
                </div>
              ))}
              <GridFill n={needCards.length} wide="xl" />
            </div>
            <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
              Holes are the cells above worth at least half a point a week, red for the league&apos;s biggest. Strongest is the lineup slot furthest above the league average.
            </p>
          </Panel>
        </TabSection>

        <TabSection id="injuries" label="Injuries & roles" count={situations.length} active={tab === 'injuries'} stacked={stacked} bare>
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
              canExpand={(r) => !!data.context[r.id]?.notes.length}
              expand={(r) => {
                const items = contextReasons(data.context[r.id], players)
                return items.length ? <Reasons items={items} /> : null
              }}
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
                { key: 'raw', label: 'Base', align: 'right', hideBelow: 'sm', title: 'Points per week before injury and role adjustments (Sleeper, coming week blended with prop lines)', sort: (r) => data.context[r.id]?.raw ?? 0, render: (r) => fmt(data.context[r.id]?.raw) },
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
        </TabSection>

        <TabSection id="builder" label="Builder" active={tab === 'builder'} stacked={stacked}>
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
        </TabSection>
      </div>
      {stacked && (
        <Fab onClick={() => spyTo('builder')} hidden={builderInView}>
          <BuildGlyph />
          Build a trade
        </Fab>
      )}
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
                  <td key={s.index} className="num h-8 min-w-[52px] rounded-[1px] px-1 text-center text-ff-text" style={{ background: Math.abs(s.gap) < 0.25 ? 'rgb(var(--ff-sunken))' : bg }} title={`${s.slot}: ${s.pts.toFixed(1)} pts/wk, league ${s.leagueAvg.toFixed(1)}`}>
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
        'flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors',
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
