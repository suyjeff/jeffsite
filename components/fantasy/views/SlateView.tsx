import React, { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { SlateGame, SlatePlayer } from '../../../lib/fantasy/slate'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import { MatchupScore, SlotTable, useMatchups } from '../matchup'
import { ManagerTag, RangeBar, dayOf, odds, pts } from '../slateBits'
import {
  Avatar,
  Badge,
  Empty,
  GridFill,
  PageHeader,
  Panel,
  Reasons,
  Segmented,
  Stat,
  StatGrid,
  Table,
  TabSection,
  Tabs,
  Pts,
  cx,
  fmt,
  fmtSigned,
  pct,
  usePhone,
  type Column,
  type Reason,
} from '../ui'

type Sub = 'week' | 'games' | 'managers'
const SUBS: Sub[] = ['week', 'games', 'managers']

/** One NFL game as a tile: state, projected score, what it moves, and the league starters who matter most in it. */
const GameTile = ({ g, maxSwing, me, opp, isKey }: { g: SlateGame; maxSwing: number; me: number | null; opp: number | null; isKey?: boolean }) => {
  const { data, openGame } = useFantasy()
  const top = g.players.slice(0, 3)
  return (
    <button
      type="button"
      onClick={() => openGame(g.key)}
      className={cx(
        'ff-press group flex min-w-0 flex-col gap-2 border bg-ff-panel px-3 py-2.5 text-left hover:border-ff-line2 hover:bg-ff-raised/40',
        isKey ? 'border-ff-accent/50' : 'border-ff-line',
      )}
    >
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-ff-text">
          {g.away} <span className="font-normal text-ff-muted">@</span> {g.home}
        </span>
        <span className={cx('font-mono text-[10.5px]', g.live ? 'text-ff-warn' : g.final ? 'text-ff-text2' : 'text-ff-muted')}>{g.final ? 'Final' : g.live ? 'Live' : dayOf(g.date).split(',')[0]}</span>
      </span>
      <span className="flex w-full items-center gap-2">
        <span className="num text-[11px] text-ff-muted" title={g.final ? 'Pre-game projected score' : 'Projected score'}>
          {g.totals.away ? fmt(g.totals.away.pts) : '–'}–{g.totals.home ? fmt(g.totals.home.pts) : '–'}
        </span>
        <span className="h-1 flex-1 bg-ff-line" aria-hidden>
          <span className={cx('block h-full', g.final ? 'bg-ff-text2/40' : 'bg-ff-accent')} style={{ width: `${Math.min(100, (g.swing / maxSwing) * 100)}%` }} />
        </span>
        <span className="num w-8 text-right text-[11px] text-ff-text2" title="Win odds it moves across the league's matchups">
          ±{pts(g.swing / 2)}
        </span>
      </span>
      <span className="min-h-[2.9em] space-y-0.5 text-[11.5px] leading-[1.45]">
        {top.length ? (
          top.map((p) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0', p.owner === me ? 'bg-ff-accent' : p.owner === opp ? 'bg-ff-neg' : 'bg-ff-line2')} />
              <span className={cx('truncate', p.owner === me ? 'text-ff-text' : 'text-ff-text2')}>{data.players[p.id]?.name}</span>
              {p.owner === me && <span className="sr-only">(yours)</span>}
              {p.owner === opp && <span className="sr-only">(your opponent&apos;s)</span>}
            </span>
          ))
        ) : (
          <span className="text-ff-muted">No league starters</span>
        )}
      </span>
      {isKey && <span className="font-mono text-[10px] text-ff-accent">decides your week</span>}
    </button>
  )
}

