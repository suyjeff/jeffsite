// Two-sided trade search.
//
// The question this answers is not "who is the best player I could get" but
// "which player, on which roster, lifts MY optimal lineup the most, and what
// can I send back that barely dents my lineup while plugging a hole in theirs".
// Those are different questions: a receiver who would be a league-winner on a
// thin roster is worth nearly nothing to a team already starting three better
// ones.
//
// Everything is measured in one unit — points per week added to a team's
// optimal starting lineup over the weeks ahead — so both halves of a deal are
// priced on the same scale.

import { optimalLineup, starterDemand, type LineupPlayer, type Slot } from './lineup'
import type { PlayerMap } from './types'

/** Projected (or realised) league-scored points per player, one entry per week. */
export type Horizon = { week: number; pts: Record<string, number> }[]

export type TradeTeam = { rosterId: number; players: string[] }

const round2 = (x: number) => Math.round(x * 100) / 100
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// ---------- Reading a horizon two ways ----------

export type HorizonValues = {
  /** Mean points per week, counting byes and ruled-out weeks as the zeros they are. */
  perWeek: Record<string, number>
  /** Mean points per week the player is actually projected to play. */
  perActive: Record<string, number>
  /** How many of the horizon's weeks carry a nonzero projection. */
  activeWeeks: Record<string, number>
  weeks: number
}

/**
 * Both readings matter, for different jobs.
 *
 * `perWeek` is what a roster gets from holding the player, so it belongs
 * anywhere availability is part of the answer. `perActive` is what the player
 * is, so it belongs in anything resembling a market price — an owner does not
 * mark their quarterback down because week 7 is his bye.
 */
export const horizonValues = (horizon: Horizon): HorizonValues => {
  const sums: Record<string, number> = {}
  const active: Record<string, number> = {}
  for (const week of horizon) {
    for (const id of Object.keys(week.pts)) {
      const v = week.pts[id]
      sums[id] = (sums[id] ?? 0) + v
      if (v > 0) active[id] = (active[id] ?? 0) + 1
    }
  }
  const perWeek: Record<string, number> = {}
  const perActive: Record<string, number> = {}
  const n = horizon.length || 1
  for (const id of Object.keys(sums)) {
    perWeek[id] = round2(sums[id] / n)
    perActive[id] = round2(sums[id] / (active[id] || n))
  }
  return { perWeek, perActive, activeWeeks: active, weeks: horizon.length }
}

/** How many players a roster may hold. IR and taxi spots do not count. */
export const rosterCapacity = (rosterPositions: string[]) =>
  rosterPositions.filter((p) => p !== 'IR' && p !== 'TAXI').length

// ---------- Evaluating a roster ----------

/** Replacement points per week per position: what the waiver wire always offers. */
export type WaiverFloor = Record<string, number>

const WAIVER_PREFIX = '__fa__'

/**
 * Replacement-level bodies available at each position at once. One is the
 * realistic number: an owner can cover a bye or an injury off the wire, but
 * nobody starts three streamers in the same week, and letting them would price
 * roster depth at nothing and hide every trade worth making.
 */
export const DEFAULT_WAIVER_DEPTH = 1

/** True for the stand-in the evaluator drops into a slot nobody on the roster can fill. */
export const isWaiverFill = (id: string) => id.startsWith(WAIVER_PREFIX)

/**
 * A pool of freely available players, deep enough that no slot ever goes empty.
 *
 * Without this an empty slot scores zero, which prices a starter's bye week at
 * his full output and makes every roster with a bye look like it urgently needs
 * a trade. It does not: it needs a waiver claim. Charging the bye at
 * starter-minus-replacement instead is both what actually happens and what
 * keeps one week from swamping a six-week average.
 */
