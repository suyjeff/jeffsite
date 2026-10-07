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

/**
 * Projected (or realised) league-scored points per player, one entry per week.
 * `weight` lets some weeks count for more — the fantasy playoffs, usually.
 * Missing means 1.
 */
export type Horizon = { week: number; pts: Record<string, number>; weight?: number }[]

export type TradeTeam = { rosterId: number; players: string[] }

const round2 = (x: number) => Math.round(x * 100) / 100
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
/** Weighted mean; falls back to the plain mean when no weights are given. */
const wmean = (xs: number[], ws?: number[]) => {
  if (!ws) return mean(xs)
  let num = 0
  let den = 0
  xs.forEach((x, i) => {
    num += x * (ws[i] ?? 1)
    den += ws[i] ?? 1
  })
  return den ? num / den : 0
}
export const horizonWeights = (horizon: Horizon) => horizon.map((w) => w.weight ?? 1)

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
  const activeWeight: Record<string, number> = {}
  let totalWeight = 0
  for (const week of horizon) {
    const wt = week.weight ?? 1
    totalWeight += wt
    for (const id of Object.keys(week.pts)) {
      const v = week.pts[id]
      sums[id] = (sums[id] ?? 0) + v * wt
      if (v > 0) {
        active[id] = (active[id] ?? 0) + 1
        activeWeight[id] = (activeWeight[id] ?? 0) + wt
      }
    }
  }
  const perWeek: Record<string, number> = {}
  const perActive: Record<string, number> = {}
  const n = totalWeight || 1
  for (const id of Object.keys(sums)) {
    perWeek[id] = round2(sums[id] / n)
    perActive[id] = round2(sums[id] / (activeWeight[id] || n))
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
  const weights = horizonWeights(horizon)
  const total = (ids: string[]) => wmean(perWeek(ids), weights)
  return { total, perWeek, weekly, weeks: horizon.map((w) => w.week), weights }
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
  const totalWeight = horizon.reduce((a, w) => a + (w.weight ?? 1), 0)
  const first = makeLineupEval(slots, players, horizon[0].pts, floor)
  const weekEvals = horizon.map((w) => makeLineupEval(slots, players, w.pts, floor))
  for (const team of teams) {
    const sums = slots.map(() => 0)
    horizon.forEach((w, wi) => {
      const ev = weekEvals[wi]
      const wt = w.weight ?? 1
      ev.assign(team.players).assignments.forEach((p, i) => {
        sums[i] += (p ? (isWaiverFill(p.id) ? p.pts : (w.pts[p.id] ?? 0)) : 0) * wt
      })
    })
    perTeamSlots[team.rosterId] = sums.map((s) => s / (totalWeight || 1))
    firstWeekStarters[team.rosterId] = first.assign(team.players).assignments.map((p) => (p && !isWaiverFill(p.id) ? p.id : null))
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
  /** Most players you will send in one deal. */
  maxGive: number
  /** Most players you will take back in one deal. */
  maxGet: number
  /** Most players in a deal, both sides together. */
  maxPlayers: number
  /** Their players to seed the search with, ranked by what each would add to you. */
  getPerTeam: number
  /** Partial deals kept alive per partner at each step of the search. */
  beamWidth: number
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
  /** Deals per partner that get the exact week-by-week scoring. */
  scoredPerTeam: number
  /** Most suggestions per partner in the final list, so one roster cannot crowd out the rest. */
  perPartner: number
  limit: number
}

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  maxGive: 4,
  maxGet: 4,
  maxPlayers: 6,
  getPerTeam: 12,
  beamWidth: 10,
  minMyGain: 0.1,
  minTheirGain: 0,
  maxValueAsk: 4,
  scoredPerTeam: 90,
  perPartner: 6,
  limit: 40,
}

/**
 * What the Trades page runs on top of the defaults: a longer list, since the
 * page groups near-copies into one card and filters by makeup and partner.
 */
export const SUGGESTED_TRADE_CONFIG: Partial<TradeConfig> = { limit: 80, perPartner: 8 }

