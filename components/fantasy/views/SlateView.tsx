import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { SlateGame, SlatePlayer } from '../../../lib/fantasy/slate'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import { sectionCode } from '../Shell'
import { useSlate } from '../useSlate'
import {
  Avatar,
  Badge,
  Empty,
  GridFill,
  PageHeader,
  Panel,
  Reasons,
  Stat,
  StatGrid,
  Table,
  TabSection,
  Tabs,
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

/** Win-odds points, signed: "+12". */
const pts = (x: number, signed = false) => `${signed && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(0)}`
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayOf = (date: string | null) => (date ? DAY.format(new Date(`${date}T12:00:00Z`)) : 'TBD')
const odds = (p: number) => (p >= 0.995 ? '>99%' : p <= 0.005 ? '<1%' : pct(p))

/** A player's game as a band: 20th to 80th percentile, his projection as a tick, and what he scored once it is final. */
const RangeBar = ({ p, max }: { p: SlatePlayer; max: number }) => {
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  const tone = p.actual == null ? '' : p.actual >= p.proj ? 'bg-ff-pos' : 'bg-ff-neg'
  return (
    <span className="relative block h-3 w-full min-w-[72px] max-w-[140px]" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-ff-line" />
      <span className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-ff-accent/25" style={{ left: x(p.low), width: `calc(${x(p.high)} - ${x(p.low)})` }} />
      <span className="absolute top-0 h-3 w-px bg-ff-text2" style={{ left: x(p.proj) }} />
      {p.actual != null && <span className={cx('absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2', tone)} style={{ left: x(p.actual) }} />}
    </span>
  )
}

/** A manager as a compact tag: avatar and name, marked when it is you or your opponent. */
const ManagerTag = ({ id, me, opp, avatar }: { id: number; me: number | null; opp: number | null; avatar?: boolean }) => {
  const { analysis } = useFantasy()
  const t = analysis.teamById[id]
  if (!t) return null
  const tone = id === me ? 'font-medium text-ff-accent' : id === opp ? 'text-ff-neg' : 'text-ff-text2'
  // In a table cell the name alone, so it can truncate with an ellipsis; the avatar only where there is room.
  if (!avatar) return <span className={tone}>{t.name}</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar src={t.avatar} name={t.name} size={16} />
      <span className={cx('truncate', tone)}>{t.name}</span>
    </span>
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
  const max = Math.max(10, ...g.players.map((p) => Math.max(p.high, p.actual ?? 0)))
  const rows = all ? g.players : g.players.slice(0, 6)
  const involved = isKey
  return (
    <Panel
      className={cx(involved && 'border-ff-accent/40')}
      pad={false}
      title={
        <span className="flex items-baseline gap-2 normal-case tracking-normal">
          <span className="font-mono text-[12px] font-semibold text-ff-text">
            {g.away}
            {g.totals.away && <span className="ml-1 font-normal text-ff-muted">{fmt(g.totals.away.pts)}</span>}
            <span className="mx-1.5 font-normal text-ff-muted">@</span>
            {g.home}
            {g.totals.home && <span className="ml-1 font-normal text-ff-muted">{fmt(g.totals.home.pts)}</span>}
          </span>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          {involved && <Badge tone="accent">decides your week</Badge>}
          {g.final ? <span className="text-ff-text2">Final</span> : <span>{dayOf(g.date)}</span>}
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
  const { slate, live, week, proj, totals } = useSlate(data, analysis)
  const gameByKey = useMemo(() => Object.fromEntries(slate.games.map((g) => [g.key, g])), [slate.games])
  const mine = me != null ? slate.managers[me] : null
  const opp = mine?.opponent ?? null
  const matchup = slate.matchups.find((m) => m.a.rosterId === me || m.b.rosterId === me)
  const mySide = matchup ? (matchup.a.rosterId === me ? matchup.a : matchup.b) : null
  const oppSide = matchup ? (matchup.a.rosterId === me ? matchup.b : matchup.a) : null
  const finals = slate.games.filter((g) => g.final).length
  const name = (id: number | null) => (id == null ? '–' : (analysis.teamById[id]?.name ?? '–'))
  const label = (g: SlateGame) => `${g.away} @ ${g.home}`

  if (!live || !slate.games.length) {
    return (
      <>
        <PageHeader code={sectionCode('slate')} title="Gameday" />
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
            {g.theirs.length ? `Theirs: ${g.theirs.map((id) => players[id]?.name).join(', ')}. ` : ''}Between a bad and a good day for them, your odds move ±{pts(g.swing / 2)}.
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
            <b className="font-medium text-ff-text">{players[myBest.id]?.name} carries the most risk.</b> Between a {fmt(myBest.low)}-point game and a {fmt(myBest.high)}-point one,
            your win odds move ±{pts(myBest.swing / 2)}.
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
            <b className="font-medium text-ff-text">Head to head inside one game:</b> {shared.map((g) => label(gameByKey[g.key])).join(', ')}. A big day for one offense helps one
            of you and not the other.
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
      label: 'Proj',
      align: 'right',
      title: 'Projected points; his 20th to 80th percentile game below',
      render: (p) =>
        p.actual != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className="text-ff-text">{fmt(p.actual)}</span>
            <span className={cx('text-[10px]', p.actual >= p.proj ? 'text-ff-pos' : 'text-ff-neg')}>{fmtSigned(p.actual - p.proj)} vs proj</span>
          </span>
        ) : (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className="text-ff-text">{fmt(p.proj)}</span>
            <span className="text-[10px] text-ff-muted">
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

  const byDay = slate.games.reduce<Record<string, SlateGame[]>>((acc, g) => ((acc[g.final ? 'Final' : dayOf(g.date)] ??= []).push(g), acc), {})

  return (
    <>
      <PageHeader
        code={sectionCode('slate')}
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
                    How far each game moves your win odds, between a bad and a good day for everyone in it on both sides (± half the gap). Each starter&apos;s range is his
                    position&apos;s week-to-week spread this season, scaled so a full lineup carries the league&apos;s weekly noise (σ{' '}
                    {fmt(models.forecast?.sigma ?? models.forecastInput.sigmaFallback)}).
                  </p>
                </Panel>
              </div>
            </>
          ) : (
            <Empty title="No matchup for you this week">You are not paired this week, or Sleeper has not set the week&apos;s matchups yet.</Empty>
          )}
        </TabSection>

        <TabSection id="games" label="Games" count={slate.games.length} active={tab === 'games'} stacked={stacked}>
          {Object.entries(byDay).map(([day, gs]) => (
            <div key={day} className="space-y-2">
              <div className="ff-label">
                {day} <span className="num ml-1">{gs.length}</span>
              </div>
              <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                {gs.map((g) => (
                  <GameCard key={g.key} g={g} columns={playerCols} expand={playerWhy} isKey={mine?.games[0]?.key === g.key} />
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ff-muted">
            Win odds: how far a player&apos;s game moves his manager&apos;s chance to win this week, between a bad (20th percentile) and a good (80th) game, shown as ±. Playoffs:
            the same in playoff odds, from what a win is worth to that manager. Final games show what the result did instead. Team totals next to each team are projected points.
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