const waiverPool = (slots: Slot[], floor: WaiverFloor, depth: number): LineupPlayer[] => {
  const eligible = new Set<string>()
  for (const s of slots) for (const pos of s.eligible) eligible.add(pos)
  const out: LineupPlayer[] = []
  for (const pos of eligible) {
    const pts = floor[pos] ?? 0
    if (pts <= 0) continue
    for (let i = 0; i < depth; i++) out.push({ id: `${WAIVER_PREFIX}${pos}${i}`, fpos: [pos], pts })
  }
  return out
}

const toLineup = (ids: string[], players: PlayerMap, pts: Record<string, number>): LineupPlayer[] => {
  const out: LineupPlayer[] = []
  for (const id of ids) {
    const p = players[id]
    if (!p) continue
    const v = pts[id] ?? 0
    // A player projected at zero can never raise an optimal lineup's total, so
    // dropping them here leaves the answer identical and the solve smaller.
    if (v <= 0) continue
    out.push({ id, fpos: p.fpos, pts: v })
  }
  return out
}

/** Optimal lineup for one set of weekly points. Memoised by roster. */
export const makeLineupEval = (
  slots: Slot[],
  players: PlayerMap,
  pts: Record<string, number>,
  floor: WaiverFloor = {},
  waiverDepth = DEFAULT_WAIVER_DEPTH,
) => {
  const cache = new Map<string, number>()
  const pool = waiverPool(slots, floor, waiverDepth)
  const total = (ids: string[]): number => {
    const key = [...ids].sort().join(',')
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = optimalLineup(slots, [...toLineup(ids, players, pts), ...pool]).total
    cache.set(key, value)
    return value
  }
  /** Full assignment, zero-point players included, for display. */
  const assign = (ids: string[]) =>
    optimalLineup(slots, [
      ...ids.filter((id) => players[id]).map<LineupPlayer>((id) => ({ id, fpos: players[id].fpos, pts: pts[id] ?? 0 })),
      ...pool,
    ])
  return { total, assign, pts }
}

export type LineupEval = ReturnType<typeof makeLineupEval>

/**
 * Optimal lineup averaged over the horizon, solved one week at a time.
 *
 * This has to be per week. Setting a lineup from average projections and
 * solving once is a different — and wrong — calculation: it cannot see that a
 * backup quarterback is worth nothing in five weeks and worth a full starter in
 * the sixth, when the starter is on bye. Averaging first quietly smears that
 * spike across every week and misprices exactly the depth trades this tool
 * exists to find.
 */
export const makeHorizonEval = (
  slots: Slot[],
  players: PlayerMap,
  horizon: Horizon,
  floor: WaiverFloor = {},
  waiverDepth = DEFAULT_WAIVER_DEPTH,
) => {
  const weekly = horizon.map((w) => makeLineupEval(slots, players, w.pts, floor, waiverDepth))
  const cache = new Map<string, number[]>()
  const perWeek = (ids: string[]): number[] => {
    const key = [...ids].sort().join(',')
    const hit = cache.get(key)
    if (hit) return hit
    const value = weekly.map((ev) => ev.total(ids))
    cache.set(key, value)
    return value
  }
  const total = (ids: string[]) => mean(perWeek(ids))
  return { total, perWeek, weekly, weeks: horizon.map((w) => w.week) }
}

export type HorizonEval = ReturnType<typeof makeHorizonEval>

/**
 * Apply a trade to one side. A team taking back more players than it sends has
 * to get under the roster limit, and would cut its least useful body to do it,
 * so that is what we model rather than pretending the extra spot is free.
 */
export const applyTrade = (
  ids: string[],
  out: string[],
  incoming: string[],
  capacity: number,
  pts: Record<string, number>,
): string[] => {
  const dropped = new Set(out)
  const kept = ids.filter((id) => !dropped.has(id))
  const next = [...kept, ...incoming.filter((id) => !kept.includes(id))]
  if (next.length <= capacity) return next
  const incomingSet = new Set(incoming)
  const cuttable = next
    .filter((id) => !incomingSet.has(id))
    .sort((a, b) => (pts[a] ?? 0) - (pts[b] ?? 0))
  const cut = new Set(cuttable.slice(0, next.length - capacity))
  return next.filter((id) => !cut.has(id))
}