/** Shape of a deal from your side: who sends more bodies. */
export type TradeShape = 'one-for-one' | 'consolidate' | 'depth' | 'swap'

export const tradeShape = (give: number, get: number): TradeShape =>
  give === 1 && get === 1 ? 'one-for-one' : give > get ? 'consolidate' : get > give ? 'depth' : 'swap'

export type TradeIdea = {
  partnerId: number
  get: string[]
  give: string[]
  shape: TradeShape
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
  /** Players each side would have to cut to stay under the roster limit. */
  myCuts: string[]
  theirCuts: string[]
  /** The weaker half of the deal, for ranking by how likely it is to land. */
  mutual: number
  /** Your gain in each horizon week. */
  perWeek: { week: number; mine: number; theirs: number }[]
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
  /** Optional hook for inspecting the search. */
  onFunnel?: (f: TradeFunnel) => void
}

/** What the search looked at, for tuning it. */
export type TradeFunnel = {
  /** Packages screened, seeds and grown deals together. */
  combinations: number
  /** Deals that reached the exact week-by-week pass. */
  scored: number
  /** Packages screened out for asking too much open-market value; exact already, so cut before the exact pass. */
  rejectedValueAsk: number
  rejectedMyGain: number
  rejectedTheirGain: number
  /** Deals that passed every filter, before trimming to the final list. */
  kept: number
}

/**
 * Top `n` overall, topped up so every shape keeps its best `perShape`. Without
 * this the single best cluster of deals — usually some two-for-two — crowds
 * every other makeup out of both the search and the shortlist.
 */
const diverseTop = <T extends { give: string[]; get: string[]; objective: number }>(xs: T[], n: number, perShape: number): T[] => {
  const sorted = [...xs].sort((a, b) => b.objective - a.objective)
  const out = new Set(sorted.slice(0, n))
  const counts = new Map<TradeShape, number>()
  for (const x of out) counts.set(tradeShape(x.give.length, x.get.length), (counts.get(tradeShape(x.give.length, x.get.length)) ?? 0) + 1)
  for (const x of sorted) {
    const shape = tradeShape(x.give.length, x.get.length)
    if (out.has(x) || (counts.get(shape) ?? 0) >= perShape) continue
    out.add(x)
    counts.set(shape, (counts.get(shape) ?? 0) + 1)
  }
  return [...out]
}

const dealKey = (give: string[], get: string[]) => `${[...give].sort().join(',')}>${[...get].sort().join(',')}`
const cutBy = (before: string[], out: string[], incoming: string[], after: string[]) => {
  const kept = new Set(after)
  const leaving = new Set(out)
  return before.filter((id) => !leaving.has(id) && !kept.has(id)).concat(incoming.filter((id) => !kept.has(id)))
}

/**
 * The exact week-by-week pricing of a deal, shared by the search and the
 * builder so a suggestion card and its "Adjust" view always agree.
 */
