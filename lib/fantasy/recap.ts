// The weekly power-rank reveal: what a finished week did to the rankings, and why. Everything here reads the
// league's own matchups, so every figure on the recap is one the week actually produced. The rankings before and
// after are the same composite the Power page shows: before on the weeks through last week, with each roster as it
// went into the week and its players valued on those weeks; after on the weeks through this one, as it stands now.

import { persistMean, simulateSeason, winProb, type Forecast, type SimTeam } from './forecast'
import { optimalLineup, type LineupPlayer, type Slot } from './lineup'
import { activeParts, buildTeamSeasons, buildTeamWeeks, computePower, type PowerWeights, type TeamSeason, type TeamWeek } from './power'
import type { ScheduleGame } from './context'
import type { PlayerMap, SleeperMatchup } from './types'

/** A phrase about teams: plain text and team references, so the view can render names its own way. */
export type Part = string | { team: number }
export type Reason = { tone: 'pos' | 'neg' | 'neutral'; parts: Part[] }

export type RecapTeam = {
  rosterId: number
  rankBefore: number
  rankAfter: number
  /** Places gained: positive moved up. */
  move: number
  scoreBefore: number
  scoreAfter: number
  /** Each part of the composite after the week, as the regressed z-score the ranking weighs. */
  components: Record<keyof PowerWeights, number>
  points: number
  opponent: number | null
  oppPoints: number | null
  result: 'W' | 'L' | 'T' | null
  /** Points scored, 1 the week's most. */
  weekRank: number
  /** Best possible lineup from the same roster that week. */
  optimal: number
  /** Points scored as a share of the best possible lineup. */
  accuracy: number
  /** Points left on the bench: the best lineup less the one played. */
  bench: number
  /** Record after the week. */
  wins: number
  losses: number
  ties: number
  /** Pre-game expected score and chance to win, when the week had projections. */
  expected: number | null
  winProb: number | null
  /** The bench call that cost the most, if one did. */
  miss: Call | null
  reasons: Reason[]
}

export type RecapGame = {
  a: number
  b: number
  pa: number
  pb: number
  winner: number | null
  margin: number
  /** Pre-game odds that `a` wins, and of the side that did. */
  pA: number | null
  pWinner: number | null
}

export type Call = {
  rosterId: number
  /** The player who started. */
  started: string
  /** The player he was picked over. */
  sat: string
  startedPts: number
  satPts: number
  /** Points the call gained (good) or cost (bad). */
  diff: number
  /** A bad call worth more than the margin of a loss: it decided the game. */
  decisive?: boolean
}

export type Star = { pos: string; id: string; pts: number; owner: number; started: boolean }

export type Odds = { before: SimTeam; after: SimTeam }

export type Recap = {
  week: number
  /** Built from a week still being played, with projections standing in for games not yet final. */
  estimated: boolean
  teams: RecapTeam[]
  byId: Record<number, RecapTeam>
  games: RecapGame[]
  leagueAvg: number
  awards: {
    high: { rosterId: number; pts: number } | null
    low: { rosterId: number; pts: number } | null
    closest: RecapGame | null
    blowout: RecapGame | null
    upset: RecapGame | null
    /** Highest share of the best possible lineup. */
    sharpest: { rosterId: number; accuracy: number } | null
    /** Lowest share of the best possible lineup. */
    loosest: { rosterId: number; accuracy: number } | null
    /** Highest best-possible lineup: the roster with the most in it that week. */
    ceiling: { rosterId: number; pts: number } | null
    /** Most points left on the bench. */
    bench: { rosterId: number; pts: number } | null
    /** Starter furthest past his projection. */
    boom: { id: string; owner: number; pts: number; proj: number } | null
    riser: RecapTeam | null
    faller: RecapTeam | null
  }
  stars: Star[]
  /** The composite's weights, summing to one over the parts in use. */
  weights: Record<keyof PowerWeights, number>
  calls: { good: Call | null; bad: Call | null }
}

