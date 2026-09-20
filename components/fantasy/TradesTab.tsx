import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import {
  DEFAULT_TRADE_CONFIG,
  findTargets,
  findTrades,
  type TradeConfig,
  type TradeIdea,
} from '../../lib/fantasy/trades'
import PlayerName from './PlayerName'
import { Card, Meter, Muted, Pill, Sparkline, Table, fmt, fmtSigned } from './ui'

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']

const Names = ({ ids, players }: { ids: string[]; players: LeagueData['players'] }) => (
  <span className="flex flex-col gap-0.5">
    {ids.map((id) => (
      <PlayerName key={id} player={players[id]} id={id} />
    ))}
  </span>
)

const Gain = ({ value, digits = 2 }: { value: number; digits?: number }) => (
  <span className={value > 0.005 ? 'text-emerald-700 dark:text-emerald-400' : value < -0.005 ? 'text-rose-700 dark:text-rose-400' : 'text-stone-400 dark:text-stone-500'}>
    {fmtSigned(value, digits)}
  </span>
)

const TradesTab = ({ data, analysis }: { data: LeagueData; analysis: Analysis }) => {
  const { myRosterId, teamById, needs, slots } = analysis
  const players = data.players
  const [deep, setDeep] = useState(false)
  const [minTheirGain, setMinTheirGain] = useState(DEFAULT_TRADE_CONFIG.minTheirGain)
  const [maxValueAsk, setMaxValueAsk] = useState(DEFAULT_TRADE_CONFIG.maxValueAsk)
  const [partnerFilter, setPartnerFilter] = useState<number | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const horizonWeeks = data.horizon.map((h) => h.week)
  const positions = useMemo(
    () => POS_ORDER.filter((p) => (analysis.horizonStarter[p] ?? 0) > 0),
    [analysis.horizonStarter],
  )

  const me = myRosterId != null ? teamById[myRosterId] : null

  const freeAgents = useMemo(() => {
    const perWeek = analysis.horizon.perWeek
    return Object.keys(perWeek)
      .filter((id) => players[id] && analysis.rosteredBy[id] === undefined)
      .sort((a, b) => perWeek[b] - perWeek[a])
      .slice(0, 120)
  }, [analysis.horizon.perWeek, analysis.rosteredBy, players])

  const others = useMemo(
    () => analysis.teams.filter((t) => t.rosterId !== myRosterId).map((t) => ({ rosterId: t.rosterId, players: t.players })),
    [analysis.teams, myRosterId],
  )

  const targets = useMemo(() => {
    if (!me || !data.horizon.length) return []
    return findTargets({
      slots,
      players,
      horizon: data.horizon,
      pts: analysis.horizon.perWeek,
      me: { rosterId: me.rosterId, players: me.players },
      others,
      rosteredBy: analysis.rosteredBy,
      freeAgents,
      capacity: analysis.capacity,
      market: analysis.market,
      floor: analysis.horizonReplacement,
      limit: 60,
    })
  }, [me, data.horizon, slots, players, analysis, others, freeAgents])

  const ideas = useMemo(() => {
    if (!me || !data.horizon.length) return []
    const config: Partial<TradeConfig> = { minTheirGain, maxValueAsk, maxGet: deep ? 2 : 1, limit: 40 }
    return findTrades({
      slots,
      players,
      horizon: data.horizon,
      pts: analysis.horizon.perWeek,
      me: { rosterId: me.rosterId, players: me.players },
      others,
      capacity: analysis.capacity,
      market: analysis.market,
      floor: analysis.horizonReplacement,
      config,
    })
  }, [me, data.horizon, slots, players, analysis, others, minTheirGain, maxValueAsk, deep])

  if (myRosterId == null || !me) {
    return (
      <Card title="Trades">
        <p className="text-sm">No roster in this league belongs to {data.me.display_name ?? data.me.username}. Pick a different league above.</p>
      </Card>
    )
  }

  if (!data.horizon.length) {
    return (
      <Card title="Trades">
        <p className="text-sm">
          Nothing to project. The trade finder prices every deal over the weeks still to be played, and this league has none left.
        </p>
      </Card>
    )
  }

  const shownIdeas = partnerFilter == null ? ideas : ideas.filter((i) => i.partnerId === partnerFilter)
  const shownTargets = partnerFilter == null ? targets : targets.filter((t) => t.ownerId === partnerFilter)
  const myNeeds = needs[myRosterId]
  const maxNeed = Math.max(0.5, ...Object.values(needs).flatMap((n) => Object.values(n.byPos)))
  const horizonLabel = `weeks ${horizonWeeks[0]}–${horizonWeeks[horizonWeeks.length - 1]}`
  const basis = data.horizonSource === 'projections' ? `Sleeper projections, ${horizonLabel}` : `${data.valueSeason} results`

  const ideaKey = (i: TradeIdea) => `${i.partnerId}:${i.get.join('+')}:${i.give.join('+')}`

  return (
    <div className="space-y-4">
      <Card title="How this is priced" aside={basis}>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <p>
            Every number below is <b>points per week added to a team&apos;s optimal starting lineup</b>, solved separately for each of
            the {horizonWeeks.length} weeks ahead and averaged. Byes and players ruled out already read as zero in Sleeper&apos;s weekly
            projections, so a deal that only pays off during someone&apos;s bye shows up as exactly that.
          </p>
          <p>
            A slot nobody can fill is worth replacement level, not zero, because the waiver wire exists. That is why losing a
            quarterback in a one-quarterback league costs so little here: the twelfth-best free agent at the position is nearly as
            good as the tenth-best starter.{' '}
            {data.horizonSource === 'results' && <Muted>No projections were available, so past results stand in. Treat the numbers as weaker.</Muted>}
          </p>
        </div>
      </Card>

      <Card title="Every roster: what it produces and where it is thin" aside="pts/wk an average starter would add">
        <Table
          rows={analysis.teams}
          columns={[
            {
              key: 'team',
              label: 'Team',
              sort: (t) => t.name,
              render: (t) => (
                <span className="flex items-center gap-2">
                  <span className={t.rosterId === myRosterId ? 'font-medium' : ''}>{t.name}</span>
                  {t.rosterId === myRosterId && <Pill tone="accent">you</Pill>}
                </span>
              ),
            },
            { key: 'rec', label: 'Rec', render: (t) => `${analysis.seasonById[t.rosterId]?.wins ?? 0}-${analysis.seasonById[t.rosterId]?.losses ?? 0}` },
            { key: 'pf', label: 'PF', align: 'right', sort: (t) => analysis.seasonById[t.rosterId]?.pf ?? 0, render: (t) => fmt(analysis.seasonById[t.rosterId]?.pf, 0) },
            {
              key: 'lineup',
              label: 'Proj lineup',
              align: 'right',
              title: 'Optimal starting lineup, points per week over the horizon',
              sort: (t) => needs[t.rosterId]?.lineup ?? 0,
              render: (t) => fmt(needs[t.rosterId]?.lineup),
            },
            ...positions.map((pos) => ({
              key: pos,
              label: pos,
              align: 'right' as const,
              title: `Points per week a league-average starting ${pos} would add to this lineup`,
              sort: (t: (typeof analysis.teams)[number]) => needs[t.rosterId]?.byPos[pos] ?? 0,
              render: (t: (typeof analysis.teams)[number]) => {
                const v = needs[t.rosterId]?.byPos[pos] ?? 0
                return (
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <Meter value={v} max={maxNeed} width={34} />
                    <span className={v >= maxNeed * 0.66 ? 'text-rose-700 dark:text-rose-400' : ''}>{fmt(v)}</span>
                  </span>
                )
              },
            })),
          ]}
          rowKey={(t) => t.rosterId}
          defaultSort="lineup"
          onRowClick={(t) => setPartnerFilter(partnerFilter === t.rosterId ? null : t.rosterId)}
          rowClass={(t) => (partnerFilter === t.rosterId ? 'bg-stone-200/50 dark:bg-stone-800/50' : '')}
        />
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          A big number is a hole worth filling, not merely a position played badly: it already accounts for the flex absorbing part
          of the upgrade and for what the waiver wire offers. Click a row to narrow the two tables below to that team.
          {partnerFilter != null && (
            <>
              {' '}
              <button className="underline decoration-stone-400" onClick={() => setPartnerFilter(null)}>
                show all teams
              </button>
            </>
          )}
        </p>
      </Card>

      <Card
        title="Who to ask about"
        aside={`${shownTargets.length} players${partnerFilter != null ? ` on ${teamById[partnerFilter]?.name}` : ''}`}
      >
        <Table
          rows={shownTargets}
          columns={[
            { key: 'p', label: 'Player', render: (t) => <PlayerName player={players[t.id]} id={t.id} sub={t.ownerId == null ? 'free agent' : teamById[t.ownerId]?.name} /> },
            { key: 'slot', label: 'Starts at', render: (t) => t.slot ?? <Muted>bench</Muted> },
            {
              key: 'add',
              label: 'Adds to you',
              align: 'right',
              title: 'Points per week they would add to your optimal lineup',
              sort: (t) => t.add,
              render: (t) => <Gain value={t.add} />,
            },
            {
              key: 'cost',
              label: 'Costs owner',
              align: 'right',
              title: 'Points per week their own lineup loses without them',
              sort: (t) => t.ownerCost,
              render: (t) => (t.ownerId == null ? <Muted>–</Muted> : fmt(t.ownerCost, 2)),
            },
            {
              key: 'surplus',
              label: 'Surplus',
              align: 'right',
              title: 'Adds to you minus costs the owner. Positive means they are worth more to you than to them.',
              sort: (t) => t.surplus,
              render: (t) => (t.ownerId == null ? <Muted>–</Muted> : <Gain value={t.surplus} />),
            },
            { key: 'mkt', label: 'Value', align: 'right', title: 'Points per week above replacement at the position', sort: (t) => t.market, render: (t) => fmt(t.market, 1) },
          ]}
          rowKey={(t) => t.id}
          defaultSort="add"
          empty="Nobody outside your roster would improve your lineup."
        />
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Sort by surplus to find the gettable ones. A player who adds four points a week to you and costs his owner one is a deal
          waiting to happen; one who adds nine and costs his owner ten is a player you will overpay for.
        </p>
      </Card>

      <Card title="Offers worth making" aside={`${shownIdeas.length} of ${ideas.length}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="accent-[#2a78d6] dark:accent-[#3987e5]" />
            <span>Two-for-two packages</span>
            <Muted>slower</Muted>
          </label>
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">They gain at least</span>
            <input
              type="range"
              min={-2}
              max={1}
              step={0.25}
              value={minTheirGain}
              onChange={(e) => setMinTheirGain(Number(e.target.value))}
              className="w-28 accent-[#2a78d6] dark:accent-[#3987e5]"
            />
            <span className="tabular-nums w-12">{fmtSigned(minTheirGain, 2)}</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">Premium you may ask</span>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={maxValueAsk}
              onChange={(e) => setMaxValueAsk(Number(e.target.value))}
              className="w-28 accent-[#2a78d6] dark:accent-[#3987e5]"
            />
            <span className="tabular-nums w-10">{fmt(maxValueAsk, 1)}</span>
          </label>
        </div>

        <Table
          rows={shownIdeas}
          columns={[
            { key: 'get', label: 'You get', render: (i) => <Names ids={i.get} players={players} /> },
            { key: 'from', label: 'From', sort: (i) => teamById[i.partnerId]?.name ?? '', render: (i) => <span className="text-xs">{teamById[i.partnerId]?.name}</span> },
            { key: 'give', label: 'You give', render: (i) => <Names ids={i.give} players={players} /> },
            {
              key: 'mine',
              label: 'You',
              align: 'right',
              title: 'Points per week added to your optimal lineup',
              sort: (i) => i.myGain,
              render: (i) => <Gain value={i.myGain} />,
            },
            {
              key: 'theirs',
              label: 'Them',
              align: 'right',
              title: 'Points per week added to theirs. Below zero, you are asking them to take a hit.',
              sort: (i) => i.theirGain,
              render: (i) => <Gain value={i.theirGain} />,
            },
            {
              key: 'cost',
              label: 'You lose',
              align: 'right',
              title: 'What the players you send were worth to your lineup, before counting what comes back',
              sort: (i) => i.myCost,
              render: (i) => fmt(i.myCost, 2),
            },
            {
              key: 'weeks',
              label: 'Weeks',
              align: 'right',
              title: 'Horizon weeks your lineup is better off',
              sort: (i) => i.weeksBetter,
              render: (i) => (
                <span className={i.weeksBetter <= 1 && i.weeks > 2 ? 'text-amber-600 dark:text-amber-400' : ''}>
                  {i.weeksBetter}/{i.weeks}
                </span>
              ),
            },
            {
              key: 'ask',
              label: 'Ask',
              align: 'right',
              title: 'Open-market value in minus out. Positive means you are asking for a premium they may not wear.',
              sort: (i) => i.valueAsk,
              render: (i) => fmtSigned(i.valueAsk, 1),
            },
            { key: 'fills', label: 'Fills', render: (i) => (i.fills ? <span className="text-xs">{i.fills.slot} {fmt(i.fills.before)}→{fmt(i.fills.after)}</span> : <Muted>–</Muted>) },
          ]}
          rowKey={ideaKey}
          defaultSort="mine"
          onRowClick={(i) => setOpen(open === ideaKey(i) ? null : ideaKey(i))}
          rowClass={(i) => (open === ideaKey(i) ? 'bg-stone-200/50 dark:bg-stone-800/50' : '')}
          empty={
            minTheirGain >= 0
              ? 'No deal here makes both lineups better. Drag "they gain at least" below zero to see the ones you would have to talk someone into.'
              : 'Nothing at these settings.'
          }
        />

        {(() => {
          const sel = shownIdeas.find((i) => ideaKey(i) === open)
          if (!sel) return null
          return (
            <div className="mt-3 rounded border border-stone-200 dark:border-stone-800 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Your lineup, week by week</div>
                  <Sparkline points={sel.perWeek.map((w) => w.mine)} baseline={0} labels={sel.perWeek.map((w) => `Wk ${w.week}`)} width={180} height={34} />
                </div>
                <div className="text-xs tabular-nums">
                  {sel.perWeek.map((w) => (
                    <span key={w.week} className="inline-block w-20">
                      <Muted>w{w.week}</Muted> <Gain value={w.mine} digits={1} />
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                {sel.weeksBetter <= 1 && sel.weeks > 2
                  ? 'Almost all of this deal lands in a single week, which usually means it is covering a bye. A waiver claim does that for free.'
                  : `Better in ${sel.weeksBetter} of ${sel.weeks} weeks.`}{' '}
                {teamById[sel.partnerId]?.name}
                {needs[sel.partnerId]?.worstPos ? ` is thinnest at ${needs[sel.partnerId].worstPos}.` : '.'}
              </p>
            </div>
          )
        })()}

        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Packages always send at least as many players as they bring back, because rosters are full. Where a side would still end
          up over the limit, its least useful player is cut and the cost of that cut is already in the numbers.
        </p>
      </Card>

      {myNeeds && (
        <Card title="Your lineup, slot by slot" aside={`starters shown for week ${horizonWeeks[0]}`}>
          <Table
            rows={myNeeds.slots}
            columns={[
              { key: 'slot', label: 'Slot', render: (s) => s.slot },
              { key: 'who', label: 'Week ' + horizonWeeks[0], render: (s) => (s.starter ? <PlayerName player={players[s.starter]} id={s.starter} /> : <Muted>nobody — waiver fill</Muted>) },
              { key: 'pts', label: 'Pts/wk', align: 'right', sort: (s) => s.pts, render: (s) => fmt(s.pts) },
              { key: 'lg', label: 'League', align: 'right', sort: (s) => s.leagueAvg, render: (s) => fmt(s.leagueAvg) },
              { key: 'gap', label: 'Gap', align: 'right', sort: (s) => s.gap, render: (s) => <Gain value={s.gap} digits={1} /> },
            ]}
            rowKey={(s) => `${s.index}`}
          />
        </Card>
      )}
    </div>
  )
}

export default TradesTab