const makeDealScorer = (slots: Slot[], players: PlayerMap, horizon: Horizon, floor: WaiverFloor, capacity: number, pts: Record<string, number>, market: Record<string, number>) => {
  const exact = makeHorizonEval(slots, players, horizon, floor)
  const firstWeek = makeLineupEval(slots, players, horizon[0].pts, floor)
  // A player below replacement has no trade value, not negative value — otherwise
  // asking for someone's worst bench body would shave the premium you ask for.
  const valueOf = (ids: string[]) => ids.reduce((a, id) => a + Math.max(0, market[id] ?? 0), 0)
  const bases = new Map<number, number[]>()
  const baseOf = (team: TradeTeam) => {
    let b = bases.get(team.rosterId)
    if (!b) bases.set(team.rosterId, (b = exact.perWeek(team.players)))
    return b
  }
  // What sending a set costs your lineup before anything comes back. Many deals share a give side.
  const costs = new Map<string, number>()
  const myCost = (me: TradeTeam, give: string[]) => {
    const key = [...give].sort().join(',')
    let c = costs.get(key)
    if (c === undefined) {
      const base = baseOf(me)
      c = round2(wmean(exact.perWeek(me.players.filter((id) => !give.includes(id))).map((v, i) => base[i] - v), exact.weights))
      costs.set(key, c)
    }
    return c
  }
  const slotPts = (ids: string[]) => firstWeek.assign(ids).assignments.map((p) => (p ? (isWaiverFill(p.id) ? p.pts : (horizon[0].pts[p.id] ?? 0)) : 0))

  /** Gains, cuts and value ask. `fills` is left null; label it with `fillsFor`. */
  const score = (me: TradeTeam, partner: TradeTeam, give: string[], get: string[]): TradeIdea => {
    const myBase = baseOf(me)
    const theirBase = baseOf(partner)
    const myRoster = applyTrade(me.players, give, get, capacity, pts)
    const theirRoster = applyTrade(partner.players, get, give, capacity, pts)
    const myAfter = exact.perWeek(myRoster)
    const theirAfter = exact.perWeek(theirRoster)
    const perWeek = exact.weeks.map((week, i) => ({ week, mine: round2(myAfter[i] - myBase[i]), theirs: round2(theirAfter[i] - theirBase[i]) }))
    const myGain = round2(wmean(perWeek.map((w) => w.mine), exact.weights))
    const theirGain = round2(wmean(perWeek.map((w) => w.theirs), exact.weights))
    return {
      partnerId: partner.rosterId,
      give,
      get,
      shape: tradeShape(give.length, get.length),
      myGain,
      theirGain,
      myCost: myCost(me, give),
      valueAsk: round2(valueOf(get) - valueOf(give)),
      weeksBetter: perWeek.filter((w) => w.mine > 0.05).length,
      weeks: perWeek.length,
      fills: null,
      myCuts: cutBy(me.players, give, get, myRoster),
      theirCuts: cutBy(partner.players, get, give, theirRoster),
      mutual: round2(Math.min(myGain, theirGain)),
      perWeek,
    }
  }

  /** The partner's starting slot that improves most in the first week, if any does. */
  const before = new Map<number, number[]>()
  const fillsFor = (partner: TradeTeam, idea: TradeIdea): TradeIdea['fills'] => {
    let b = before.get(partner.rosterId)
    if (!b) before.set(partner.rosterId, (b = slotPts(partner.players)))
    const after = slotPts(applyTrade(partner.players, idea.get, idea.give, capacity, pts))
    let fills: TradeIdea['fills'] = null
    let bestDelta = 0.05
    for (let i = 0; i < after.length; i++) {
      const delta = after[i] - (b[i] ?? 0)
      if (delta > bestDelta) {
        bestDelta = delta
        fills = { slot: slots[i].name, index: i, before: round2(b[i] ?? 0), after: round2(after[i]) }
      }
    }
    return fills
  }

  return { score, fillsFor, valueOf }
}

/**
 * Search every other roster for deals that leave both lineups better, in any
 * makeup up to the size caps: one-for-one, three-for-one consolidations,
 * one-for-three depth deals, two-for-two swaps.
 *
 * Enumerating every combination of up to four players a side is millions of
 * lineups per partner, so this grows deals instead. It seeds with every
 * one-for-one that helps you, then repeatedly tries adding one player to
 * either side — a sweetener from you when they need more, a second ask from
 * them when there is room — and keeps a growth only when it makes the deal
 * better. That is how people actually build offers, and it is why a
 * three-for-one turns up only when the third piece earns its place.
 *
 * Two passes, as before. Growth is steered by a cheap screen on mean weekly
 * points; the most promising deals per partner are then re-scored week by
 * week, and only those exact numbers are reported or filtered on. Uneven deals
 * cost the side taking more bodies its least useful player, and say who.
 */
