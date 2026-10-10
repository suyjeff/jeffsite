import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { optimalLineup, type LineupPlayer } from '../../../lib/fantasy/lineup'
import { availabilityDrag } from '../../../lib/fantasy/scout'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes, contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import FreeAgentPick from '../FreeAgentPick'
import { INSIGHT_ROW, InsightMark } from '../InsightMark'
import ScoutReport, { scoutPlayers, useScout } from '../ScoutReport'
import MovesPanel from '../Moves'
import { Button, DeltaChip, Empty, Num, PageHeader, Panel, REASON_MARK, Segmented, Stat, StatGrid, Swap, Table, TabSection, GridFill, Tabs, ago, cx, fmt, fmtSigned, pct, usePhone, type PageChange, type Reason } from '../ui'
import { Callout } from '../Callout'
import RosterTable, { type Basis } from './RosterTable'

// Three questions, a page each. Overview: what to do now and why the team is where it is. Lineup: who starts this
// week, slot by slot, and how strong each slot is against the league. Roster: every player, bench and IR included,
// and what each is worth. Lineup and slots were once two pages over the same nine rows; they are one now.
type Sub = 'overview' | 'news' | 'lineup' | 'roster'
// Wide screens keep the news under Overview; on phones it is a page of its own.
const WIDE_SUBS: Sub[] = ['overview', 'lineup', 'roster']
const PHONE_SUBS: Sub[] = ['overview', 'news', 'lineup', 'roster']
/** Old page keys, kept so links to them still land: slot strength now lives in the lineup. */
const MOVED: Record<string, Sub> = { slots: 'lineup' }

/**
 * One player's news as a card on two columns: the portrait and each reason's square share the narrow one, and the
 * name, his line and every reason's words start on the same edge of the wide one.
 */