// ---------- Pricing a player on the open market ----------

/**
 * Points per week of the first player at each position nobody could start.
 * `benchFactor` pushes the line past the last starter and into the bench,
 * roughly where a waiver pickup sits.
 */
export const projectedReplacement = (
  pts: Record<string, number>,
  players: PlayerMap,
  rosterPositions: string[],
  numTeams: number,
  benchFactor = 0.6,
): Record<string, number> => {
  const demand = starterDemand(rosterPositions, numTeams)
  const byPos: Record<string, number[]> = {}
  for (const id of Object.keys(pts)) {
    const pos = players[id]?.pos
    if (!pos || demand[pos] === undefined) continue
    ;(byPos[pos] ??= []).push(pts[id])
  }
  const out: Record<string, number> = {}
  for (const pos of Object.keys(demand)) {
    const sorted = (byPos[pos] ?? []).sort((a, b) => b - a)
    if (!sorted.length) {
      out[pos] = 0
      continue
    }
    const rank = Math.max(1, Math.round(demand[pos] * (1 + benchFactor)))
    const idx = Math.min(rank - 1, sorted.length - 1)
    out[pos] = round2(mean(sorted.slice(Math.max(0, idx - 1), Math.min(sorted.length, idx + 2))))
  }
  return out
}

/**
 * Roster-blind value: points per week above the position's replacement level.
 * This is what a player is worth to *someone*, which is the number an owner has
 * in mind when deciding whether an offer is insulting. Feed it `perActive` —
 * a bye inside an arbitrary window is not a reason to mark a player down.
 */
export const marketValues = (
  pts: Record<string, number>,
  players: PlayerMap,
  replacement: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const id of Object.keys(pts)) {
    const pos = players[id]?.pos
    if (!pos) continue
    out[id] = round2(pts[id] - (replacement[pos] ?? 0))
  }
  return out
}

/** Mean points of the players who would actually start at a position league-wide. */
export const averageStarter = (
  pts: Record<string, number>,
  players: PlayerMap,
  rosterPositions: string[],
  numTeams: number,
): Record<string, number> => {
  const demand = starterDemand(rosterPositions, numTeams)
  const byPos: Record<string, number[]> = {}
  for (const id of Object.keys(pts)) {
    const pos = players[id]?.pos
    if (!pos || demand[pos] === undefined) continue
    ;(byPos[pos] ??= []).push(pts[id])
  }
  const out: Record<string, number> = {}
  for (const pos of Object.keys(demand)) {
    const sorted = (byPos[pos] ?? []).sort((a, b) => b - a)
    out[pos] = round2(mean(sorted.slice(0, Math.max(1, Math.round(demand[pos])))))
  }
  return out
}

// ---------- Team needs ----------

export type SlotNeed = {
  /** Index into the league's starting slots, so duplicate names stay distinct. */
  index: number
  slot: string
  eligible: string[]
  /** Who fills the slot in the first week of the horizon. */
  starter: string | null
  /** Points the slot produces per week, averaged over the horizon. */
  pts: number
  leagueAvg: number
  gap: number
}

export type TeamNeeds = {
  rosterId: number
  /** Projected optimal lineup, points per week. */
  lineup: number
  slots: SlotNeed[]
  /** Points per week a league-average starter at each position would add. */
  byPos: Record<string, number>
  /** The position where an upgrade would help this team most. */
  worstPos: string | null
  worstSlot: SlotNeed | null
}

const SYNTHETIC = '__avg_starter__'

/**
 * What each team's lineup produces slot by slot, and what a league-average
 * starter at each position would add.
 *
 * The second number is the honest measure of a hole. A team can sit below
 * average at running back and still not need one, because its flex already
 * absorbs the upgrade; another can look fine everywhere and still gain four
 * points a week from one more starter, because its bench is empty behind a bye.
 */