export const findTrades = (input: TradeSearchInput): TradeIdea[] => {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...(input.config ?? {}) }
  const { slots, players, horizon, pts, me, others, capacity, market } = input
  const floor = input.floor ?? {}
  if (!horizon.length) return []

  const screen = makeLineupEval(slots, players, pts, floor)
  const scorer = makeDealScorer(slots, players, horizon, floor, capacity, pts, market)
  const { valueOf } = scorer
  const myScreenBase = screen.total(me.players)
  const mine = me.players.filter((id) => players[id])

  const funnel: TradeFunnel = { combinations: 0, scored: 0, rejectedValueAsk: 0, rejectedMyGain: 0, rejectedTheirGain: 0, kept: 0 }

  type State = { give: string[]; get: string[]; my: number; their: number; ask: number; objective: number }
  /**
   * What the search climbs. Your gain, plus credit for how much the other side
   * gains (a deal both like is likelier to happen), minus a steep charge for
   * every point below their bar and every point of premium above the cap, and
   * a small charge per extra body so a piece has to earn its place.
   */
  const objective = (my: number, their: number, ask: number, size: number) =>
    my +
    0.3 * Math.min(their, my) -
    2.5 * Math.max(0, cfg.minTheirGain - their) -
    0.6 * Math.max(0, ask - cfg.maxValueAsk) -
    0.15 * Math.max(0, size - 2)

  const ideas: TradeIdea[] = []

  for (const them of others) {
    const theirRoster = them.players.filter((id) => players[id])
    const theirScreenBase = screen.total(them.players)
    const seen = new Map<string, State>()
    const pool = new Map<string, State>()

    /** Screen a deal once; later parents reaching the same deal get the cached state. */
    const evaluate = (give: string[], get: string[]): State => {
      const key = dealKey(give, get)
      const cached = seen.get(key)
      if (cached) return cached
      funnel.combinations++
      const my = screen.total(applyTrade(me.players, give, get, capacity, pts)) - myScreenBase
      const their = screen.total(applyTrade(them.players, get, give, capacity, pts)) - theirScreenBase
      const ask = valueOf(get) - valueOf(give)
      const state = { give, get, my, their, ask, objective: objective(my, their, ask, give.length + get.length) }
      seen.set(key, state)
      // Anything within a point of the gain bars goes to the exact pass: the
      // screen misses in both directions by up to a point or so. The value
      // ask is already exact, so it is cut here rather than wasting a slot.
      if (ask > cfg.maxValueAsk) funnel.rejectedValueAsk++
      else if (my >= cfg.minMyGain - 1 && their >= cfg.minTheirGain - 1) pool.set(key, state)
      return state
    }

    // Seeds: every one-for-one with a player of theirs who would help you.
    const targets = theirRoster
      .map((id) => ({ id, add: screen.total([...me.players, id]) - myScreenBase }))
      .filter((c) => c.add > 0)
      .sort((a, b) => b.add - a.add)
      .slice(0, cfg.getPerTeam)
      .map((c) => c.id)
    if (!targets.length) continue
    let beam: State[] = []
    for (const get of targets) for (const give of mine) beam.push(evaluate([give], [get]))
    beam = diverseTop(beam, cfg.beamWidth, 0)

    // Growth: one player at a time, on either side, only when it helps.
    for (let size = 3; size <= cfg.maxPlayers && beam.length; size++) {
      const next: State[] = []
      // A child reachable from two parents is judged against each of them, but queued once.
      const queued = new Set<State>()
      for (const parent of beam) {
        const moves: [string[], string[]][] = []
        if (parent.give.length < cfg.maxGive) {
          for (const id of mine) if (!parent.give.includes(id)) moves.push([[...parent.give, id], parent.get])
        }
        if (parent.get.length < cfg.maxGet) {
          for (const id of theirRoster) if (!parent.get.includes(id)) moves.push([parent.give, [...parent.get, id]])
        }
        for (const [give, get] of moves) {
          const s = evaluate(give, get)
          if (s.objective > parent.objective + 0.05 && !queued.has(s)) {
            queued.add(s)
            next.push(s)
          }
        }
      }
      beam = diverseTop(next, cfg.beamWidth, 3)
    }

    // ---- Exact pass for this partner's most promising deals ----
    for (const cand of diverseTop([...pool.values()], cfg.scoredPerTeam, 20)) {
      funnel.scored++
      const idea = scorer.score(me, them, cand.give, cand.get)
      if (idea.myGain < cfg.minMyGain) funnel.rejectedMyGain++
      else if (idea.theirGain < cfg.minTheirGain) funnel.rejectedTheirGain++
      else ideas.push(idea)
    }
  }
  funnel.kept = ideas.length

  // ---- Final list ----
  // Drop padding: if a smaller deal inside this one does at least as well for
  // both sides, the extra piece is not earning its place.
  const byKey = new Map(ideas.map((i) => [dealKey(i.give, i.get), i]))
  const padded = (i: TradeIdea) => {
    for (const side of ['give', 'get'] as const) {
      if (i[side].length < 2) continue
      for (const id of i[side]) {
        const give = side === 'give' ? i.give.filter((x) => x !== id) : i.give
        const get = side === 'get' ? i.get.filter((x) => x !== id) : i.get
        const smaller = byKey.get(dealKey(give, get))
        if (smaller && smaller.myGain >= i.myGain - 0.05 && smaller.theirGain >= i.theirGain - 0.05) return true
      }
    }
    return false
  }
  // Variety: no more than a handful per partner, and no near-copies — a deal
  // sharing most of its players with one already chosen has to be clearly better.
  const ranked = ideas
    .filter((i) => !padded(i))
    .sort((a, b) => b.myGain - a.myGain || b.mutual - a.mutual)
  const chosen: TradeIdea[] = []
  const perPartner = new Map<number, number>()
  const overlap = (a: TradeIdea, b: TradeIdea) => {
    const sa = new Set([...a.give, ...a.get])
    const sb = [...b.give, ...b.get]
    const shared = sb.filter((id) => sa.has(id)).length
    return shared / Math.max(sa.size, sb.length)
  }
  for (const idea of ranked) {
    if (chosen.length >= cfg.limit) break
    if ((perPartner.get(idea.partnerId) ?? 0) >= cfg.perPartner) continue
    // A near-copy earns a place only as a genuinely different way to pay —
    // clearly better for them than every version already chosen — and no
    // deal gets more than three versions.
    const twins = chosen.filter((c) => c.partnerId === idea.partnerId && overlap(c, idea) >= 0.6)
    if (twins.length >= 3 || twins.some((t) => idea.theirGain <= t.theirGain + 0.5)) continue
    chosen.push(idea)
    perPartner.set(idea.partnerId, (perPartner.get(idea.partnerId) ?? 0) + 1)
  }
  input.onFunnel?.(funnel)

  // Label the hole each surviving deal plugs. Left until last because the
  // unpruned solve is the expensive one and only deals on screen need it.
  for (const idea of chosen) {
    const them = others.find((t) => t.rosterId === idea.partnerId)
    if (them) idea.fills = scorer.fillsFor(them, idea)
  }
  return chosen
}

/**
 * Price one hand-built deal with the same week-by-week math the search uses.
 * Any makeup, no filters: the builder wants the honest number even for a
 * terrible offer.
 */
export const scoreTrade = (input: {
  slots: Slot[]
  players: PlayerMap
  horizon: Horizon
  pts: Record<string, number>
  me: TradeTeam
  partner: TradeTeam
  give: string[]
  get: string[]
  capacity: number
  market: Record<string, number>
  floor?: WaiverFloor
}): TradeIdea | null => {
  const { slots, players, horizon, pts, me, partner, give, get, capacity, market } = input
  if (!horizon.length || (!give.length && !get.length)) return null
  const scorer = makeDealScorer(slots, players, horizon, input.floor ?? {}, capacity, pts, market)
  const idea = scorer.score(me, partner, give, get)
  idea.fills = scorer.fillsFor(partner, idea)
  return idea
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