const NewsCard = ({ id, data }: { id: string; data: LeagueData }) => {
  const players = data.players
  const why = contextReasons(data.context[id], players).slice(0, 3)
  return (
    <div className="min-w-0 bg-ff-panel px-3 py-2.5">
      <PlayerName player={players[id]} id={id} size={24} sub={`news ${ago(players[id].newsAt!)} ago`} />
      {why.length ? (
        <ul className="mt-2 space-y-2">
          {why.map((r, i) => {
            const m = REASON_MARK[r.tone ?? 'neutral']
            return (
              <li key={i} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
                {/* 18px square on the label's 18px line, centred under the portrait. */}
                <span className={cx('flex h-[18px] w-[18px] items-center justify-center justify-self-center font-mono text-[12px] font-semibold leading-none', m.cls)}>
                  <span aria-hidden>{m.glyph}</span>
                  {m.sr && <span className="sr-only">{m.sr}</span>}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium leading-[18px] text-ff-text">{r.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.45] text-ff-text2">{r.text}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-1.5 pl-8 text-[12px] leading-[1.45] text-ff-muted">No change to his role or availability on file yet.</p>
      )}
    </div>
  )
}

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
  onSub: PageChange
  onTeam: (id: number) => void
}) => {
  // Phones get a page per section. A phone-only key opened on a wide screen (or a link to a section with
  // nothing in it, like news on a quiet day) lands on Overview, which holds it there.
  const stacked = usePhone()
  const { openPlayer } = useFantasy()
  const [basis, setBasis] = useState<Basis>('ahead')
  const [slotBasis, setSlotBasis] = useState<Basis>('ahead')
  const { myRosterId, teamById, needs, slots } = analysis
  const players = data.players
  const me = myRosterId != null ? teamById[myRosterId] : null
  const scout = useScout(myRosterId ?? -1)
  const scouted = useMemo(() => scoutPlayers(scout), [scout])

  // A link to a page that moved lands on its new home, in place rather than as a step to go Back to.
  const moved = sub != null ? MOVED[sub] : undefined
  useEffect(() => {
    if (moved) onSub(moved, { replace: true })
  }, [moved, onSub])

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

  // ---- Slot strength: ahead (horizon) or to date (results), against the league ----
  const slotStrength = useMemo(() => {
    if (!me) return []
    if (slotBasis === 'ahead') {
      return (needs[me.rosterId]?.slots ?? []).map((s) => {
        const all = analysis.teams.map((t) => needs[t.rosterId]?.slots[s.index]?.pts ?? 0).sort((a, b) => b - a)
        return { mine: s.pts, league: s.leagueAvg, rank: all.findIndex((v) => v <= s.pts) + 1 }
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
    return slots.map((_, i) => {
      const all = perTeam.map((t) => t.avg[i]).sort((a, b) => b - a)
      return { mine: mineRow.avg[i], league: all.reduce((a, b) => a + b, 0) / all.length, rank: all.findIndex((v) => v <= mineRow.avg[i]) + 1 }
    })
  }, [me, slotBasis, needs, analysis.teams, data.valueWeeks, data.weekPoints, slots, players])

  // ---- The lineup as set, slot by slot, each with the swap it needs and how strong the slot is ----
  const lineupRows = useMemo(() => {
    if (!me) return []
    const set = me.roster.starters ?? []
    // Each starter the projected best lineup sits gets the bench player who should take his place; a starter left
    // over goes into the first empty slot.
    const swapFor = new Map<string, string>()
    const spare: string[] = []
    if (lineupCheck) {
      lineupCheck.start.forEach((id, k) => (lineupCheck.bench[k] ? swapFor.set(lineupCheck.bench[k], id) : spare.push(id)))
    }
    return slots.map((slot, i) => {
      const id = set[i] && set[i] !== '0' ? set[i] : null
      const swap = id ? (swapFor.get(id) ?? null) : (spare.shift() ?? null)
      return { i, slot: slot.name.replace('SUPER_FLEX', 'SF'), eligible: slot.eligible, id, swap, strength: slotStrength[i] }
    })
  }, [me, slots, lineupCheck, slotStrength])

  if (!me) {
    return (
      <>
        <PageHeader title="My team" />
        <div className="mt-4">
          <Empty title="No roster of yours in this league">Pick a league you are in from the menu.</Empty>
        </div>
      </>
    )
  }
  const season = analysis.seasonById[me.rosterId]
  const pages = (stacked ? PHONE_SUBS : WIDE_SUBS).filter((k) => (k === 'news' ? !!fresh.length : true))
  const want = moved ?? sub
  const tab: Sub = pages.includes(want as Sub) ? (want as Sub) : 'overview'
  const proj = data.projections
  const week = data.projectionWeek ?? data.horizon[0]?.week
  const swaps = lineupRows.filter((r) => r.swap)
  const n = analysis.teams.length

  const teamLink = (
    <Button size="sm" variant="ghost" onClick={() => onTeam(me.rosterId)} title="The same team as the league sees it">
      Team page →
    </Button>
  )

  const newsPanel = fresh.length > 0 ? (
    <Panel title="Recent news on your roster" actions={<span>player file {ago(newsAsOf)} old</span>} pad={false}>
      <div className="grid grid-cols-1 gap-px bg-ff-line/60 sm:grid-cols-2 2xl:grid-cols-3">
        {fresh.map((id) => (
          <NewsCard key={id} id={id} data={data} />
        ))}
        <GridFill n={fresh.length} wide="2xl" />
      </div>
      <Callout kind="instruction" className="m-3">
        Sleeper flags news but not what it says, once a day. Read it in Sleeper, then click a name to set your read.
      </Callout>
    </Panel>
  ) : null

  const lineupPanel = (
    <Panel
      title={`Week ${week ?? ''} lineup`}
      pad={false}
      actions={
        <Segmented
          size="sm"
          value={slotBasis}
          onChange={setSlotBasis}
          options={[
            { key: 'ahead', label: 'Ahead', title: 'Slot strength over the horizon' },
            { key: 'todate', label: 'To date', title: 'Slot strength in weeks played' },
          ]}
        />
      }
    >
      {lineupCheck &&
        (swaps.length ? (
          <div className="border-b border-ff-line">
            <Callout kind="insight" compact>
              <ul className="space-y-0.5 text-ff-text">
                {swaps.map((r) => (
                  <li key={r.i}>
                    Start {players[r.swap!]?.name} <span className="num text-ff-text2">{fmt(proj?.[r.swap!])}</span>
                    {r.id ? (
                      <>
                        {' '}over {players[r.id]?.name} <span className="num text-ff-text2">{fmt(proj?.[r.id])}</span>
                      </>
                    ) : (
                      <> in the empty {r.slot} slot</>
                    )}
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-ff-line px-3 py-2 text-[12.5px] text-ff-pos">
            <span className="h-1.5 w-1.5 bg-ff-pos" />
            Your lineup matches the projected optimum.
          </div>
        ))}
      <Table
        dense
        rows={lineupRows}
        rowKey={(r) => r.i}
        rowClass={(r) => (r.swap ? INSIGHT_ROW : '')}
        columns={[
          { key: 'slot', label: 'Slot', render: (r) => <span className="font-mono text-[11px] text-ff-text2">{r.slot}</span> },
          {
            key: 'who',
            label: 'Starter',
            sticky: true,
            render: (r) => (
              <div className="min-w-0">
                {r.id ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <PlayerName player={players[r.id]} id={r.id} size={22} className="min-w-0" />
                    {r.swap && <InsightMark />}
                  </span>
                ) : r.swap ? (
                  <span className="flex items-center gap-1.5 text-ff-muted">
                    empty <InsightMark />
                  </span>
                ) : (
                  <FreeAgentPick eligible={r.eligible} week={week} />
                )}
                {/* The swap, under the man it replaces: on the portrait's right edge, so it reads as part of his row. */}
                {r.swap && (
                  <div className="mt-1 whitespace-normal pl-[30px] text-[11.5px] leading-tight text-ff-text2">
                    Start{' '}
                    <button type="button" onClick={() => openPlayer(r.swap!)} className="font-medium text-ff-text hover:underline">
                      {players[r.swap]?.name ?? r.swap}
                    </button>{' '}
                    instead
                    {proj && (
                      <>
                        ,{' '}
                        <Num value={(proj[r.swap] ?? 0) - (r.id ? (proj[r.id] ?? 0) : 0)} signed />
                      </>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          ...(proj
            ? [{ key: 'pts', label: 'Proj', align: 'right' as const, title: `Sleeper's projection for week ${week}`, render: (r: (typeof lineupRows)[number]) => (r.id ? <span className="text-ff-text">{fmt(proj[r.id])}</span> : null) }]
            : []),
          { key: 'ctx', label: '', hideBelow: 'lg', render: (r) => (r.id ? <ContextNotes context={data.context[r.id]} players={players} max={1} /> : null) },
          {
            key: 'mine',
            label: 'Slot/wk',
            align: 'right',
            hideBelow: 'sm',
            title: slotBasis === 'ahead' ? 'Points per week this slot is expected to produce over the horizon' : 'Average points this slot of your best possible lineup produced in weeks played',
            render: (r) => fmt(r.strength?.mine),
          },
          { key: 'lg', label: 'League', align: 'right', hideBelow: 'md', title: 'The same slot on the average team', render: (r) => fmt(r.strength?.league) },
          { key: 'gap', label: 'vs lg', align: 'right', title: 'Against the same slot on the average team', sort: (r) => (r.strength ? r.strength.mine - r.strength.league : 0), render: (r) => (r.strength ? <Num value={r.strength.mine - r.strength.league} signed /> : null) },
          {
            key: 'rank',
            label: 'Rank',
            align: 'right',
            sort: (r) => -(r.strength?.rank ?? 99),
            render: (r) => (r.strength ? <span className={cx(r.strength.rank <= 3 ? 'text-ff-pos' : r.strength.rank > n - 3 ? 'text-ff-neg' : 'text-ff-text2')}>{r.strength.rank}/{n}</span> : null),
          },
        ]}
      />
      <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
        Starters as set in Sleeper{proj ? `, with week ${week} projections` : ''}. The slot columns are{' '}
        {slotBasis === 'ahead' ? 'what each slot of your best lineup is expected to produce a week over the horizon' : 'what each slot of your best possible lineup averaged in weeks played'}, against the league. Bench depth is on the
        Roster page.
      </p>
    </Panel>
  )

  const rosterPanel = (
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
      {/* The scouting line, so the players it is built on can be marked where they stand in the roster. */}
      {scout.summary && (
        <div className="border-b border-ff-line">
          <Callout kind="insight" compact>
            <span className="text-[13px] text-ff-text">{scout.summary}</span>
          </Callout>
        </div>
      )}
      <Swap k={basis}>
        <RosterTable data={data} analysis={analysis} rosterId={me.rosterId} basis={basis} marked={scouted} />
      </Swap>
    </Panel>
  )

  return (
    <>
      {/* On a wide screen the link sits beside the title; on a phone it would be a row of its own under the tabs on
          every page, so it closes the Overview page instead. */}
      <PageHeader
        title={me.name}
        actions={stacked ? undefined : teamLink}
        tabs={
          <Tabs<Sub>
            requested={want}
            value={tab}
            onChange={onSub}
            stacked={stacked}
            items={[
              { key: 'overview', label: 'Overview' },
              ...(stacked && newsPanel ? [{ key: 'news' as Sub, label: 'News', count: fresh.length }] : []),
              { key: 'lineup', label: 'Lineup', mark: swaps.length ? `${swaps.length} swap${swaps.length === 1 ? '' : 's'}` : undefined },
              { key: 'roster', label: 'Roster', count: me.players.length },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        <TabSection id="overview" active={tab === 'overview'}>
          {kpis && (
            <StatGrid>
              <Stat
                label="Projected lineup"
                value={fmt(kpis.mine)}
                delta={<DeltaChip value={kpis.mine - kpis.avg} title="Against the league's average lineup" />}
                badge={{ text: `#${kpis.rank} of ${n}`, tone: kpis.rank <= Math.ceil(n / 3) ? 'pos' : kpis.rank > n - Math.ceil(n / 3) ? 'neg' : 'neutral' }}
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
          <MovesPanel rosterId={me.rosterId} />
          <ScoutReport rosterId={me.rosterId} mine />
          {!stacked && newsPanel}
          {stacked && <div className="flex justify-end">{teamLink}</div>}
        </TabSection>
        {stacked && (
          <TabSection id="news" active={tab === 'news'}>
            {newsPanel}
          </TabSection>
        )}
        <TabSection id="lineup" active={tab === 'lineup'}>
          {lineupPanel}
        </TabSection>
        <TabSection id="roster" active={tab === 'roster'}>
          {rosterPanel}
        </TabSection>
      </div>
    </>
  )
}

export default MeView