export const teamNeeds = (
  teams: TradeTeam[],
  slots: Slot[],
  players: PlayerMap,
  horizon: Horizon,
  starters: Record<string, number>,
  rosterPositions: string[],
  numTeams: number,
  floor: WaiverFloor = {},
): Record<number, TeamNeeds> => {
  const out: Record<number, TeamNeeds> = {}
  if (!horizon.length) return out
  const demand = starterDemand(rosterPositions, numTeams)
  const positions = Object.keys(demand).filter((pos) => starters[pos] > 0)

  // One probe roster carrying a synthetic average starter at every position, so
  // a per-position need is a single subtraction rather than a rebuilt map.
  const probePlayers: PlayerMap = { ...players }
  for (const pos of positions) {
    const id = `${SYNTHETIC}${pos}`
    probePlayers[id] = { id, name: `Average ${pos}`, pos, fpos: [pos], team: null, status: null, injury: null, age: null, exp: null }
  }
  const probeHorizon: Horizon = horizon.map((w) => {
    const pts = { ...w.pts }
    for (const pos of positions) pts[`${SYNTHETIC}${pos}`] = starters[pos]
    return { week: w.week, pts }
  })
  const probe = makeHorizonEval(slots, probePlayers, probeHorizon, floor)

  // Slot production, averaged across the horizon's own weekly optimal lineups.
  const perTeamSlots: Record<number, number[]> = {}
  const firstWeekStarters: Record<number, (string | null)[]> = {}
  const first = makeLineupEval(slots, players, horizon[0].pts, floor)
  const weekEvals = horizon.map((w) => makeLineupEval(slots, players, w.pts, floor))
  for (const team of teams) {
    const sums = slots.map(() => 0)
    horizon.forEach((w, wi) => {
      const ev = weekEvals[wi]
      ev.assign(team.players).assignments.forEach((p, i) => {
        sums[i] += p ? (isWaiverFill(p.id) ? p.pts : (w.pts[p.id] ?? 0)) : 0
      })
    })
    perTeamSlots[team.rosterId] = sums.map((s) => s / horizon.length)
    firstWeekStarters[team.rosterId] = first.assign(team.players).assignments.map((p) => p?.id ?? null)
  }
  const leagueAvgBySlot = slots.map((_, i) => round2(mean(teams.map((t) => perTeamSlots[t.rosterId][i] ?? 0))))

  for (const team of teams) {
    const probeBase = probe.total(team.players)
    const byPos: Record<string, number> = {}
    for (const pos of positions) {
      byPos[pos] = round2(probe.total([...team.players, `${SYNTHETIC}${pos}`]) - probeBase)
    }
    const slotNeeds: SlotNeed[] = slots.map((slot, i) => ({
      index: i,
      slot: slot.name,
      eligible: slot.eligible,
      starter: firstWeekStarters[team.rosterId][i],
      pts: round2(perTeamSlots[team.rosterId][i] ?? 0),
      leagueAvg: leagueAvgBySlot[i],
      gap: round2((perTeamSlots[team.rosterId][i] ?? 0) - leagueAvgBySlot[i]),
    }))
    const ranked = Object.keys(byPos).sort((a, b) => byPos[b] - byPos[a])
    out[team.rosterId] = {
      rosterId: team.rosterId,
      lineup: round2(perTeamSlots[team.rosterId].reduce((a, b) => a + b, 0)),
      slots: slotNeeds,
      byPos,
      worstPos: ranked[0] ?? null,
      worstSlot: [...slotNeeds].sort((a, b) => a.gap - b.gap)[0] ?? null,
    }
  }
  return out
}

// ---------- Trade search ----------