/** One NFL game: the league's starters in it, by how much they swing their managers' weeks. */
const GameCard = ({
  g,
  columns,
  expand,
  isKey,
}: {
  g: SlateGame
  columns: (max: number) => Column<SlatePlayer>[]
  expand: (p: SlatePlayer) => React.ReactNode
  /** The game that decides your week. */
  isKey?: boolean
}) => {
  const [all, setAll] = useState(false)
  const { openGame } = useFantasy()
  const max = Math.max(10, ...g.players.map((p) => Math.max(p.high, p.actual ?? 0)))
  const rows = all ? g.players : g.players.slice(0, 6)
  const involved = isKey
  return (
    <Panel
      className={cx(involved && 'border-ff-accent/40')}
      pad={false}
      title={
        <span className="flex items-baseline gap-2 normal-case tracking-normal">
          <button type="button" onClick={() => openGame(g.key)} title="Open the game" className="font-mono text-[12px] font-semibold text-ff-text hover:underline">
            {g.away}
            {g.totals.away && <span className="ml-1 font-normal text-ff-muted">{fmt(g.totals.away.pts)}</span>}
            <span className="mx-1.5 font-normal text-ff-muted">@</span>
            {g.home}
            {g.totals.home && <span className="ml-1 font-normal text-ff-muted">{fmt(g.totals.home.pts)}</span>}
          </button>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          {involved && <Badge tone="accent">decides your week</Badge>}
          {g.final ? <span className="text-ff-text2">Final</span> : g.live ? <span className="text-ff-warn">Live</span> : <span>{dayOf(g.date)}</span>}
        </span>
      }
    >
      {g.players.length ? (
        <>
          <Table rows={rows} rowKey={(p) => p.id} columns={columns(max)} dense canExpand={() => true} expand={expand} />
          <div className="flex items-center justify-between gap-3 border-t border-ff-line px-3 py-1.5 text-[11px] text-ff-muted">
            <span>
              {g.final ? (
                'Final'
              ) : (
                <>
                  Moves win odds <span className="num text-ff-text2">±{pts(g.swing / 2)}</span> across the league&apos;s matchups
                </>
              )}
            </span>
            {g.players.length > 6 && (
              <button type="button" onClick={() => setAll((x) => !x)} className="font-mono text-ff-accent hover:underline">
                {all ? 'fewer' : `all ${g.players.length}`}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="px-3 py-3 text-[12px] text-ff-muted">No one in this league starts a player in this game.</p>
      )}
    </Panel>
  )
}

const SlateView = ({ data, analysis, sub, onSub }: { data: LeagueData; analysis: Analysis; sub: string | null; onSub: (s: string) => void }) => {
  const { models } = useFantasy()
  const tab: Sub = SUBS.includes(sub as Sub) ? (sub as Sub) : 'week'
  const stacked = usePhone()
  const players = data.players
  const me = analysis.myRosterId
  const { slate, live, week, proj, totals, read } = useMatchups()
  // Games as full cards or as a grid of tiles that open a sheet; remembered in this browser.
  const [view, setView] = useState<'list' | 'grid'>('list')
  useEffect(() => {
    try {
      if (window.localStorage.getItem('ff:slate:view') === 'grid') setView('grid')
    } catch {
      // Storage blocked: the list it is.
    }
  }, [])
  const pickView = (v: 'list' | 'grid') => {
    setView(v)
    try {
      window.localStorage.setItem('ff:slate:view', v)
    } catch {
      // Storage blocked: the choice lasts this visit.
    }
  }
  const gameByKey = useMemo(() => Object.fromEntries(slate.games.map((g) => [g.key, g])), [slate.games])
  const mine = me != null ? slate.managers[me] : null
  const opp = mine?.opponent ?? null
  const matchup = slate.matchups.find((m) => m.a.rosterId === me || m.b.rosterId === me)
  const mySide = matchup ? (matchup.a.rosterId === me ? matchup.a : matchup.b) : null
  const oppSide = matchup ? (matchup.a.rosterId === me ? matchup.b : matchup.a) : null
  const finals = slate.games.filter((g) => g.final).length
  const yours = me != null && opp != null ? read(me, opp) : null
  const name = (id: number | null) => (id == null ? '–' : (analysis.teamById[id]?.name ?? '–'))
  const label = (g: SlateGame) => `${g.away} @ ${g.home}`

  if (!live || !slate.games.length) {
    return (
      <>
        <PageHeader title="Gameday" />
        <div className="mt-4">
          <Empty title="No NFL week in progress">Gameday reads the current week&apos;s games against this league&apos;s matchups. It comes back with the regular season.</Empty>
        </div>
      </>
    )
  }

  // ---- Things to watch, for you: the few facts that decide your week, each as a sentence. ----
  const watch: Reason[] = []
  if (mine && mySide && oppSide) {
    const st = mine.stakes
    if (st) {
      const gap = st.win.playoffs - st.loss.playoffs
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">A win is worth {pts(gap)} points of playoff odds.</b> {pct(st.win.playoffs)} with it, {pct(st.loss.playoffs)} without.
          </>
        ),
        tone: gap >= 0.12 ? 'warn' : 'neutral',
      })
    }
    const top = mine.games[0] && gameByKey[mine.games[0].key]
    if (top && mine.games[0].swing > 0.02) {
      const g = mine.games[0]
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">{label(top)} decides the most.</b> {g.mine.length ? `Yours: ${g.mine.map((id) => players[id]?.name).join(', ')}. ` : ''}
            {g.theirs.length ? `Theirs: ${g.theirs.map((id) => players[id]?.name).join(', ')}. ` : ''}Your odds swing ±{pts(g.swing / 2)} on it.
          </>
        ),
        tone: 'neutral',
      })
    }
    const myBest = mySide.starters
      .map((id) => slate.byId[id])
      .filter((p): p is SlatePlayer => !!p && p.actual == null)
      .sort((a, b) => b.swing - a.swing)[0]
    if (myBest)
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">{players[myBest.id]?.name} is your biggest swing.</b> {fmt(myBest.low)} to {fmt(myBest.high)} points moves your odds ±
            {pts(myBest.swing / 2)}.
          </>
        ),
        tone: 'neutral',
      })
    const theirBest = oppSide.starters
      .map((id) => slate.byId[id])
      .filter((p): p is SlatePlayer => !!p && p.actual == null)
      .sort((a, b) => b.swing - a.swing)[0]
    if (theirBest)
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">Their threat is {players[theirBest.id]?.name}</b> ({theirBest.pos}, {theirBest.team}): projected {fmt(theirBest.proj)}, up to{' '}
            {fmt(theirBest.high)} on a good day.
          </>
        ),
        tone: 'warn',
      })
    // A starter projected for nothing: out, or on a bye the lineup missed.
    const empty = mySide.starters.filter((id) => !slate.byId[id] || (slate.byId[id].proj <= 0 && slate.byId[id].actual == null))
    if (empty.length)
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">{empty.map((id) => players[id]?.name).join(', ')} projected for zero.</b> Out or on a bye: that slot scores nothing unless you
            swap him.
          </>
        ),
        tone: 'neg',
      })
    // Questionable starters, each with the bench player who would take his spot.
    const doubtful = mySide.starters.filter((id) => data.context[id]?.notes.some((n) => n.kind === 'status') && slate.byId[id]?.actual == null)
    if (doubtful.length) {
      const starting = new Set(mySide.starters)
      const bench = (analysis.teamById[me!]?.players ?? []).filter((id) => !starting.has(id) && (proj[id] ?? 0) > 0)
      const fallback = (id: string) => bench.filter((b) => players[b]?.pos === players[id]?.pos).sort((x, y) => (proj[y] ?? 0) - (proj[x] ?? 0))[0]
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">{doubtful.length === 1 ? `${players[doubtful[0]]?.name} is` : `${doubtful.length} starters are`} questionable.</b>{' '}
            {doubtful
              .map((id) => {
                const f = fallback(id)
                return `${players[id]?.name.split(' ').slice(-1)[0]} (${fmt(proj[id])})${f ? `: ${players[f]?.name} is next up at ${fmt(proj[f])}` : ': no bench option at his position'}`
              })
              .join('; ')}
            .
          </>
        ),
        tone: 'neg',
      })
    }
    const shared = mine.games.filter((g) => g.mine.length && g.theirs.length)
    if (shared.length)
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">You meet inside {shared.map((g) => label(gameByKey[g.key])).join(', ')}.</b> A big day there helps one of you, not both.
          </>
        ),
        tone: 'neutral',
      })
    const finalsMine = mySide.starters.map((id) => slate.byId[id]).filter((p): p is SlatePlayer => !!p && p.realized != null && Math.abs(p.realized) >= 0.03)
    for (const p of finalsMine.sort((a, b) => Math.abs(b.realized!) - Math.abs(a.realized!)).slice(0, 2))
      watch.push({
        text: (
          <>
            <b className="font-medium text-ff-text">
              {players[p.id]?.name} scored {fmt(p.actual)}
            </b>{' '}
            ({fmtSigned(p.actual! - p.proj)} against the projection): your win odds {p.realized! > 0 ? 'up' : 'down'} {pts(Math.abs(p.realized!))} points.
          </>
        ),
        tone: p.realized! > 0 ? 'pos' : 'neg',
      })
  }

  // ---- Player rows, shared by every game card. ----
  const playerCols = (max: number): Column<SlatePlayer>[] => [
    {
      key: 'p',
      label: 'Player',
      sticky: true,
      render: (p) => <PlayerName player={players[p.id]} id={p.id} size={22} sub={<ManagerTag id={p.owner} me={me} opp={opp} />} />,
    },
    {
      key: 'proj',
      label: 'Pts',
      align: 'right',
      title: 'Points: final, live, or projected (dotted) with his 20th to 80th percentile game below',
      render: (p) =>
        p.actual != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <Pts value={p.actual} kind="final" />
            <span className={cx('text-[10px]', p.actual >= p.proj ? 'text-ff-pos' : 'text-ff-neg')}>{fmtSigned(p.actual - p.proj)} vs proj</span>
          </span>
        ) : p.live != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <Pts value={p.live} kind="live" />
            <span className="text-[10px] text-ff-muted">of {fmt(p.proj)} projected</span>
          </span>
        ) : (
          <span className="inline-flex flex-col items-end leading-tight">
            <Pts value={p.proj} kind="proj" />
            <span className="mt-0.5 text-[10px] text-ff-muted">
              {fmt(p.low, 0)}–{fmt(p.high, 0)}
            </span>
          </span>
        ),
    },
    { key: 'range', label: 'Range', hideBelow: 'sm', render: (p) => <RangeBar p={p} max={max} /> },
    {
      key: 'swing',
      label: 'Win odds',
      align: 'right',
      title: "How far his game moves his manager's win odds, a bad game against a good one. Final: what it did, against his projection.",
      sort: (p) => p.swing || Math.abs(p.realized ?? 0),
      render: (p) =>
        p.realized != null ? (
          <span className={cx(p.realized > 0.005 ? 'text-ff-pos' : p.realized < -0.005 ? 'text-ff-neg' : 'text-ff-muted')}>{pts(p.realized, true)}</span>
        ) : (
          <span className="text-ff-text">±{pts(p.swing / 2)}</span>
        ),
    },
    {
      key: 'standing',
      label: 'Playoffs',
      align: 'right',
      hideBelow: 'md',
      title: 'Playoff odds riding on his game: the swing in win odds times what a win is worth to his manager',
      render: (p) =>
        p.standing == null ? (
          <span className="text-ff-muted">…</span>
        ) : (
          <span className="text-ff-text2">{p.realized != null ? pts(p.standing, true) : `±${pts(p.standing / 2)}`}</span>
        ),
    },
  ]
  const playerWhy = (p: SlatePlayer) => {
    const owner = name(p.owner)
    const st = slate.managers[p.owner]?.stakes
    const items: Reason[] = []
    if (p.actual != null)
      items.push({
        text: `Scored ${fmt(p.actual)} against a projection of ${fmt(p.proj)}, which moved ${owner}'s win odds ${pts(p.realized ?? 0, true)} points`,
        tone: (p.realized ?? 0) > 0.005 ? 'pos' : (p.realized ?? 0) < -0.005 ? 'neg' : 'neutral',
      })
    else {
      items.push({ text: `Projected ${fmt(p.proj)}; a bad game is about ${fmt(p.low)}, a good one ${fmt(p.high)} (20th and 80th percentile)`, tone: 'neutral' })
      items.push({ text: `Between those two games, ${owner}'s win odds move ${pts(p.swing)} points`, tone: p.swing >= 0.15 ? 'warn' : 'neutral' })
    }
    if (st && p.standing != null)
      items.push({
        text: `A win is worth ${pts(st.win.playoffs - st.loss.playoffs)} points of playoff odds to ${owner}, so about ${pts(Math.abs(p.standing))} ride on him`,
        tone: 'neutral',
      })
    const tt = totals[p.team]
    if (tt)
      items.push({
        text: `${p.team} is projected to score ${fmt(tt.pts)} (${tt.source === 'market' ? 'from betting lines' : "from Sleeper's projections"})`,
        tone: tt.pts >= 26 ? 'pos' : tt.pts <= 18 ? 'neg' : 'neutral',
      })
    items.push(...contextReasons(data.context[p.id], players))
    return <Reasons items={items} />
  }

  const maxSwing = Math.max(0.05, ...slate.games.map((g) => g.swing))
  const byDay = slate.games.reduce<Record<string, SlateGame[]>>((acc, g) => ((acc[g.final ? 'Final' : dayOf(g.date)] ??= []).push(g), acc), {})

  return (
    <>
      <PageHeader
        title="Gameday"
        meta={`week ${week} · ${finals} of ${slate.games.length} games final`}
        tabs={
          <Tabs<Sub>
            value={tab}
            onChange={onSub}
            stacked={stacked}
            items={[
              { key: 'week', label: 'Your week' },
              { key: 'games', label: 'Games', count: slate.games.length },
              { key: 'managers', label: 'Every manager', count: slate.matchups.length * 2 },
            ]}
          />
        }
      />
      <div className="mt-4 space-y-3">
        <TabSection id="week" label="Your week" active={tab === 'week'} stacked={stacked}>
          {mine && mySide && oppSide ? (
            <>
              {yours && (
                <section aria-label="Your matchup" className="border border-ff-line bg-ff-panel px-3 py-4 sm:px-5">
                  <MatchupScore m={yours} />
                </section>
              )}
              <StatGrid>
                <Stat
                  label="Win odds"
                  value={odds(mine.win)}
                  meter={mine.win}
                  badge={{ text: mine.win >= 0.6 ? 'favored' : mine.win <= 0.4 ? 'underdog' : 'toss-up', tone: mine.win >= 0.6 ? 'pos' : mine.win <= 0.4 ? 'neg' : 'warn' }}
                  sub={`vs ${name(opp)} · ${fmt(mySide.mu)}–${fmt(oppSide.mu)}`}
                />
                <Stat
                  label="On the line"
                  value={mine.stakes ? `${pts(mine.stakes.win.playoffs - mine.stakes.loss.playoffs)}pt` : '…'}
                  sub={mine.stakes ? `playoff odds: ${pct(mine.stakes.win.playoffs)} with a win, ${pct(mine.stakes.loss.playoffs)} without` : 'simulating the season both ways'}
                />
                <Stat label="Banked" value={fmt(mySide.banked)} sub={`${mySide.left} starter${mySide.left === 1 ? '' : 's'} still to play · they have ${fmt(oppSide.banked)}`} />
                <Stat
                  label="Game to watch"
                  value={mine.games[0] ? label(gameByKey[mine.games[0].key]) : '–'}
                  sub={mine.games[0] ? `moves your win odds ±${pts(mine.games[0].swing / 2)}` : 'nothing left to play'}
                />
              </StatGrid>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <Panel title="Things to watch" actions={<span>your matchup, in sentences</span>} pad={false}>
                  {watch.length ? <Reasons items={watch} columns={1} /> : <p className="px-3 py-3 text-[12px] text-ff-muted">Nothing stands out yet.</p>}
                </Panel>
                <Panel title="What decides it" actions={<span>games, by your win odds at stake</span>} pad={false}>
                  <ul>
                    {mine.games.slice(0, 6).map((g) => {
                      const game = gameByKey[g.key]
                      const maxSwing = Math.max(0.05, mine.games[0]?.swing ?? 0)
                      return (
                        <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-ff-line/60 px-3 py-2 last:border-0">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="font-mono text-[12px] font-semibold text-ff-text">{label(game)}</span>
                            <span className="font-mono text-[10.5px] text-ff-muted">{game.final ? 'final' : dayOf(game.date)}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-16 bg-ff-line" aria-hidden>
                              <span className="block h-full bg-ff-accent" style={{ width: `${(g.swing / maxSwing) * 100}%` }} />
                            </span>
                            <span className="num w-9 text-right text-[12px] text-ff-text">±{pts(g.swing / 2)}</span>
                          </span>
                          <span className="col-span-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
                            {g.mine.length > 0 && (
                              <span className="text-ff-text2">
                                <span className="text-ff-accent">yours</span> {g.mine.map((id) => players[id]?.name.split(' ').slice(-1)[0]).join(', ')}
                              </span>
                            )}
                            {g.theirs.length > 0 && (
                              <span className="text-ff-text2">
                                <span className="text-ff-neg">theirs</span> {g.theirs.map((id) => players[id]?.name.split(' ').slice(-1)[0]).join(', ')}
                              </span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
                    How far each game moves your win odds, from a bad day to a good one for everyone in it. Ranges come from each position&apos;s weekly spread this season, scaled
                    to the league&apos;s weekly noise (σ {fmt(models.forecast?.sigma ?? models.forecastInput.sigmaFallback)}).
                  </p>
                </Panel>
              </div>
              {yours && (
                <Panel title="Lineups, slot by slot" actions={<span>edge: expected points, yours left</span>} pad={false}>
                  <SlotTable m={yours} />
                </Panel>
              )}
            </>
          ) : (
            <Empty title="No matchup for you this week">You are not paired this week, or Sleeper has not set the week&apos;s matchups yet.</Empty>
          )}
        </TabSection>

        <TabSection id="games" label="Games" count={slate.games.length} active={tab === 'games'} stacked={stacked}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ff-muted">{view === 'grid' ? 'Open a game for its league starters.' : 'Every league starter, game by game.'}</span>
            <Segmented<'list' | 'grid'>
              size="sm"
              label="Games view"
              value={view}
              onChange={pickView}
              options={[
                { key: 'list', label: 'List', title: 'Full cards with every league starter' },
                { key: 'grid', label: 'Grid', title: 'A tile per game; open one for the detail' },
              ]}
            />
          </div>
          {Object.entries(byDay).map(([day, gs]) => (
            <div key={day} className="space-y-2">
              <div className="ff-label">
                {day}
                <span className="num ml-1.5 text-ff-muted">
                  · {gs.length} {gs.length === 1 ? 'game' : 'games'}
                </span>
              </div>
              {view === 'grid' ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {gs.map((g) => (
                    <GameTile key={g.key} g={g} maxSwing={maxSwing} me={me} opp={opp} isKey={mine?.games[0]?.key === g.key} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                  {gs.map((g) => (
                    <GameCard key={g.key} g={g} columns={playerCols} expand={playerWhy} isKey={mine?.games[0]?.key === g.key} />
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ff-muted">
            Win odds: how far a player&apos;s game moves his manager&apos;s chance this week, bad game (20th percentile) to good (80th). Playoffs: the same in playoff odds. Final
            games show what the result did. Numbers beside teams are projected points.
          </p>
        </TabSection>

        <TabSection id="managers" label="Every manager" active={tab === 'managers'} stacked={stacked} bare>
          <Panel title="Every manager's week" actions={<span>win odds · what a win is worth · the game that decides it</span>} pad={false}>
            <div className="grid grid-cols-1 gap-px bg-ff-line/60 sm:grid-cols-2 xl:grid-cols-3">
              {Object.values(slate.managers)
                .sort(
                  (a, b) =>
                    Number(b.rosterId === me) - Number(a.rosterId === me) ||
                    (b.stakes ? b.stakes.win.playoffs - b.stakes.loss.playoffs : 0) - (a.stakes ? a.stakes.win.playoffs - a.stakes.loss.playoffs : 0),
                )
                .map((m) => {
                  const key = m.games[0] ? gameByKey[m.games[0].key] : null
                  const rider = slate.matchups
                    .flatMap((x) => (x.a.rosterId === m.rosterId ? x.a.starters : x.b.rosterId === m.rosterId ? x.b.starters : []))
                    .map((id) => slate.byId[id])
                    .filter((p): p is SlatePlayer => !!p && p.actual == null)
                    .sort((a, b) => b.swing - a.swing)[0]
                  const gap = m.stakes ? m.stakes.win.playoffs - m.stakes.loss.playoffs : null
                  return (
                    <div key={m.rosterId} className={cx('min-w-0 space-y-2 bg-ff-panel px-3 py-2.5', m.rosterId === me && 'shadow-[inset_2px_0_0_rgb(var(--ff-accent))]')}>
                      <div className="flex min-w-0 items-center justify-between gap-2 text-[13px]">
                        <ManagerTag id={m.rosterId} me={me} opp={opp} avatar />
                        <span className={cx('num shrink-0 text-[15px] font-medium', m.win >= 0.6 ? 'text-ff-pos' : m.win <= 0.4 ? 'text-ff-neg' : 'text-ff-text')}>
                          {odds(m.win)}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-ff-muted">
                        vs <span className="text-ff-text2">{name(m.opponent)}</span>
                        {gap != null && (
                          <>
                            {' '}
                            · a win is worth <span className={cx('num', gap >= 0.12 ? 'text-ff-warn' : 'text-ff-text2')}>{pts(gap)}pt</span> of playoff odds
                          </>
                        )}
                      </div>
                      <div className="space-y-0.5 text-[12px] leading-[1.45] text-ff-text2">
                        {key && (
                          <div>
                            <span className="text-ff-muted">Watch</span> <span className="font-mono text-[11.5px] text-ff-text">{label(key)}</span>{' '}
                            <span className="num text-ff-muted">±{pts(m.games[0].swing / 2)}</span>
                          </div>
                        )}
                        {rider && (
                          <div>
                            <span className="text-ff-muted">Rides on</span> {players[rider.id]?.name} <span className="num text-ff-muted">±{pts(rider.swing / 2)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              <GridFill n={Object.keys(slate.managers).length} wide="xl" />
            </div>
          </Panel>
        </TabSection>
      </div>
    </>
  )
}

export default SlateView
