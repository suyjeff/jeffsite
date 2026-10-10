import React, { useMemo, useState } from 'react'
import { pastProjection } from '../../../lib/fantasy/analysis'
import { deadStarters } from '../../../lib/fantasy/lineup'
import { surname } from '../../../lib/fantasy/scout'
import { isWaiverFill, makeLineupEval } from '../../../lib/fantasy/trades'
import { searchTrades, waiverTargets } from '../../../lib/fantasy/search'
import AdjustControl from '../AdjustControl'
import LinesBlock from '../LinesBlock'
import { describeNote } from '../ContextNotes'
import { useFantasy, useTradeRead } from '../FantasyContext'
import { countLine, useMatchups } from '../matchup'
import FreeAgentPick, { bestFreeAgent, FreeAgentName } from '../FreeAgentPick'
import TeamName from '../TeamName'
import { MoveList, useMoves } from '../Moves'
import { ruledOutBy } from '../../../lib/fantasy/grades'
import PlayerName from '../PlayerName'
import { Avatar, Badge, CenterMeter, RowCover, WinBar, Empty, Num, PlayerAvatar, PosTag, Pts, ScoreState, Segmented, Sparkline, ago, compact, cx, fmt, fmtSigned, isOut, ownerLabel, simOdds, pct } from '../ui'

/** A widget reads and writes the selection on its channel: a team, a player, or both. */
export type Selection = { team?: number; player?: string }
export type WidgetProps = { sel: Selection; select: (s: Selection) => void; w: number; h: number }

export type WidgetKind =
  | 'matchup'
  | 'odds'
  | 'scoreboard'
  | 'trades'
  | 'lineup'
  | 'power'
  | 'standings'
  | 'injuries'
  | 'waivers'
  | 'player'
  | 'team'
  | 'consensus'
  | 'activity'
  | 'props'
  | 'gameday'
  | 'moves'

type Meta = { title: string; blurb: string; w: number; h: number; Body: (p: WidgetProps) => JSX.Element; reads?: 'team' | 'player' }

// ---------- Shared bits ----------

/**
 * A list row. When it selects something, a full-row button sits behind the content, so the row is
 * one click target without wrapping the player names (themselves buttons) in another button.
 */
const Row = ({ children, onClick, active, className, label }: { children: React.ReactNode; onClick?: () => void; active?: boolean; className?: string; label?: string }) => (
  <div className={cx('relative flex h-8 items-center gap-2 border-b border-ff-line/60 px-3 text-[12.5px] last:border-0', onClick && 'hover:bg-ff-raised', active && 'bg-ff-raised', className)}>
    {onClick && <RowCover label={label ?? 'Select'} onClick={onClick} pressed={active ?? false} />}
    {children}
  </div>
)

const Th = ({ children }: { children: React.ReactNode }) => <div className="ff-label sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-ff-line bg-ff-panel px-3">{children}</div>

/** A bar inside a cell: hairline track, solid fill, square ends. */
const Bar = ({ value, max = 1, slot = 'accent', width = 48 }: { value: number; max?: number; slot?: string; width?: number }) => (
  <span className="inline-block h-[6px] bg-ff-sunken align-middle" style={{ width }}>
    <span className="block h-full" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: `rgb(var(--ff-${slot}))` }} />
  </span>
)

/** A manager in a widget row: the app's one team name, small. `plain` inside another control. */
const TeamTag = ({ id, plain }: { id: number; plain?: boolean }) => <TeamName id={id} size={16} plain={plain} />

const NoForecast = () => <Empty title="No forecast">Needs Sleeper projections for the weeks ahead.</Empty>

// ---------- Widgets ----------

/**
 * Teams whose lineup in Sleeper has a starter who cannot score this week (bye,
 * out, or an empty slot), with what that lineup projects as set. The forecast
 * already assumes the best lineup, so this only explains a gap with Sleeper.
 */
const useUnsetLineups = (week: number | null) => {
  const { data, analysis } = useFantasy()
  return useMemo(() => {
    const out: Record<number, { names: string[]; asSet: number }> = {}
    const h = week != null ? data.horizon.find((x) => x.week === week) : null
    if (!h) return out
    for (const m of data.matchupsByWeek[week!] ?? []) {
      const dead = deadStarters(analysis.slots, m.starters ?? undefined, h.pts)
      if (!dead.length) continue
      const asSet = (m.starters ?? []).reduce((a, id) => a + (id && id !== '0' ? (h.pts[id] ?? 0) : 0), 0)
      out[m.roster_id] = { names: dead.map((d) => (d.id ? (data.players[d.id]?.name ?? d.id) : `empty ${d.slot.name}`)), asSet }
    }
    return out
  }, [week, data, analysis.slots])
}

const unsetNote = (u: { names: string[]; asSet: number }) =>
  `Lineup not set: ${u.names.join(', ')} can't score this week. As set in Sleeper it projects ${fmt(u.asSet)}; this assumes the manager swaps in the best option.`