export type TradeConfig = {
  /** Most players you are willing to send in one deal. 1 or 2. */
  maxGive: number
  /** Most players you are willing to take back. 1 or 2; 2 widens the search a lot. */
  maxGet: number
  /** Their players to consider per team, ranked by what each would add to you. */
  getPerTeam: number
  /** Your players to consider, ranked by how little you would miss them. */
  givePerTeam: number
  /** Minimum points per week the deal must add to your optimal lineup. */
  minMyGain: number
  /**
   * Minimum it must add to theirs. Zero asks for deals the other owner should
   * take on the merits. Going negative surfaces the ones you would have to talk
   * them into, which is most of what actually gets offered in a league.
   */
  minTheirGain: number
  /**
   * How much more open-market value you may ask for than you send, in points
   * per week, before a deal is treated as a lowball and dropped.
   */
  maxValueAsk: number
  /** Hard ceiling on exact scoring, so a pathological league cannot hang the tab. */
  maxScored: number
  limit: number
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  maxGive: 2,
  maxGet: 1,
  getPerTeam: 12,
  givePerTeam: 12,
  minMyGain: 0.1,
  minTheirGain: 0,
  maxValueAsk: 4,
  maxScored: 6000,
  limit: 40,
}

export type TradeIdea = {
  partnerId: number
  get: string[]
  give: string[]
  /** Points per week added to your optimal lineup, averaged over the horizon. */
  myGain: number
  /** Points per week added to theirs. */
  theirGain: number
  /** What leaving your roster costs you, before counting what comes back. */
  myCost: number
  /** Open-market value in minus out. Positive means you are asking for a premium. */
  valueAsk: number
  /**
   * Weeks of the horizon your lineup is better off. A deal that only pays in
   * one week is a bye patch, not an upgrade, however good the average looks.
   */
  weeksBetter: number
  weeks: number
  /** The slot on their roster the deal upgrades, and by how much. */
  fills: { slot: string; index: number; before: number; after: number } | null
  /** The weaker half of the deal, for ranking by how likely it is to land. */
  mutual: number
  /** Your gain in each horizon week. */
  perWeek: { week: number; mine: number; theirs: number }[]
}

const combinations2 = <T>(xs: T[]): [T, T][] => {
  const out: [T, T][] = []
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]])
  return out
}

export type TradeSearchInput = {
  slots: Slot[]
  players: PlayerMap
  horizon: Horizon
  /** Mean points per week per player, for screening and for roster cuts. */
  pts: Record<string, number>
  me: TradeTeam
  others: TradeTeam[]
  capacity: number
  market: Record<string, number>
  /** Replacement level per position: the lineup floor any owner can reach via waivers. */
  floor?: WaiverFloor
  config?: Partial<TradeConfig>
  /** Optional hook for inspecting how many candidates each filter removed. */
  onFunnel?: (f: TradeFunnel) => void
}

/** Why candidate deals were discarded, for tuning the filters. */
export type TradeFunnel = {
  combinations: number
  shortlisted: number
  scored: number
  rejectedValueAsk: number
  rejectedMyGain: number
  rejectedTheirGain: number
  kept: number
}

/**
 * Search every other roster for deals that leave both lineups better.
 *
 * Only packages that send at least as many players as they bring back are
 * considered. Rosters in a standard league are full, so a two-for-one your way
 * is a deal the other side clears a spot for, and a one-for-two is one you
 * cannot make at all without cutting somebody first.
 *
 * Two passes. A cheap screen on mean weekly points cuts thousands of
 * combinations down to a shortlist, deliberately keeping anything within a
 * point of the bar; the shortlist is then re-scored week by week, and only
 * those exact numbers are ever reported or filtered on.
 */