const round2 = (x: number) => Math.round(x * 100) / 100
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`

export type RecapInput = {
  week: number
  /** Regular-season weeks played before it. */
  priorWeeks: number[]
  /** Matchups by week; the recap week's may be estimated (see estimateWeek). */
  matchupsByWeek: Record<number, SleeperMatchup[]>
  slots: Slot[]
  players: PlayerMap
  rosterIds: number[]
  /** Roster strength now, for the ranking after the week. */
  strength: Record<number, number>
  /** Roster strength going into the week, for the ranking before it; today's when missing. */
  strengthBefore?: Record<number, number> | null
  weights: PowerWeights
  sigma: number
  /** Each player's pre-game projection for the week, for upsets and start/sit calls. */
  proj?: Record<string, number> | null
  /** Each team's pre-game expected score, when the model kept one; else the projected starters are summed. */
  expected?: Record<number, number> | null
  estimated?: boolean
}

const record = (s: TeamSeason | undefined) => ({ wins: s?.wins ?? 0, losses: s?.losses ?? 0, ties: s?.ties ?? 0 })

/** Bench calls for one team-week: the best one that went against the projections, and the worst one. */
export const lineupCalls = (tw: TeamWeek, slots: Slot[], players: PlayerMap, proj: Record<string, number> | null | undefined) => {
  const slotted = tw.slotted?.length ? tw.slotted : tw.starters
  const started = new Set(tw.starters)
  const bench = tw.players.filter((id) => !started.has(id) && players[id])
  const pts = (id: string) => tw.playersPoints[id] ?? 0
  let good: Call | null = null
  let bad: Call | null = null
  slotted.forEach((s, i) => {
    const slot = slots[i]
    if (!slot || !s || s === '0' || !players[s]) return
    for (const b of bench) {
      if (!players[b].fpos.some((p) => slot.eligible.includes(p))) continue
      const d = pts(s) - pts(b)
      if (d < 0 && (!bad || -d > bad.diff)) bad = { rosterId: tw.rosterId, started: s, sat: b, startedPts: pts(s), satPts: pts(b), diff: round2(-d) }
      // A good call is one made against the numbers: he was projected under the man he started over, and beat him.
      if (proj && d > 0 && (proj[b] ?? 0) > (proj[s] ?? 0) + 0.5 && (!good || d > good.diff)) good = { rosterId: tw.rosterId, started: s, sat: b, startedPts: pts(s), satPts: pts(b), diff: round2(d) }
    }
  })
  const g = good as Call | null
  const b = bad as Call | null
  if (b && tw.result === 'L' && tw.opponentPoints != null && b.diff > tw.opponentPoints - tw.points) b.decisive = true
  return { good: g, bad: b }
}

/** The composite's weights as it applied them: the parts it weighed, summing to one; the rest at zero. */
export const normalWeights = (w: PowerWeights, active: (keyof PowerWeights)[]): Record<keyof PowerWeights, number> => {
  const keys = Object.keys(w) as (keyof PowerWeights)[]
  const sum = active.reduce((a, k) => a + w[k], 0) || 1
  return Object.fromEntries(keys.map((k) => [k, active.includes(k) ? w[k] / sum : 0])) as Record<keyof PowerWeights, number>
}

export const buildRecap = (input: RecapInput): Recap => {
  const { week, priorWeeks, slots, players, rosterIds, strength, weights, sigma } = input
  const weeks = [...priorWeeks, week]
  const teamWeeks = buildTeamWeeks(input.matchupsByWeek, weeks, slots, players)
  const seasonsBefore = buildTeamSeasons(rosterIds, teamWeeks, priorWeeks, {})
  const seasonsAfter = buildTeamSeasons(rosterIds, teamWeeks, weeks, {})
  const before = computePower(seasonsBefore, input.strengthBefore ?? strength, weights, sigma)
  const after = computePower(seasonsAfter, strength, weights, sigma)
  const bBy = Object.fromEntries(before.map((p) => [p.rosterId, p]))
  const aBy = Object.fromEntries(after.map((p) => [p.rosterId, p]))
  const sAfter = Object.fromEntries(seasonsAfter.map((s) => [s.rosterId, s]))

  const tws = (teamWeeks[week] ?? []).filter((t) => rosterIds.includes(t.rosterId))
  const twBy: Record<number, TeamWeek> = Object.fromEntries(tws.map((t) => [t.rosterId, t]))
  const scored = [...tws].sort((x, y) => y.points - x.points)
  const weekRank: Record<number, number> = {}
  scored.forEach((t, i) => (weekRank[t.rosterId] = i + 1))
  const leagueAvg = tws.length ? tws.reduce((a, t) => a + t.points, 0) / tws.length : 0

  // Pre-game expectations: the model's when it kept them, else the projected starters as set.
  const expect = (t: TeamWeek) => {
    const e = input.expected?.[t.rosterId]
    if (e != null && e > 0) return e
    if (!input.proj) return null
    const sum = t.starters.reduce((a, id) => a + (input.proj![id] ?? 0), 0)
    return sum > 0 ? sum : null
  }

  // Games, each once.
  const games: RecapGame[] = []
  for (const t of tws) {
    if (t.opponentId == null || t.rosterId > t.opponentId || !twBy[t.opponentId]) continue
    const o = twBy[t.opponentId]
    const ea = expect(t)
    const eb = expect(o)
    const pA = ea != null && eb != null ? winProb(ea, eb, sigma) : null
    const winner = t.points > o.points ? t.rosterId : o.points > t.points ? o.rosterId : null
    games.push({
      a: t.rosterId,
      b: o.rosterId,
      pa: round2(t.points),
      pb: round2(o.points),
      winner,
      margin: round2(Math.abs(t.points - o.points)),
      pA,
      pWinner: pA == null || winner == null ? null : winner === t.rosterId ? pA : 1 - pA,
    })
  }
  const gameOf = (id: number) => games.find((g) => g.a === id || g.b === id) ?? null

  const callsBy: Record<number, ReturnType<typeof lineupCalls>> = {}
  for (const t of tws) callsBy[t.rosterId] = lineupCalls(t, slots, players, input.proj)

  const teams: RecapTeam[] = rosterIds.map((id) => {
    const t = twBy[id]
    const b = bBy[id]
    const a = aBy[id]
    const optimal = t ? Math.max(t.optimalPoints, t.points) : 0
    const e = t ? expect(t) : null
    const g = gameOf(id)
    const pa = g?.pA == null ? null : g.a === id ? g.pA : 1 - g.pA
    return {
      rosterId: id,
      rankBefore: b?.rank ?? 0,
      rankAfter: a?.rank ?? 0,
      move: (b?.rank ?? 0) - (a?.rank ?? 0),
      scoreBefore: b?.score ?? 50,
      scoreAfter: a?.score ?? 50,
      components: a?.components ?? { allPlay: 0, points: 0, recent: 0, roster: 0, efficiency: 0 },
      points: round2(t?.points ?? 0),
      opponent: t?.opponentId ?? null,
      oppPoints: t?.opponentPoints ?? null,
      result: t?.result ?? null,
      weekRank: weekRank[id] ?? 0,
      optimal: round2(optimal),
      accuracy: optimal > 0 ? (t?.points ?? 0) / optimal : 0,
      bench: round2(Math.max(0, optimal - (t?.points ?? 0))),
      ...record(sAfter[id]),
      expected: e == null ? null : round2(e),
      winProb: pa,
      miss: callsBy[id]?.bad ?? null,
      reasons: [],
    }
  })
  teams.sort((x, y) => x.rankAfter - y.rankAfter)
  const byId: Record<number, RecapTeam> = Object.fromEntries(teams.map((t) => [t.rosterId, t]))
  const n = tws.length

  // Why each team moved: the week's facts about it, most telling first, two at most.
  for (const t of teams) {
    const out: { w: number; r: Reason }[] = []
    const g = gameOf(t.rosterId)
    const opp = t.opponent
    const margin = t.oppPoints != null ? Math.abs(t.points - t.oppPoints) : 0
    const upset = g && g.pWinner != null && g.pWinner < 0.4
    if (t.result === 'W' && opp != null) {
      if (upset) out.push({ w: 9, r: { tone: 'pos', parts: [`Upset `, { team: opp }, ` as a ${Math.round(g!.pWinner! * 100)}% underdog`] } })
      else out.push({ w: margin >= 30 ? 6 : 3, r: { tone: 'pos', parts: [`Beat `, { team: opp }, ` by ${margin.toFixed(1)}`] } })
    } else if (t.result === 'L' && opp != null) {
      if (upset) out.push({ w: 9, r: { tone: 'neg', parts: [`Upset by `, { team: opp }, ` as a ${Math.round((1 - g!.pWinner!) * 100)}% favourite`] } })
      else out.push({ w: margin >= 30 ? 6 : 3, r: { tone: 'neg', parts: [`Lost to `, { team: opp }, ` by ${margin.toFixed(1)}`] } })
    } else if (t.result === 'T' && opp != null) out.push({ w: 5, r: { tone: 'neutral', parts: [`Tied `, { team: opp }] } })
    if (n > 2 && t.weekRank === 1) out.push({ w: 8, r: { tone: 'pos', parts: [`Week-high ${t.points.toFixed(1)}`] } })
    else if (n > 2 && t.weekRank === n) out.push({ w: 8, r: { tone: 'neg', parts: [`Week-low ${t.points.toFixed(1)}`] } })
    else if (t.result === 'L' && t.weekRank <= 3) out.push({ w: 7, r: { tone: 'neutral', parts: [`Lost with the ${ordinal(t.weekRank)}-most points`] } })
    else if (t.result === 'W' && t.weekRank > n - 3) out.push({ w: 7, r: { tone: 'neutral', parts: [`Won with the ${ordinal(t.weekRank)}-most points`] } })
    else if (t.weekRank <= 3) out.push({ w: 4, r: { tone: 'pos', parts: [`${ordinal(t.weekRank)}-most points, ${t.points.toFixed(1)}`] } })
    if (t.miss?.decisive) out.push({ w: 8.5, r: { tone: 'neg', parts: [`Bench call cost the game: ${t.miss.diff.toFixed(1)} pts`] } })
    else if (t.bench >= 25) out.push({ w: 2, r: { tone: 'neg', parts: [`Left ${t.bench.toFixed(1)} on the bench`] } })
    if (t.optimal > 0 && t.accuracy >= 0.995) out.push({ w: 5, r: { tone: 'pos', parts: ['Perfect lineup'] } })
    t.reasons = out.sort((x, y) => y.w - x.w).slice(0, 2).map((x) => x.r)
  }

  // Awards.
  const by = <T>(xs: T[], f: (x: T) => number) => (xs.length ? xs.reduce((m, x) => (f(x) > f(m) ? x : m)) : null)
  const played = teams.filter((t) => twBy[t.rosterId])
  const hi = scored[0]
  const lo = scored[scored.length - 1]
  const decided = games.filter((g) => g.winner != null)
  const closest = decided.length ? decided.reduce((m, g) => (g.margin < m.margin ? g : m)) : null
  const blowout = by(decided, (g) => g.margin)
  const upset = decided.filter((g) => g.pWinner != null && g.pWinner < 0.5).reduce<RecapGame | null>((m, g) => (!m || g.pWinner! < m.pWinner! ? g : m), null)
  const withLineup = played.filter((t) => t.optimal > 0)
  const sharpest = by(withLineup, (t) => t.accuracy + t.points * 1e-6)
  const loosest = by(withLineup, (t) => -t.accuracy)
  const ceiling = by(withLineup, (t) => t.optimal)
  const benchMost = by(withLineup, (t) => t.bench)
  let boom: Recap['awards']['boom'] = null
  if (input.proj)
    for (const t of tws)
      for (const id of t.starters) {
        const p = input.proj[id]
        if (p == null || p <= 0) continue
        const pts = t.playersPoints[id] ?? 0
        if (!boom || pts - p > boom.pts - boom.proj) boom = { id, owner: t.rosterId, pts: round2(pts), proj: round2(p) }
      }
  const moved = teams.filter((t) => t.move !== 0)
  const riser = moved.filter((t) => t.move > 0).reduce<RecapTeam | null>((m, t) => (!m || t.move > m.move || (t.move === m.move && t.rankAfter < m.rankAfter) ? t : m), null)
  const faller = moved.filter((t) => t.move < 0).reduce<RecapTeam | null>((m, t) => (!m || t.move < m.move || (t.move === m.move && t.rankAfter > m.rankAfter) ? t : m), null)

  // The best player at each of the big positions, rostered anywhere in the league.
  const stars: Star[] = []
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    let best: Star | null = null
    for (const t of tws)
      for (const id of t.players) {
        if (players[id]?.pos !== pos) continue
        const pts = t.playersPoints[id] ?? 0
        if (!best || pts > best.pts) best = { pos, id, pts: round2(pts), owner: t.rosterId, started: t.starters.includes(id) }
      }
    if (best && best.pts > 0) stars.push(best)
  }

  const allCalls = Object.values(callsBy)
  const good = allCalls.reduce<Call | null>((m, c) => (c.good && (!m || c.good.diff > m.diff) ? c.good : m), null)
  const bad = allCalls.reduce<Call | null>((m, c) => (c.bad && (!m || c.bad.diff > m.diff) ? c.bad : m), null)

  return {
    week,
    estimated: !!input.estimated,
    teams,
    byId,
    games: games.sort((x, y) => Math.min(byId[x.a]?.rankAfter ?? 99, byId[x.b]?.rankAfter ?? 99) - Math.min(byId[y.a]?.rankAfter ?? 99, byId[y.b]?.rankAfter ?? 99)),
    leagueAvg: round2(leagueAvg),
    awards: {
      high: hi ? { rosterId: hi.rosterId, pts: round2(hi.points) } : null,
      low: lo && n > 1 ? { rosterId: lo.rosterId, pts: round2(lo.points) } : null,
      closest,
      blowout,
      upset,
      sharpest: sharpest ? { rosterId: sharpest.rosterId, accuracy: sharpest.accuracy } : null,
      loosest: loosest && loosest !== sharpest ? { rosterId: loosest.rosterId, accuracy: loosest.accuracy } : null,
      ceiling: ceiling ? { rosterId: ceiling.rosterId, pts: ceiling.optimal } : null,
      bench: benchMost && benchMost.bench > 0 ? { rosterId: benchMost.rosterId, pts: benchMost.bench } : null,
      boom,
      riser,
      faller,
    },
    stars,
    weights: normalWeights(weights, activeParts(seasonsAfter, strength, weights)),
    calls: { good, bad },
  }
}

/** Seasons simulated on each side of the week. */
export const RECAP_SIMS = 2000

/**
 * Playoff odds just before the week and just after it, on the same model and the same random draws, so the gap is
 * the week's results. Records come from the recap's own weeks; the weeks ahead are the model's.
 */
export type RecapOddsInput = {
  recap: Recap
  priorWeeks: number[]
  matchupsByWeek: Record<number, SleeperMatchup[]>
  slots: Slot[]
  players: PlayerMap
  rosterIds: number[]
  forecast: Forecast
  /** Regular-season games after the recap week. */
  schedule: { week: number; a: number; b: number }[]
  playoffWeeks: number[]
  playoffTeams: number
  /** Regular-season weeks left after the recap week. */
  weeksLeft: number
  sims?: number
}

/**
 * The two simulations behind recapOdds, before and after the week, each runnable in slices: `slice(k, sims)` plays
 * `sims` seasons from its own seed, the same seed on both sides, so the pair still shares its draws. Equal slices
 * averaged together (mergeSims) are one larger simulation, so a caller can spread the work over idle moments.
 */
export const recapOddsRuns = (opts: RecapOddsInput) => {
  const { recap, rosterIds, forecast } = opts
  const weeks = [...opts.priorWeeks, recap.week]
  const teamWeeks = buildTeamWeeks(opts.matchupsByWeek, weeks, opts.slots, opts.players)
  const rec = (ws: number[]) => {
    const out: Record<number, { wins: number; losses: number; ties: number; pf: number }> = {}
    for (const s of buildTeamSeasons(rosterIds, teamWeeks, ws, {})) out[s.rosterId] = { wins: s.wins, losses: s.losses, ties: s.ties, pf: s.pf }
    return out
  }
  const ahead = opts.schedule.filter((g) => g.week > recap.week)
  const thisWeek = recap.games.map((g) => ({ week: recap.week, a: g.a, b: g.b }))
  const base = {
    teams: rosterIds,
    playoffWeeks: opts.playoffWeeks,
    playoffTeams: opts.playoffTeams,
    mean: persistMean(forecast.mean, rosterIds),
    sigma: forecast.sigma,
    tau: forecast.tau,
  }
  const recordBefore = rec(opts.priorWeeks)
  const recordAfter = rec(weeks)
  const seed = (k: number) => (20240917 + k * 7919) >>> 0
  return {
    before: (k: number, sims: number) => simulateSeason({ ...base, sims, seed: seed(k), record: recordBefore, schedule: [...thisWeek, ...ahead], weeksLeft: opts.weeksLeft + 1 }),
    after: (k: number, sims: number) => simulateSeason({ ...base, sims, seed: seed(k), record: recordAfter, schedule: ahead, weeksLeft: opts.weeksLeft }),
  }
}

/** Equal-sized simulation slices averaged into one. Clinches are settled by arithmetic, so every slice agrees on them. */
export const mergeSims = (parts: Record<number, SimTeam>[]): Record<number, SimTeam> => {
  const out: Record<number, SimTeam> = {}
  const n = parts.length
  if (!n) return out
  for (const id of Object.keys(parts[0]).map(Number)) {
    const first = parts[0][id]
    const avg = (f: (s: SimTeam) => number) => parts.reduce((a, p) => a + f(p[id]), 0) / n
    out[id] = {
      rosterId: id,
      wins: avg((s) => s.wins),
      playoffs: avg((s) => s.playoffs),
      bye: avg((s) => s.bye),
      final: avg((s) => s.final),
      title: avg((s) => s.title),
      seeds: first.seeds.map((_, i) => avg((s) => s.seeds[i] ?? 0)),
      clinch: first.clinch,
    }
  }
  return out
}

export const joinOdds = (rosterIds: number[], before: Record<number, SimTeam>, after: Record<number, SimTeam>): Record<number, Odds> =>
  Object.fromEntries(rosterIds.map((id) => [id, { before: before[id], after: after[id] }]))

export const recapOdds = (opts: RecapOddsInput): Record<number, Odds> => {
  const runs = recapOddsRuns(opts)
  const sims = opts.sims ?? RECAP_SIMS
  return joinOdds(opts.rosterIds, runs.before(0, sims), runs.after(0, sims))
}

/** Seasons per slice when the simulation is spread over idle time. */
export const RECAP_SLICE = 125

/**
 * The week as it stands, finished: final games at their points, games under way at what is on the board plus the
 * rest of the projection, games not started at the projection. For previewing a reveal before the week is done.
 */
export const estimateWeek = (
  matchups: SleeperMatchup[],
  proj: Record<string, number>,
  /**
   * Each player's game: final, under way (with the share played, when known, or a finish already estimated),
   * not started, or none (a bye).
   */
  stateOf: (id: string) => { state: 'final' | 'live' | 'pre'; elapsed?: number; expect?: number } | null,
): SleeperMatchup[] =>
  matchups.map((m) => {
    const posted = m.players_points ?? {}
    const pp: Record<string, number> = {}
    for (const id of m.players ?? []) {
      const s = stateOf(id)
      const have = posted[id] ?? 0
      const p = proj[id] ?? 0
      pp[id] = round2(!s ? have : s.state === 'final' ? have : s.state === 'live' ? (s.expect ?? have + p * (1 - Math.min(1, Math.max(0, s.elapsed ?? 0.5)))) : p)
    }
    const starters = (m.starters ?? []).filter((id) => id && id !== '0')
    return { ...m, players_points: pp, points: round2(starters.reduce((a, id) => a + (pp[id] ?? 0), 0)) }
  })

/**
 * The passes of an odd-even transposition sort from one order to another: each pass swaps neighbours that are out
 * of place. The reveal plays them back as the ranking sorting itself. Passes that swap nothing are left out.
 */
export const sortPasses = (from: number[], to: number[]): { order: number[]; swaps: number[] }[] => {
  const target = new Map(to.map((id, i) => [id, i]))
  const order = from.filter((id) => target.has(id))
  const out: { order: number[]; swaps: number[] }[] = []
  for (let pass = 0, quiet = 0; quiet < 2 && pass < order.length * 2 + 2; pass++) {
    const swaps: number[] = []
    for (let i = pass % 2; i + 1 < order.length; i += 2) {
      if (target.get(order[i])! > target.get(order[i + 1])!) {
        ;[order[i], order[i + 1]] = [order[i + 1], order[i]]
        swaps.push(i)
      }
    }
    if (swaps.length) {
      out.push({ order: [...order], swaps })
      quiet = 0
    } else quiet++
  }
  return out
}

/** Weeks with points on the board. */
const hasScores = (ms: SleeperMatchup[] | undefined) => !!ms && ms.some((m) => (m.points ?? 0) > 0)

/** Whether every NFL game of a week is final by the schedule (canceled games aside). */
export const weekFinal = (games: ScheduleGame[] | undefined, week: number) => {
  const gs = (games ?? []).filter((g) => g.week === week && g.status !== 'canceled')
  return gs.length > 0 && gs.every((g) => g.status === 'complete')
}

/**
 * The week a reveal is for: the latest regular-season week that is over, either settled into the model already or
 * with every NFL game final. Null before the first one.
 */
export const revealWeek = (opts: {
  regularWeeks: number[]
  matchupsByWeek: Record<number, SleeperMatchup[]>
  games?: ScheduleGame[]
  /** Sleeper's current week. */
  week: number
  playoffStart: number
}): number | null => {
  const settled = opts.regularWeeks.length ? Math.max(...opts.regularWeeks) : null
  for (const w of [opts.week, opts.week - 1]) {
    if (w >= opts.playoffStart || w < 1 || (settled != null && w <= settled)) continue
    if (hasScores(opts.matchupsByWeek[w]) && weekFinal(opts.games, w)) return w
  }
  return settled
}

/** Regular-season weeks before `week` with points on the board. */
export const weeksBefore = (matchupsByWeek: Record<number, SleeperMatchup[]>, week: number, playoffStart: number) =>
  Object.keys(matchupsByWeek)
    .map(Number)
    .filter((w) => w < week && w < playoffStart && hasScores(matchupsByWeek[w]))
    .sort((a, b) => a - b)

/**
 * When a week's reveal opens on its own: Tuesday 6am local after its last game. A week whose games ran past Monday
 * opens at 6am the day after its last one. Null when the schedule has no dates (then it opens straight away).
 */
export const revealGate = (games: ScheduleGame[] | undefined, week: number): Date | null => {
  const dates = (games ?? []).filter((g) => g.week === week && g.date).map((g) => g.date!) // YYYY-MM-DD
  if (!dates.length) return null
  const last = dates.sort()[dates.length - 1]
  const [y, m, d] = last.split('-').map(Number)
  const gate = new Date(y, m - 1, d + 1, 6, 0, 0, 0)
  // Sunday or Monday: wait for Tuesday, after the Monday night game.
  while (gate.getDay() === 0 || gate.getDay() === 1) gate.setDate(gate.getDate() + 1)
  return gate
}

/**
 * When a week's reveal goes stale: the first game day of the week after it. Past that the next week is under way, so the
 * reveal no longer opens by itself (it can still be replayed). Null without a schedule for that week.
 */
export const revealStale = (games: ScheduleGame[] | undefined, week: number): Date | null => {
  const dates = (games ?? []).filter((g) => g.week === week + 1 && g.date).map((g) => g.date!)
  if (!dates.length) return null
  const [y, m, d] = dates.sort()[0].split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

export const revealSeenKey = (leagueId: string, season: string, week: number) => `ff:reveal:${leagueId}:${season}:${week}`