/** This week's pairings with each side's expectation and win probability. */
const Scoreboard = ({ sel, select }: WidgetProps) => {
  const { models, data } = useFantasy()
  const f = models.forecast
  const unset = useUnsetLineups(f?.nextWeek[0]?.week ?? null)
  const { read, week: slateWeek } = useMatchups()
  if (!f || !f.nextWeek.length) return <NoForecast />
  const week = f.nextWeek[0].week
  const live = data.matchupsByWeek[week] ?? []
  const pts = (rid: number) => live.find((m) => m.roster_id === rid)?.points ?? 0
  // Once the week has started, every row shows points scored; before, every row shows expectations. Never a mix.
  const started = live.some((m) => (m.points ?? 0) > 0)
  // Final once every NFL game of the week is (by status, or by the calendar when the status lags).
  const today = new Date().toISOString().slice(0, 10)
  const weekGames = (data.schedule?.games ?? []).filter((x) => x.week === week && x.status !== 'canceled')
  const done = weekGames.length > 0 && weekGames.every((x) => x.status === 'complete' || (!!x.date && x.date < today))
  const kind = !started ? 'proj' : done ? 'final' : 'live'
  // Each side as the slate reads it, once the week is on: points banked, and starters still to play under them.
  const sideOf = (a: number, b: number, k: 'a' | 'b') => {
    const r = started && slateWeek === week ? read(a, b) : null
    if (!r) return null
    const c = k === 'a' ? r.countA : r.countB
    return { value: k === 'a' ? r.a.banked : r.b.banked, kind: k === 'a' ? r.kindA : r.kindB, toGo: c.left + c.live }
  }
  const score = (g: (typeof f.nextWeek)[number], k: 'a' | 'b') => {
    const sd = sideOf(g.a, g.b, k)
    if (!sd) return <Pts value={started ? pts(k === 'a' ? g.a : g.b) : k === 'a' ? g.muA : g.muB} kind={kind} />
    return (
      <span className={cx('flex flex-col leading-none', k === 'a' ? 'items-end' : 'items-start')} title={`${sd.toGo} starter${sd.toGo === 1 ? '' : 's'} still to play or playing`}>
        <Pts value={sd.value} kind={sd.kind} className={sd.kind === 'proj' ? undefined : 'font-medium'} />
        <span className="mt-0.5 font-mono text-[10px] text-ff-muted">{sd.toGo ? `${sd.toGo} to go` : 'done'}</span>
      </span>
    )
  }
  return (
    <div>
      <Th>
        <span className="w-full">wk {week}</span>
        <span className="shrink-0">{started ? 'pts' : 'exp'}</span>
        <span className="w-16 shrink-0 text-center" title={started ? 'Pre-game win probability' : undefined}>
          {started ? 'pre' : 'win'}
        </span>
        <span className="shrink-0">{started ? 'pts' : 'exp'}</span>
      </Th>
      {f.nextWeek.map((g) => (
        <Row key={`${g.a}-${g.b}`} active={sel.team === g.a || sel.team === g.b} className={started ? 'h-10' : undefined}>
          <button onClick={() => select({ team: g.a })} className="min-w-0 flex-1 text-left">
            <TeamTag id={g.a} plain />
          </button>
          <span className="num flex w-12 shrink-0 justify-end text-right text-ff-text" title={!started && unset[g.a] ? unsetNote(unset[g.a]) : undefined}>
            {!started && unset[g.a] && <span className="text-ff-warn">*</span>}
            {score(g, 'a')}
          </span>
          <span className="flex w-16 shrink-0 items-center gap-1">
            <span className="num w-7 text-right text-[10.5px] text-ff-text2">{Math.round(g.pA * 100)}</span>
            <WinBar p={g.pA} />
          </span>
          <span className="num flex w-12 shrink-0 text-ff-text" title={!started && unset[g.b] ? unsetNote(unset[g.b]) : undefined}>
            {score(g, 'b')}
            {!started && unset[g.b] && <span className="text-ff-warn">*</span>}
          </span>
          <button onClick={() => select({ team: g.b })} className="flex min-w-0 flex-1 justify-end text-right">
            <TeamTag id={g.b} plain />
          </button>
        </Row>
      ))}
      <div className="px-3 py-1.5 font-mono text-[10px] text-ff-muted">
        bar = left team&apos;s pre-game chance · {started ? 'points banked so far, starters to go under each' : 'scores are expectations'}
        {!started && Object.keys(unset).length > 0 && <> · <span className="text-ff-warn">*</span> lineup has a bye/out starter; expectation assumes the swap</>}
      </div>
    </div>
  )
}

/** Season simulation: projected wins, playoff, bye and title odds. */
const Odds = ({ sel, select }: WidgetProps) => {
  const { models, analysis } = useFantasy()
  const f = models.forecast
  if (!f) return <NoForecast />
  const rows = [...f.ratings].sort((a, b) => f.sim[b.rosterId].title - f.sim[a.rosterId].title || f.sim[b.rosterId].playoffs - f.sim[a.rosterId].playoffs)
  const maxTitle = Math.max(0.01, ...rows.map((r) => f.sim[r.rosterId].title))
  return (
    <div>
      <Th>
        <span className="flex-1">team</span>
        <span className="hidden w-9 text-right sm:inline">rec</span>
        <span className="w-10 text-right" title="Expected points per week">rtg</span>
        <span className="hidden w-9 text-right sm:inline" title="Mean simulated wins">W</span>
        <span className="w-10 text-right">PO</span>
        <span className="hidden w-9 text-right sm:inline">bye</span>
        <span className="w-[78px] text-right">title</span>
      </Th>
      {rows.map((r) => {
        const s = f.sim[r.rosterId]
        const season = analysis.seasonById[r.rosterId]
        return (
          <Row key={r.rosterId} onClick={() => select({ team: r.rosterId })} active={sel.team === r.rosterId} label={`Follow ${analysis.teamById[r.rosterId]?.name ?? 'team'}`}>
            <span className="min-w-0 flex-1">
              <TeamTag id={r.rosterId} />
            </span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">
              {season.wins}-{season.losses}
            </span>
            <span className="num w-10 text-right text-ff-text">{fmt(r.rating)}</span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">{fmt(s.wins)}</span>
            <span className={cx('num w-10 text-right', s.playoffs >= 0.5 ? 'text-ff-text' : 'text-ff-muted')}>{simOdds(s, 'playoffs')}</span>
            <span className="num hidden w-9 text-right text-ff-text2 sm:inline">{simOdds(s, 'bye')}</span>
            <span className="flex w-[78px] items-center justify-end gap-1.5">
              <Bar value={s.title} max={maxTitle} width={30} />
              <span className="num w-9 text-right text-ff-text">{simOdds(s, 'title', s.title < 0.1 ? 1 : 0)}</span>
            </span>
          </Row>
        )
      })}
    </div>
  )
}

/** Next week's lineups, side by side, from the adjusted projections. */
const useWeekLineup = (rosterId: number | null, week: number | null) => {
  const { data, analysis } = useFantasy()
  return useMemo(() => {
    if (rosterId == null || week == null) return null
    const h = data.horizon.find((x) => x.week === week)
    if (!h) return null
    const ev = makeLineupEval(analysis.slots, data.players, h.pts, analysis.horizonReplacement)
    const res = ev.assign(analysis.teamById[rosterId].players)
    return analysis.slots.map((slot, i) => {
      const p = res.assignments[i]
      return { slot: slot.name.replace('SUPER_FLEX', 'SF'), eligible: slot.eligible, id: p && !isWaiverFill(p.id) ? p.id : null, pts: p ? p.pts : 0 }
    })
  }, [rosterId, week, data, analysis])
}