export const findTrades = (input: TradeSearchInput): TradeIdea[] => {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...(input.config ?? {}) }
  const { slots, players, horizon, pts, me, others, capacity, market } = input
  const floor = input.floor ?? {}
  if (!horizon.length) return []

  const screen = makeLineupEval(slots, players, pts, floor)
  const exact = makeHorizonEval(slots, players, horizon, floor)
  const screenBase = screen.total(me.players)
  const mine = me.players.filter((id) => players[id])

  // What each of my players costs me if they leave. The cheap ones are currency.
  const giveRanked = mine
    .map((id) => ({ id, cost: screenBase - screen.total(me.players.filter((x) => x !== id)) }))
    .sort((a, b) => a.cost - b.cost)

  // Cheap pieces first, plus a few of my best, so a real blockbuster can surface.
  const givePool = [...giveRanked.slice(0, cfg.givePerTeam), ...giveRanked.slice(-3)].filter(
    (g, i, arr) => arr.findIndex((x) => x.id === g.id) === i,
  )
  const packages: string[][] = [
    ...givePool.map((g) => [g.id]),
    ...(cfg.maxGive >= 2 ? combinations2(givePool.map((g) => g.id)) : []),
  ]
  const packageValue = new Map(packages.map((ids) => [ids.join(','), ids.reduce((a, id) => a + (market[id] ?? 0), 0)]))

  // ---- Pass 1: screen ----
  const SCREEN_SLACK = 1
  const funnel: TradeFunnel = { combinations: 0, shortlisted: 0, scored: 0, rejectedValueAsk: 0, rejectedMyGain: 0, rejectedTheirGain: 0, kept: 0 }
  type Candidate = { partnerId: number; get: string[]; give: string[]; screened: number }
  const shortlist: Candidate[] = []
  for (const them of others) {
    const theirRoster = them.players.filter((id) => players[id])
    const theirScreenBase = screen.total(them.players)
    const ranked = theirRoster
      .map((id) => ({ id, add: screen.total([...me.players, id]) - screenBase }))
      .filter((c) => c.add > 0)
      .sort((a, b) => b.add - a.add)
      .slice(0, cfg.getPerTeam)
      .map((c) => c.id)
    // Two-for-two is where depth-for-depth deals live, but pairing every target
    // with every other squares the search, so only the best few get paired.
    const targets: string[][] = [
      ...ranked.map((id) => [id]),
      ...(cfg.maxGet >= 2 ? combinations2(ranked.slice(0, 8)) : []),
    ]

    for (const get of targets) {
      const valueIn = get.reduce((a, id) => a + (market[id] ?? 0), 0)
      for (const give of packages) {
        if (give.length < get.length) continue
        if (get.some((id) => give.includes(id))) continue
        funnel.combinations++
        if (valueIn - (packageValue.get(give.join(',')) ?? 0) > cfg.maxValueAsk) {
          funnel.rejectedValueAsk++
          continue
        }
        const myGain = screen.total(applyTrade(me.players, give, get, capacity, pts)) - screenBase
        if (myGain < cfg.minMyGain - SCREEN_SLACK) continue
        const theirGain = screen.total(applyTrade(them.players, get, give, capacity, pts)) - theirScreenBase
        if (theirGain < cfg.minTheirGain - SCREEN_SLACK) continue
        shortlist.push({ partnerId: them.rosterId, get, give, screened: myGain })
      }
    }
  }
  // Deliberately not truncated by rank. The screen systematically overstates
  // gains (it sets one lineup from average projections instead of solving each
  // week), so ranking by it and keeping the top slice selects for exactly the
  // combinations the exact pass will reject. Its only job is to throw out the
  // hopeless; everything it lets through gets scored properly.
  shortlist.sort((a, b) => b.screened - a.screened)
  funnel.shortlisted = shortlist.length

  // ---- Pass 2: exact, week by week ----
  const myExactBase = exact.perWeek(me.players)
  const theirExactBase = new Map<number, number[]>()
  const ideas: TradeIdea[] = []
  for (const cand of shortlist.slice(0, cfg.maxScored)) {
    const them = others.find((t) => t.rosterId === cand.partnerId)
    if (!them) continue
    let theirBase = theirExactBase.get(cand.partnerId)
    if (!theirBase) {
      theirBase = exact.perWeek(them.players)
      theirExactBase.set(cand.partnerId, theirBase)
    }
    const myAfter = exact.perWeek(applyTrade(me.players, cand.give, cand.get, capacity, pts))
    const theirAfter = exact.perWeek(applyTrade(them.players, cand.get, cand.give, capacity, pts))
    const perWeek = exact.weeks.map((week, i) => ({
      week,
      mine: round2(myAfter[i] - myExactBase[i]),
      theirs: round2(theirAfter[i] - theirBase![i]),
    }))
    funnel.scored++
    const myGain = round2(mean(perWeek.map((w) => w.mine)))
    if (myGain < cfg.minMyGain) {
      funnel.rejectedMyGain++
      continue
    }
    const theirGain = round2(mean(perWeek.map((w) => w.theirs)))
    if (theirGain < cfg.minTheirGain) {
      funnel.rejectedTheirGain++
      continue
    }
    const myCost = round2(
      mean(exact.perWeek(me.players.filter((id) => !cand.give.includes(id))).map((v, i) => myExactBase[i] - v)),
    )
    ideas.push({
      partnerId: cand.partnerId,
      get: cand.get,
      give: cand.give,
      myGain,
      theirGain,
      myCost,
      valueAsk: round2(cand.get.reduce((a, id) => a + (market[id] ?? 0), 0) - (packageValue.get(cand.give.join(',')) ?? 0)),
      weeksBetter: perWeek.filter((w) => w.mine > 0.05).length,
      weeks: perWeek.length,
      fills: null,
      mutual: round2(Math.min(myGain, theirGain)),
      perWeek,
    })
  }

  // One row per player worth asking for. Among the packages landing within a
  // quarter-point of the best return on that player, keep whichever does the
  // most for the other side — that is the version they actually say yes to.
  const byTarget = new Map<string, TradeIdea[]>()
  for (const idea of ideas) {
    const key = `${idea.partnerId}:${idea.get.join(',')}`
    const group = byTarget.get(key)
    if (group) group.push(idea)
    else byTarget.set(key, [idea])
  }
  const best: TradeIdea[] = []
  for (const group of byTarget.values()) {
    const top = Math.max(...group.map((g) => g.myGain))
    const near = group.filter((g) => g.myGain >= top - 0.25)
    near.sort((a, b) => b.theirGain - a.theirGain || a.give.length - b.give.length || b.myGain - a.myGain)
    best.push(near[0])
  }

  funnel.kept = ideas.length
  input.onFunnel?.(funnel)
  const ranked = best.sort((a, b) => b.myGain - a.myGain || b.mutual - a.mutual).slice(0, cfg.limit)

  // Label the hole each surviving deal plugs. Left until last because the
  // unpruned solve is the expensive one and only rows on screen need it.
  const firstWeek = makeLineupEval(slots, players, horizon[0].pts, floor)
  const beforeCache = new Map<number, number[]>()
  for (const idea of ranked) {
    const them = others.find((t) => t.rosterId === idea.partnerId)
    if (!them) continue
    let before = beforeCache.get(idea.partnerId)
    if (!before) {
      before = firstWeek.assign(them.players).assignments.map((p) => (p ? (isWaiverFill(p.id) ? p.pts : (horizon[0].pts[p.id] ?? 0)) : 0))
      beforeCache.set(idea.partnerId, before)
    }
    const after = firstWeek
      .assign(applyTrade(them.players, idea.get, idea.give, capacity, pts))
      .assignments.map((p) => (p ? (isWaiverFill(p.id) ? p.pts : (horizon[0].pts[p.id] ?? 0)) : 0))
    let bestDelta = 0.05
    for (let i = 0; i < after.length; i++) {
      const delta = after[i] - (before[i] ?? 0)
      if (delta > bestDelta) {
        bestDelta = delta
        idea.fills = { slot: slots[i].name, index: i, before: round2(before[i] ?? 0), after: round2(after[i]) }
      }
    }
  }
  return ranked
}