const Matchup = ({ select }: WidgetProps) => {
  const { models, analysis, data } = useFantasy()
  const f = models.forecast
  const me = analysis.myRosterId
  const game = f?.nextWeek.find((g) => g.a === me || g.b === me)
  const flip = game && game.b === me
  const mine = game ? (flip ? game.b : game.a) : null
  const opp = game ? (flip ? game.a : game.b) : null
  const left = useWeekLineup(mine, game?.week ?? null)
  const right = useWeekLineup(opp, game?.week ?? null)
  const unset = useUnsetLineups(game?.week ?? null)
  const { read, week: slateWeek } = useMatchups()
  if (!f || !game || mine == null || opp == null) return <NoForecast />
  // Once the week is on, the matchup as it stands: Sleeper's lineups as set, banked points, live odds.
  const now = slateWeek === game.week ? read(mine, opp) : null
  const on = !!now?.started
  const p = on ? now!.p : flip ? 1 - game.pA : game.pA
  const muMe = on ? now!.a.mu : flip ? game.muB : game.muA
  const muOpp = on ? now!.b.mu : flip ? game.muA : game.muB
  const gap = muMe - muOpp
  const winPct = Math.round(p * 100)
  const favored = Math.abs(p - 0.5) < 0.03 ? null : p > 0.5 ? mine : opp
  // Why the number is what it is: the slot edges each way, and who on either side might sit.
  const edges = (left ?? []).map((s, i) => ({ slot: s.slot, me: s, them: right?.[i], d: s.pts - (right?.[i]?.pts ?? 0) }))
  const best = edges.reduce<(typeof edges)[number] | null>((a, e) => (e.d > (a?.d ?? 0) ? e : a), null)
  const worst = edges.reduce<(typeof edges)[number] | null>((a, e) => (e.d < (a?.d ?? 0) ? e : a), null)
  const doubtful = [...(left ?? []), ...(right ?? [])].filter((s) => s.id && data.players[s.id]?.injury && !isOut(data.players[s.id]?.injury)).map((s) => surname(data.players[s.id!].name))
  const last = (s?: { id: string | null; eligible: string[] }) => {
    const id = s ? (s.id ?? bestFreeAgent(data, analysis.rosteredBy, s.eligible, game.week)) : null
    return id ? surname(data.players[id]?.name ?? id) : 'a pickup'
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ff-line px-3 pb-2.5 pt-3">
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <TeamTag id={mine} />
          <span className="flex min-w-0 justify-end">
            <TeamTag id={opp} />
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <Pts value={on ? now!.a.banked : muMe} kind={on ? now!.kindA : 'proj'} className="text-[26px] font-medium leading-none tracking-[-0.03em]" />
          <span className="font-mono text-[10.5px] text-ff-muted">wk {game.week} · {on ? 'as it stands' : 'projected'}</span>
          <Pts value={on ? now!.b.banked : muOpp} kind={on ? now!.kindB : 'proj'} className="text-[26px] font-medium leading-none tracking-[-0.03em]" />
        </div>
        {on && (
          // Banked against still to come: how much of each side is already in, and where it is heading.
          <div className="mt-1 flex items-baseline justify-between gap-3 font-mono text-[10px] text-ff-muted">
            <span className="truncate" title={countLine(now!.countA)}>
              {now!.countA.left + now!.countA.live} to go · → <Pts value={muMe} kind="proj" />
            </span>
            <span className="truncate text-right" title={countLine(now!.countB)}>
              → <Pts value={muOpp} kind="proj" /> · {now!.countB.left + now!.countB.live} to go
            </span>
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-2" title={`Win odds: you ${winPct}%, them ${100 - winPct}%`}>
          <span className={cx('num w-9 text-[13px] font-medium', favored === mine ? 'text-ff-text' : 'text-ff-muted')}>{winPct}%</span>
          <WinBar p={p} />
          <span className={cx('num w-9 text-right text-[13px] font-medium', favored === opp ? 'text-ff-text' : 'text-ff-muted')}>{100 - winPct}%</span>
        </div>
        <div className="mt-1 text-center text-[11px] text-ff-text2">
          {favored == null ? 'Even' : favored === mine ? 'You’re favored' : `${analysis.teamById[opp]?.name ?? 'They'} favored`}
          <span className="text-ff-muted"> by </span>
          <span className="num">{fmt(Math.abs(gap))}</span>
          <span className="text-ff-muted"> pts</span>
        </div>
      </div>
      {[mine, opp].map((rid) =>
        unset[rid] && !on ? (
          <div key={rid} className="border-b border-ff-line px-3 py-1.5 text-[11.5px] leading-snug text-ff-text2">
            <span className="text-ff-warn">{rid === mine ? 'Your' : `${analysis.teamById[rid].name}'s`} lineup isn&apos;t set</span>: {unset[rid].names.join(', ')} can&apos;t score. As set it projects{' '}
            <span className="num">{fmt(unset[rid].asSet)}</span>; the {fmt(rid === mine ? muMe : muOpp)} assumes {rid === mine ? 'you swap' : 'they swap'}.
          </div>
        ) : null,
      )}
      <div className="grid flex-1 grid-cols-2 divide-x divide-ff-line">
        {(on
          ? [0, 1].map((k) => now!.rows.map((r) => ({ slot: r.slot, eligible: [] as string[], id: k === 0 ? r.a : r.b, pts: (k === 0 ? r.sa : r.sb)?.value ?? 0, kind: (k === 0 ? r.sa : r.sb)?.kind ?? 'proj' })))
          : [left, right].map((side) => (side ?? []).map((s) => ({ ...s, kind: 'proj' as const })))
        ).map((side, k) => (
          <div key={k}>
            {side.map((s, i) => (
              // A starter whose game is over or on wears a rule on his left edge: ink for final, green for live.
              <div
                key={i}
                className={cx(
                  'flex h-6 items-center gap-2 border-b border-ff-line/60 px-3 text-[12px]',
                  s.kind === 'final' && 'shadow-[inset_2px_0_0_rgb(var(--ff-text2))]',
                  s.kind === 'live' && 'shadow-[inset_2px_0_0_rgb(var(--ff-pos))]',
                )}
              >
                <span className="w-8 shrink-0 font-mono text-[10px] text-ff-muted">{s.slot}</span>
                {s.id ? (
                  <button onClick={() => select({ player: s.id! })} className="min-w-0 flex-1 truncate text-left text-ff-text hover:underline">
                    {data.players[s.id]?.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-ff-text2">
                    {on ? <span className="text-ff-neg">empty</span> : <FreeAgentName eligible={s.eligible} week={game.week} />}
                  </span>
                )}
                <Pts value={s.pts} kind={s.kind} className={cx('shrink-0', s.kind !== 'proj' && 'font-medium')} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <ul className="divide-y divide-ff-line border-t border-ff-line bg-ff-sunken/60 text-[11.5px] leading-snug text-ff-text2 [&>li]:px-3 [&>li]:py-1">
        <li>
          <span className="text-ff-muted">Spread </span>
          <span className="num">σ {fmt(f.sigma)}</span>
          <span className="text-ff-muted"> a team-week, so a </span>
          <span className="num">{fmt(Math.abs(gap))}</span>
          <span className="text-ff-muted"> pt gap is </span>
          <span className="num">{winPct}–{100 - winPct}</span>
        </li>
        {best && best.d >= 1 && (
          <li>
            <span className="text-ff-pos">Your edge</span> <span className="font-mono text-[10.5px] text-ff-muted">{best.slot}</span> {last(best.me)} over {last(best.them)} <span className="num text-ff-pos">+{fmt(best.d)}</span>
          </li>
        )}
        {worst && worst.d <= -1 && (
          <li>
            <span className="text-ff-neg">Their edge</span> <span className="font-mono text-[10.5px] text-ff-muted">{worst.slot}</span> {last(worst.them)} over {last(worst.me)} <span className="num text-ff-neg">{fmtSigned(worst.d, 1)}</span>
          </li>
        )}
        {doubtful.length > 0 && (
          <li>
            <span className="text-ff-warn">Swing</span> {doubtful.slice(0, 4).join(', ')} <span className="text-ff-muted">questionable</span>
          </li>
        )}
      </ul>
    </div>
  )
}

const TradeIdeas = () => {
  const { data, analysis, go, grades } = useFantasy()
  const ideas = useMemo(() => searchTrades(data, analysis).ideas, [data, analysis])
  // One per partner, best for you first, leaving out what your grades ruled out; only those few get a full read.
  const top = useMemo(() => {
    const seen = new Set<number>()
    return [...ideas]
      .filter((i) => !ruledOutBy(i, grades.lessons))
      .sort((a, b) => b.myGain - a.myGain)
      .filter((i) => (seen.has(i.partnerId) ? false : (seen.add(i.partnerId), true)))
  }, [ideas, grades.lessons])
  const readOf = useTradeRead()
  const reads = useMemo(() => new Map(top.map((i) => [i, readOf(i)])), [top, readOf])
  if (!ideas.length) return <Empty title="No deals clear the bar">Loosen the limits on the Trades page.</Empty>
  const name = (id: string) => data.players[id]?.name.split(' ').slice(-1)[0] ?? id
  return (
    <div>
      <Th>
        <span className="w-[120px] shrink-0">partner</span>
        <span className="flex-1">send → get</span>
        <span className="w-12 text-right">you</span>
        <span className="w-12 text-right">them</span>
        <span className="hidden w-16 text-right sm:inline">odds</span>
      </Th>
      {top.map((i) => {
        const read = reads.get(i)!
        return (
          <Row key={`${i.partnerId}-${i.give.join()}-${i.get.join()}`} onClick={() => go('trades')} label={`Open trades with ${analysis.teamById[i.partnerId]?.name ?? 'this team'}`}>
            <span className="w-[120px] shrink-0">
              <TeamTag id={i.partnerId} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              <span className="text-ff-text2">{i.give.map(name).join(' + ')}</span>
              <span className="px-1.5 text-ff-muted">→</span>
              <span className="text-ff-text">{i.get.map(name).join(' + ')}</span>
            </span>
            <Num value={i.myGain} signed className="w-12 text-right" />
            <Num value={i.theirGain} signed className="w-12 text-right" />
            <span className="hidden w-16 text-right font-mono text-[10.5px] sm:inline" title={read.reasons.join('; ')}>
              <span className={read.band === 'likely' ? 'text-ff-pos' : read.band === 'possible' ? 'text-ff-text2' : 'text-ff-muted'}>{read.index}</span>
              <span className="text-ff-muted"> /100</span>
            </span>
          </Row>
        )
      })}
    </div>
  )
}

const Lineup = ({ sel, select }: WidgetProps) => {
  const { models, analysis, data } = useFantasy()
  const week = models.forecast?.nextWeek[0]?.week ?? data.horizon[0]?.week ?? null
  const rows = useWeekLineup(analysis.myRosterId, week)
  if (!rows) return <NoForecast />
  return (
    <div>
      <Th>
        <span className="w-9">slot</span>
        <span className="flex-1">wk {week} optimal</span>
        <span className="w-12 text-right">exp</span>
        <span className="w-10 text-right">plays</span>
      </Th>
      {rows.map((r, i) => (
        <Row key={i} onClick={r.id ? () => select({ player: r.id! }) : undefined} active={!!r.id && sel.player === r.id} label={r.id ? `Follow ${data.players[r.id]?.name ?? 'player'}` : undefined}>
          <span className="w-9 font-mono text-[10.5px] text-ff-muted">{r.slot}</span>
          <span className="min-w-0 flex-1">{r.id ? <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} /> : <FreeAgentPick eligible={r.eligible} week={week} size={18} avatar={false} />}</span>
          <span className="num w-12 text-right text-ff-text">{fmt(r.pts)}</span>
          <span className="num w-10 text-right text-ff-text2">{r.id ? pct(data.context[r.id]?.play) : ''}</span>
        </Row>
      ))}
    </div>
  )
}

type PowerModel = 'forecast' | 'composite' | 'elo'
const Power = ({ sel, select }: WidgetProps) => {
  const { models, analysis } = useFantasy()
  const [m, setM] = useState<PowerModel>(models.forecast ? 'forecast' : 'composite')
  const rows = analysis.teams.map((t) => {
    const v = m === 'forecast' ? (models.forecast?.byId[t.rosterId]?.rating ?? 0) : m === 'elo' ? (models.eloRated[t.rosterId] ?? 1500) : analysis.powerById[t.rosterId].score
    return { id: t.rosterId, v }
  })
  rows.sort((a, b) => b.v - a.v)
  // Bars grow from the league average, so a gap reads at its true size instead of stretched end to end.
  const mid = m === 'composite' ? 50 : m === 'elo' ? 1500 : rows.reduce((a, r) => a + r.v, 0) / (rows.length || 1)
  const reach = Math.max(...rows.map((r) => Math.abs(r.v - mid)), m === 'composite' ? 25 : m === 'elo' ? 150 : 15)
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<PowerModel>
          size="sm"
          label="Ranking model"
          value={m}
          onChange={setM}
          options={[
            ...(models.forecast ? [{ key: 'forecast' as const, label: 'Forecast', title: 'Expected points per week: projected lineup × lineup efficiency' }] : []),
            { key: 'composite', label: 'Composite', title: 'Results-weighted composite (Power Rank weights)' },
            { key: 'elo', label: 'Elo', title: 'Results-only Elo with a carried-over prior' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">{m === 'forecast' ? 'pts/wk' : m === 'elo' ? 'elo' : 'win % vs avg'}</span>
      </div>
      {rows.map((r, i) => (
        <Row key={r.id} onClick={() => select({ team: r.id })} active={sel.team === r.id} label={`Follow ${analysis.teamById[r.id]?.name ?? 'team'}`}>
          <span className="num w-5 text-ff-muted">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <TeamTag id={r.id} />
          </span>
          <CenterMeter value={(r.v - mid) / reach} width={56} />
          <span className="num w-12 text-right text-ff-text">{m === 'elo' ? Math.round(r.v) : fmt(r.v, m === 'forecast' ? 1 : 0)}</span>
        </Row>
      ))}
    </div>
  )
}

const Standings = ({ sel, select }: WidgetProps) => {
  const { analysis, data } = useFantasy()
  const cut = Number(data.league.settings?.playoff_teams ?? 6)
  const rows = [...analysis.seasons].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pf - a.pf)
  return (
    <div>
      <Th>
        <span className="w-5">#</span>
        <span className="flex-1">team</span>
        <span className="w-10 text-right">w-l</span>
        <span className="w-14 text-right">pf</span>
        <span className="hidden w-14 text-right sm:inline">pa</span>
        <span className="w-8 text-right">str</span>
      </Th>
      {rows.map((s, i) => (
        <Row key={s.rosterId} onClick={() => select({ team: s.rosterId })} active={sel.team === s.rosterId} label={`Follow ${analysis.teamById[s.rosterId]?.name ?? 'team'}`} className={cx(i === cut - 1 && 'border-b border-dashed border-b-ff-line2')}>
          <span className="num w-5 text-ff-muted">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <TeamTag id={s.rosterId} />
          </span>
          <span className="num w-10 text-right text-ff-text">
            {s.wins}-{s.losses}
          </span>
          <span className="num w-14 text-right text-ff-text2">{fmt(s.pf, 0)}</span>
          <span className="num hidden w-14 text-right text-ff-muted sm:inline">{fmt(s.pa, 0)}</span>
          <span className={cx('num w-8 text-right text-[11px]', s.streak.startsWith('W') ? 'text-ff-pos' : s.streak.startsWith('L') ? 'text-ff-neg' : 'text-ff-muted')}>{s.streak}</span>
        </Row>
      ))}
    </div>
  )
}

const Injuries = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'league'>('mine')
  const rows = useMemo(
    () =>
      Object.keys(analysis.rosteredBy)
        .filter((id) => (scope === 'mine' ? analysis.rosteredBy[id] === analysis.myRosterId : analysis.rosteredBy[id] !== analysis.myRosterId))
        .map((id) => ({ id, c: data.context[id] }))
        .filter((r) => r.c && (r.c.play < 0.9 || r.c.notes.some((n) => n.kind === 'status' || n.kind === 'bump' || n.kind === 'temporary')))
        .sort((a, b) => b.c.raw - a.c.raw)
        .slice(0, 30),
    [scope, data.context, analysis],
  )
  return (
    <div>
      <div className="flex items-center justify-between border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'league'> size="sm" label="Scope" value={scope} onChange={setScope} options={[{ key: 'mine', label: 'Mine' }, { key: 'league', label: 'League' }]} />
        <span className="font-mono text-[10px] text-ff-muted">{rows.length} flagged</span>
      </div>
      {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-ff-muted">Nothing flagged.</div>}
      {rows.map(({ id, c }) => {
        const note = c.notes.find((n) => n.kind === 'status' || n.kind === 'temporary' || n.kind === 'bump') ?? c.notes[0]
        const d = note ? describeNote(note, data.players) : null
        return (
          <Row key={id} onClick={() => select({ player: id })} active={sel.player === id} label={`Follow ${data.players[id]?.name ?? 'player'}`}>
            <span className="min-w-0 flex-1">
              <PlayerName player={data.players[id]} id={id} size={18} avatar={false} />
            </span>
            {d && (
              <span className={cx('hidden max-w-[45%] truncate font-mono text-[10.5px] sm:inline', d.tone === 'good' ? 'text-ff-pos' : d.tone === 'bad' ? 'text-ff-neg' : d.tone === 'warn' ? 'text-ff-warn' : 'text-ff-muted')} title={d.title}>
                {d.label}
              </span>
            )}
            <span className={cx('num w-10 text-right', c.play < 0.8 ? 'text-ff-neg' : 'text-ff-text2')}>{pct(c.play)}</span>
          </Row>
        )
      })}
    </div>
  )
}

const Waivers = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  const trending = useMemo(() => Object.fromEntries(data.trending.map((t) => [t.player_id, t.count])), [data.trending])
  const rows = useMemo(() => (me ? waiverTargets(data, analysis, { pool: 120, limit: 15 }) : []), [me, data, analysis])
  if (!rows.length) return <Empty title="Nobody on waivers helps">Your lineup beats every free agent at every slot.</Empty>
  return (
    <div>
      <Th>
        <span className="flex-1">free agent</span>
        <span className="w-12 text-right">+/wk</span>
        <span className="w-14 text-right">adds</span>
      </Th>
      {rows.map((t) => (
        <Row key={t.id} onClick={() => select({ player: t.id })} active={sel.player === t.id} label={`Follow ${data.players[t.id]?.name ?? 'player'}`}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[t.id]} id={t.id} size={18} avatar={false} sub={t.slot ? `fills ${t.slot}` : undefined} />
          </span>
          <Num value={t.add} signed digits={2} className="w-12 text-right" />
          <span className="num w-14 text-right text-[11px] text-ff-muted">{trending[t.id] ? `↑${compact(trending[t.id])}` : ''}</span>
        </Row>
      ))}
    </div>
  )
}

const PlayerCard = ({ sel }: WidgetProps) => {
  const { data, analysis, openPlayer } = useFantasy()
  const fallback = useMemo(() => {
    const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
    return me ? [...me.players].sort((a, b) => (analysis.market[b] ?? -99) - (analysis.market[a] ?? -99))[0] : Object.keys(analysis.market)[0]
  }, [analysis])
  const id = sel.player ?? fallback
  const p = id ? data.players[id] : undefined
  const marketRank = useMemo(() => {
    if (!p) return null
    const same = Object.keys(analysis.market).filter((x) => data.players[x]?.pos === p.pos).sort((a, b) => analysis.market[b] - analysis.market[a])
    return same.indexOf(id!) + 1 || null
  }, [p, id, analysis.market, data.players])
  if (!id || !p) return <Empty title="Pick a player">Select one in any widget on this channel.</Empty>
  const c = data.context[id]
  const v = analysis.values[id]
  const ecr = data.consensus?.byId[id]
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-3 border-b border-ff-line p-3">
        <PlayerAvatar id={id} player={p} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PosTag pos={p.pos} />
            <span className="font-mono text-[11px] text-ff-muted">{p.team ?? 'FA'}</span>
            {p.injury && <Badge tone="warn">{p.injury}</Badge>}
          </div>
          <button onClick={() => openPlayer(id)} className="mt-1 block max-w-full truncate text-left text-[17px] font-medium leading-tight text-ff-text hover:underline">
            {p.name}
          </button>
          <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px] text-ff-muted">
            <span className={cx('truncate', analysis.rosteredBy[id] === analysis.myRosterId && 'text-ff-accent')}>{ownerLabel(analysis, id)}</span>
            <button onClick={() => openPlayer(id)} className="shrink-0 font-mono text-[10.5px] text-ff-accent hover:underline">
              Details →
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px border-b border-ff-line bg-ff-line">
        {[
          ['exp/wk', fmt(analysis.horizon.perWeek[id])],
          ['plays', pct(c?.play)],
          ['value', fmtSigned(analysis.market[id])],
          ['model rk', marketRank ? `${p.pos}${marketRank}` : '–'],
          ['ecr ros', ecr?.posRank ? `${p.pos}${Math.round(ecr.posRank)}` : '–'],
          ['ecr wk', ecr?.weekRank ? `${p.pos}${Math.round(ecr.weekRank)}` : '–'],
        ].map(([k, val]) => (
          <div key={k} className="bg-ff-panel px-3 py-1.5">
            <div className="ff-label">{k}</div>
            <div className="num text-[14px] text-ff-text">{val}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        <AdjustControl id={id} />
        {p.newsAt ? <div className="font-mono text-[10.5px] text-ff-muted">sleeper news {ago(p.newsAt)} ago</div> : null}
        {v && v.weekly.length > 0 && (
          <div>
            <div className="ff-label mb-1">weekly · {v.games} g · ppg {fmt(v.ppg)} · faded = projected</div>
            <Sparkline points={v.weekly.map((w) => w.pts)} projected={pastProjection(data, id, v.weekly.map((w) => w.week))} labels={v.weekly.map((w) => `Wk ${w.week}`)} width={220} height={36} />
          </div>
        )}
        {c?.schedule && c.schedule.length > 0 && (
          <div>
            <div className="ff-label mb-1">ahead</div>
            <div className="grid grid-cols-7 gap-px border border-ff-line bg-ff-line">
              {c.schedule.slice(0, 14).map((s) => (
                <span key={s.week} className={cx('bg-ff-panel py-0.5 text-center font-mono text-[10px]', s.playoff ? 'text-ff-accent' : s.opp ? 'text-ff-text2' : 'text-ff-muted')} title={`Week ${s.week}${s.playoff ? ' · fantasy playoffs' : ''}`}>
                  {s.opp ?? 'BYE'}
                </span>
              ))}
            </div>
          </div>
        )}
        {data.market?.byId[id] && <LinesBlock id={id} />}
        {c?.notes.length ? (
          <div className="space-y-0.5">
            {c.notes.map((n, i) => {
              const d = describeNote(n, data.players)
              return (
                <div key={i} className="font-mono text-[10.5px] text-ff-text2" title={d.title}>
                  › {d.label}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const TeamCard = ({ sel, select }: WidgetProps) => {
  const { data, analysis, models } = useFantasy()
  const id = sel.team ?? analysis.myRosterId ?? analysis.teams[0].rosterId
  const team = analysis.teamById[id]
  const r = models.forecast?.byId[id]
  const s = models.forecast?.sim[id]
  const roster = [...team.players].sort((a, b) => (analysis.horizon.perWeek[b] ?? 0) - (analysis.horizon.perWeek[a] ?? 0))
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-ff-line px-3 py-2">
        <Avatar src={team.avatar} name={team.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-[14px] font-medium', id === analysis.myRosterId ? 'text-ff-accent' : 'text-ff-text')}>{team.name}</div>
          <div className="truncate font-mono text-[10.5px] text-ff-muted">
            {analysis.seasonById[id].wins}-{analysis.seasonById[id].losses} · {team.owner}
          </div>
        </div>
        {r && s && (
          <div className="grid grid-cols-3 gap-3 text-right">
            {[
              ['rtg', fmt(r.rating)],
              ['po', simOdds(s, 'playoffs')],
              ['title', simOdds(s, 'title', s.title < 0.1 ? 1 : 0)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="ff-label">{k}</div>
                <div className="num text-[13px] text-ff-text">{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-12 text-right">exp</span>
        <span className="w-12 text-right">value</span>
      </Th>
      <div className="flex-1">
        {roster.map((pid) => (
          <Row key={pid} onClick={() => select({ player: pid })} active={sel.player === pid} label={`Follow ${data.players[pid]?.name ?? 'player'}`}>
            <span className="min-w-0 flex-1">
              <PlayerName player={data.players[pid]} id={pid} size={18} avatar={false} />
            </span>
            <span className="num w-12 text-right text-ff-text">{fmt(analysis.horizon.perWeek[pid])}</span>
            <Num value={analysis.market[pid]} digits={1} className="w-12 text-right text-ff-text2" />
          </Row>
        ))}
      </div>
    </div>
  )
}

/** Where the model and the expert consensus disagree most. */
const Consensus = ({ sel, select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'rostered' | 'fa'>('mine')
  const rows = useMemo(() => {
    if (!data.consensus) return []
    const ranked = Object.keys(analysis.market)
      .filter((id) => data.players[id])
      .sort((a, b) => analysis.market[b] - analysis.market[a])
    const modelRank: Record<string, number> = {}
    ranked.forEach((id, i) => (modelRank[id] = i + 1))
    return Object.keys(data.consensus.byId)
      .filter((id) => {
        // Kickers and defenses rank on a different basis in each list; their gaps are noise.
        if (data.players[id]?.pos === 'K' || data.players[id]?.pos === 'DEF') return false
        const owner = analysis.rosteredBy[id]
        return scope === 'mine' ? owner === analysis.myRosterId : scope === 'fa' ? owner === undefined : owner !== undefined
      })
      .map((id) => ({ id, ecr: data.consensus!.byId[id].rank, model: modelRank[id] }))
      .filter((r): r is { id: string; ecr: number; model: number } => r.ecr != null && r.model != null && Math.min(r.ecr, r.model) <= 150)
      .map((r) => ({ ...r, gap: r.ecr - r.model }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 25)
  }, [data, analysis, scope])
  if (!data.consensus) return <Empty title="Consensus unavailable">FantasyPros rankings could not be read this session.</Empty>
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'rostered' | 'fa'>
          size="sm"
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Mine' },
            { key: 'rostered', label: 'Rostered' },
            { key: 'fa', label: 'FA' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">ECR {data.consensus.date ?? ''}</span>
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-10 text-right">model</span>
        <span className="w-10 text-right">ecr</span>
        <span className="w-16 text-right">read</span>
      </Th>
      {rows.map((r) => (
        <Row key={r.id} onClick={() => select({ player: r.id })} active={sel.player === r.id} label={`Follow ${data.players[r.id]?.name ?? 'player'}`}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} />
          </span>
          <span className="num w-10 text-right text-ff-text">{r.model}</span>
          <span className="num w-10 text-right text-ff-text2">{Math.round(r.ecr)}</span>
          <span className={cx('w-16 text-right font-mono text-[10.5px]', r.gap > 0 ? 'text-ff-pos' : 'text-ff-neg')} title={r.gap > 0 ? 'The model ranks this player higher than the experts: cheaper to buy than he is worth to you.' : 'The experts rank this player higher than the model: worth more in a trade than in your lineup.'}>
            {r.gap > 0 ? `buy +${Math.round(r.gap)}` : `sell ${Math.round(r.gap)}`}
          </span>
        </Row>
      ))}
    </div>
  )
}

const Activity = ({ select }: WidgetProps) => {
  const { data, analysis } = useFantasy()
  const rows = useMemo(() => [...data.transactions].filter((t) => t.status === 'complete').sort((a, b) => b.created - a.created).slice(0, 40), [data.transactions])
  if (!rows.length) return <Empty title="Quiet league">No moves yet this season.</Empty>
  const TAG: Record<string, string> = { trade: 'TRD', waiver: 'WVR', free_agent: 'ADD', commissioner: 'CMR' }
  return (
    <div>
      {rows.map((t, i) => {
        const adds = Object.entries(t.adds ?? {})
        const drops = Object.entries(t.drops ?? {})
        return (
          <div key={i} className="flex items-start gap-2 border-b border-ff-line/60 px-3 py-1.5 text-[12px] last:border-0">
            <span className="num w-7 shrink-0 pt-px text-[10px] text-ff-muted">{ago(t.created)}</span>
            <span className={cx('w-8 shrink-0 pt-px font-mono text-[10px]', t.type === 'trade' ? 'text-ff-accent' : 'text-ff-text2')}>{TAG[t.type] ?? t.type.slice(0, 3).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <TeamTag id={t.roster_ids[0]} />
              </span>
              <span className="block truncate font-mono text-[10.5px]">
                {adds.map(([pid]) => (
                  <button key={pid} onClick={() => select({ player: pid })} className="mr-1.5 text-ff-pos hover:underline">
                    +{data.players[pid]?.name ?? pid}
                  </button>
                ))}
                {drops.map(([pid]) => (
                  <span key={pid} className="mr-1.5 text-ff-muted">
                    −{data.players[pid]?.name ?? pid}
                  </span>
                ))}
                {t.type === 'trade' && t.roster_ids.length > 1 && <span className="text-ff-muted">with {analysis.teamById[t.roster_ids[1]]?.name}</span>}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The week's prop board, read as fantasy points next to Sleeper's projection. */
const Props = ({ sel, select }: WidgetProps) => {
  const { data, analysis, models } = useFantasy()
  const [scope, setScope] = useState<'mine' | 'opp' | 'league'>('mine')
  const m = data.market
  const opp = useMemo(() => {
    const g = models.forecast?.nextWeek.find((x) => x.a === analysis.myRosterId || x.b === analysis.myRosterId)
    return g ? (g.a === analysis.myRosterId ? g.b : g.a) : null
  }, [models.forecast, analysis.myRosterId])
  const rows = useMemo(() => {
    if (!m) return []
    return Object.keys(m.byId)
      .filter((id) => {
        const owner = analysis.rosteredBy[id]
        // Gaps only mean something where Sleeper has the player playing; its zeros are left out of the blend too.
        if (scope === 'league' && !(m.byId[id].sleeper > 0)) return false
        return scope === 'mine' ? owner === analysis.myRosterId : scope === 'opp' ? owner === opp : true
      })
      .map((id) => ({ id, ...m.byId[id], gap: m.byId[id].pts - m.byId[id].sleeper }))
      .sort((a, b) => (scope === 'league' ? Math.abs(b.gap) - Math.abs(a.gap) : b.pts - a.pts))
      .slice(0, 40)
  }, [m, scope, analysis, opp])
  if (!m) return <Empty title="No lines yet">The prop board fills in during the week before kickoff.</Empty>
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5">
        <Segmented<'mine' | 'opp' | 'league'>
          size="sm"
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { key: 'mine', label: 'Mine' },
            ...(opp != null ? [{ key: 'opp' as const, label: 'Opponent' }] : []),
            { key: 'league', label: 'Biggest gaps' },
          ]}
        />
        <span className="font-mono text-[10px] text-ff-muted">
          wk {m.week} · {m.players} priced
        </span>
      </div>
      <Th>
        <span className="flex-1">player</span>
        <span className="w-11 text-right" title="Fantasy points implied by the prop lines, league scoring">
          lines
        </span>
        <span className="w-11 text-right">sleeper</span>
        <span className="w-11 text-right">Δ</span>
        <span className="hidden w-11 text-right sm:inline" title="Chance of a rushing or receiving TD, margin removed">
          td%
        </span>
      </Th>
      {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-ff-muted">Nobody here has lines yet.</div>}
      {rows.map((r) => (
        <Row key={r.id} onClick={() => select({ player: r.id })} active={sel.player === r.id} label={`Follow ${data.players[r.id]?.name ?? 'player'}`}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[r.id]} id={r.id} size={18} avatar={false} />
          </span>
          <span className="num w-11 text-right text-ff-text">{fmt(r.pts)}</span>
          <span className="num w-11 text-right text-ff-muted">{fmt(r.sleeper)}</span>
          <Num value={r.gap} signed className="w-11 text-right" />
          <span className="num hidden w-11 text-right text-ff-text2 sm:inline">{r.anytimeTd != null ? pct(r.anytimeTd) : ''}</span>
        </Row>
      ))}
      <div className="px-3 py-1.5 font-mono text-[10px] text-ff-muted">lines = prop medians and prices read as expected stats, scored with your league&apos;s settings</div>
    </div>
  )
}

/** This week from the NFL side: your win odds, what a win is worth, and the games that decide it. */
const Gameday = () => {
  const { data, analysis, openGame } = useFantasy()
  const { slate, live, read, now } = useMatchups()
  const me = analysis.myRosterId
  const mine = me != null ? slate.managers[me] : null
  const m = me != null && mine?.opponent != null ? read(me, mine.opponent) : null
  if (!live || !mine) return <Empty title="No matchup this week">Gameday follows the NFL regular season.</Empty>
  const games = Object.fromEntries(slate.games.map((g) => [g.key, g]))
  const top = mine.games.slice(0, 5)
  const maxSwing = Math.max(0.05, top[0]?.swing ?? 0)
  const last = (id: string) => data.players[id]?.name.split(' ').slice(-1)[0] ?? id
  const gap = mine.stakes ? mine.stakes.win.playoffs - mine.stakes.loss.playoffs : null
  return (
    <div>
      <div className="grid grid-cols-2 gap-px border-b border-ff-line bg-ff-line">
        <div className="bg-ff-panel px-3 py-2">
          <div className="ff-label">win odds</div>
          <div className={cx('num mt-1 text-[20px] font-medium leading-none', mine.win >= 0.6 ? 'text-ff-pos' : mine.win <= 0.4 ? 'text-ff-neg' : 'text-ff-text')}>{pct(mine.win)}</div>
          <div className="mt-1 truncate text-[11px] text-ff-muted">vs {analysis.teamById[mine.opponent ?? -1]?.name ?? '–'}</div>
        </div>
        <div className="bg-ff-panel px-3 py-2">
          <div className="ff-label">on the line</div>
          <div className="num mt-1 text-[20px] font-medium leading-none text-ff-text">{gap == null ? '…' : `${(gap * 100).toFixed(0)}pt`}</div>
          <div className="mt-1 truncate text-[11px] text-ff-muted">playoff odds, a win against a loss</div>
        </div>
      </div>
      {m?.started && (
        // Banked against still to play, both sides.
        <div className="flex items-center justify-between gap-2 border-b border-ff-line px-3 py-1.5 text-[11.5px]">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="ff-label">banked</span>
            <Pts value={m.a.banked} kind={m.kindA} className="font-medium" />
            <span className="text-ff-muted">–</span>
            <Pts value={m.b.banked} kind={m.kindB} className="font-medium" />
          </span>
          <span className="truncate font-mono text-[10px] text-ff-muted" title="Your starters: games over, under way, still to come; then theirs">
            {m.countA.left + m.countA.live} to go · they {m.countB.left + m.countB.live}
          </span>
        </div>
      )}
      <Th>
        <span className="flex-1">games that decide it</span>
        <span>±win odds</span>
      </Th>
      {top.map((g) => {
        const game = games[g.key]
        return (
          <Row key={g.key} onClick={() => openGame(g.key)} label={`Open ${game.away} at ${game.home}`} className="h-auto py-1.5">
            <span className="w-[76px] shrink-0 font-mono text-[11.5px] font-semibold text-ff-text">
              {game.away} @ {game.home}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ff-text2">
              {g.mine.length > 0 && <span className="text-ff-accent">{g.mine.map(last).join(', ')}</span>}
              {g.mine.length > 0 && g.theirs.length > 0 && <span className="text-ff-muted"> vs </span>}
              {g.theirs.length > 0 && <span className="text-ff-neg">{g.theirs.map(last).join(', ')}</span>}
            </span>
            {game.final || game.live ? <ScoreState kind={game.final ? 'final' : 'live'} clock={now.clockOf(game)} /> : <Bar value={g.swing} max={maxSwing} width={36} />}
            <span className="num w-8 text-right text-[11.5px] text-ff-text">{game.final ? '–' : `±${((g.swing / 2) * 100).toFixed(0)}`}</span>
          </Row>
        )
      })}
    </div>
  )
}

/** The moves worth making on your roster, most urgent first. */
const Moves = () => {
  const { analysis, go } = useFantasy()
  const moves = useMoves(analysis.myRosterId, 8)
  if (analysis.myRosterId == null) return <Empty title="No roster of yours">Pick a league you are in.</Empty>
  if (!moves.length) return <Empty title="Nothing to do">Lineup is optimal, no starter in doubt, no add worth half a point.</Empty>
  return (
    <div>
      <MoveList moves={moves} compact />
      <button type="button" onClick={() => go('me')} className="block w-full border-t border-ff-line px-3 py-1.5 text-left font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text">
        My team →
      </button>
    </div>
  )
}

export const WIDGETS: Record<WidgetKind, Meta> = {
  moves: { title: 'Moves to make', blurb: 'Lineup fixes, cover for starters who may sit, bye holes and the best adds.', w: 4, h: 9, Body: Moves },
  matchup: { title: 'My matchup', blurb: 'Next week, both lineups, and your win odds.', w: 4, h: 12, Body: Matchup },
  odds: { title: 'Playoff odds', blurb: 'Simulated seasons: wins, playoff, bye and title odds.', w: 5, h: 11, Body: Odds },
  scoreboard: { title: 'Scoreboard', blurb: "This week's games with expected scores and win odds.", w: 6, h: 7, Body: Scoreboard },
  trades: { title: 'Trade ideas', blurb: 'Best deal from each partner, and how likely each lands.', w: 7, h: 9, Body: TradeIdeas },
  lineup: { title: 'My lineup', blurb: "Next week's optimal lineup from adjusted projections.", w: 4, h: 9, Body: Lineup },
  power: { title: 'Power Rank', blurb: 'Rankings under any of the three models.', w: 4, h: 9, Body: Power },
  standings: { title: 'Standings', blurb: 'Record, points and the playoff line.', w: 6, h: 7, Body: Standings },
  injuries: { title: 'Injury watch', blurb: 'Flagged players and who inherits their work.', w: 4, h: 9, Body: Injuries },
  waivers: { title: 'Waiver wire', blurb: 'Free agents who would start for you.', w: 4, h: 9, Body: Waivers },
  player: { title: 'Player', blurb: 'Everything on one player. Follows its channel.', w: 3, h: 11, Body: PlayerCard, reads: 'player' },
  team: { title: 'Team', blurb: 'One roster with its rating and odds. Follows its channel.', w: 5, h: 9, Body: TeamCard, reads: 'team' },
  consensus: { title: 'Model vs consensus', blurb: 'Where FantasyPros and the model disagree: buys and sells.', w: 4, h: 9, Body: Consensus },
  activity: { title: 'League activity', blurb: 'Trades, claims and pickups as they happen.', w: 4, h: 9, Body: Activity },
  gameday: { title: 'Gameday', blurb: 'Your win odds, what a win is worth, and the NFL games that decide it.', w: 4, h: 9, Body: Gameday },
  props: { title: 'Prop board', blurb: 'Betting lines read as fantasy points, against Sleeper.', w: 4, h: 9, Body: Props },
}