// ---------- Who is worth chasing ----------

export type TradeTarget = {
  id: string
  /** Roster holding them, or null for a free agent. */
  ownerId: number | null
  /** Points per week they would add to your optimal lineup. */
  add: number
  /** Points per week their own lineup would lose without them. */
  ownerCost: number
  /**
   * `add` minus `ownerCost`. The whole trade surplus in one number: positive
   * means the player is worth more in your lineup than in theirs, which is the
   * only reason a deal between two rational owners exists at all.
   */
  surplus: number
  /** Points per week above replacement — what they cost in open-market terms. */
  market: number
  /** Which of your starting slots they would take over, if any. */
  slot: string | null
}

export type TargetSearchInput = {
  slots: Slot[]
  players: PlayerMap
  horizon: Horizon
  me: TradeTeam
  others: TradeTeam[]
  /** Everyone rostered anywhere, so free agents can be told apart. */
  rosteredBy: Record<string, number>
  /** Free agents worth listing, usually the ones the model already values. */
  freeAgents?: string[]
  capacity: number
  market: Record<string, number>
  floor?: WaiverFloor
  pts: Record<string, number>
  limit?: number
}

/**
 * Every player not on your roster, ranked by what they would add to your
 * optimal lineup — the "who should I be asking about" list.
 *
 * `surplus` is the column that matters. A player who would add six points a
 * week to you and costs his owner five is an expensive ask; one who would add
 * four and costs his owner one is a deal waiting to happen, because the two of
 * you disagree about what he is worth without either of you being wrong.
 */
export const findTargets = (input: TargetSearchInput): TradeTarget[] => {
  const { slots, players, horizon, me, others, rosteredBy, capacity, market, pts } = input
  if (!horizon.length) return []
  const floor = input.floor ?? {}
  const exact = makeHorizonEval(slots, players, horizon, floor)
  const screen = makeLineupEval(slots, players, pts, floor)
  const myBase = exact.total(me.players)
  const screenBase = screen.total(me.players)
  const firstWeek = makeLineupEval(slots, players, horizon[0].pts, floor)
  const mySlots = firstWeek.assign(me.players).assignments

  const pool: { id: string; ownerId: number | null; team: TradeTeam | null }[] = []
  for (const t of others) for (const id of t.players) if (players[id]) pool.push({ id, ownerId: t.rosterId, team: t })
  for (const id of input.freeAgents ?? []) {
    if (players[id] && rosteredBy[id] === undefined) pool.push({ id, ownerId: null, team: null })
  }

  // Screen first: most of the league cannot crack your lineup at all, and the
  // cheap pass says so without paying for a week-by-week solve.
  const worth = pool.filter((p) => screen.total([...me.players, p.id]) - screenBase > 0)

  const out: TradeTarget[] = []
  for (const p of worth) {
    const add = round2(exact.total(applyTrade(me.players, [], [p.id], capacity, pts)) - myBase)
    if (add <= 0) continue
    const ownerCost = p.team ? round2(exact.total(p.team.players) - exact.total(p.team.players.filter((x) => x !== p.id))) : 0
    const after = firstWeek.assign(applyTrade(me.players, [], [p.id], capacity, pts)).assignments
    let slot: string | null = null
    for (let i = 0; i < after.length; i++) {
      if (after[i]?.id === p.id) {
        slot = slots[i].name
        break
      }
    }
    out.push({
      id: p.id,
      ownerId: p.ownerId,
      add,
      ownerCost,
      surplus: round2(add - ownerCost),
      market: market[p.id] ?? 0,
      slot: slot ?? (mySlots.some((a) => a?.id === p.id) ? null : null),
    })
  }
  return out.sort((a, b) => b.add - a.add).slice(0, input.limit ?? 60)
}
