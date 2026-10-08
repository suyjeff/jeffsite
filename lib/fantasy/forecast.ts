// Ratings, win probabilities and season simulation.
//
// The shape follows the public outline of Nate Silver's ELWAY ("Elo with
// Lineup Weights and Adjusted Yardage") and FiveThirtyEight's NFL Elo before
// it, translated to a game where nobody plays defense:
//
//   Elo        A results-only rating: margin-aware updates (538's MOV
//              multiplier), a prior carried over from last season and
//              regressed a third of the way to the mean. Kept as the
//              benchmark the richer model has to beat.
//   Lineup     ELWAY's lineup weights (QBERT adjusts for the quarterback who
//              actually starts). In fantasy the whole lineup is known in
//              advance, so the forward rating is the projected optimal lineup
//              each week, after injury odds and byes, times how much of the
//              optimum this manager actually starts, shrunk to the league.
//   Form       What results add on top: the share of a team's scoring beyond
//              its own projections, heavily shrunk, since most of it is noise.
//   Sim        Seasons played out week by week with a team-level draw that
//              persists all season (the projections can be wrong about a team
//              for the whole year, not just one week) plus weekly noise
//              measured from this league's own misses. Then the bracket.
//
// The backtest scores every model on games it had not seen, so which one to
// trust is a measured answer, not a choice of taste.

import { makeLineupEval, makeHorizonEval, type Horizon, type TradeTeam, type WaiverFloor } from './trades'
import { deadSlotFill, deadStarters, type Slot } from './lineup'
import type { TeamWeek } from './power'
import type { PlayerMap } from './types'

const round2 = (x: number) => Math.round(x * 100) / 100
const round3 = (x: number) => Math.round(x * 1000) / 1000

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 on erf), |error| < 1.5e-7. */
export const phi = (x: number) => {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

/** Seeded PRNG (mulberry32), so a simulation is repeatable and two can share draws. */
export const rng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Standard normals from a uniform source (Box–Muller, both halves used). */
export const normals = (u: () => number) => {
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    let a = 0
    while (a === 0) a = u()
    const r = Math.sqrt(-2 * Math.log(a))
    const th = 2 * Math.PI * u()
    spare = r * Math.sin(th)
    return r * Math.cos(th)
  }
}

// ---------- Games ----------

export type Game = { week: number; a: number; b: number; pa: number; pb: number }

/** Head-to-head games from team weeks; each pairing once. */
export const gamesFrom = (teamWeeks: Record<number, TeamWeek[]>, weeks: number[], map?: Record<number, number>): Game[] => {
  const out: Game[] = []
  for (const week of weeks) {
    for (const t of teamWeeks[week] ?? []) {
      if (t.opponentId == null || t.opponentPoints == null || t.rosterId > t.opponentId) continue
      const a = map ? map[t.rosterId] : t.rosterId
      const b = map ? map[t.opponentId] : t.opponentId
      if (a == null || b == null) continue
      out.push({ week, a, b, pa: t.points, pb: t.opponentPoints })
    }
  }
  return out
}

// ---------- Elo ----------

export const ELO = {
  base: 1500,
  /** Update size. 538 used 20 for the NFL; fantasy weeks are noisier, so slightly less. */
  k: 18,
  /** Share of last season's distance from the mean that is forgotten over the summer. */
  regress: 1 / 3,
}

export const eloWinProb = (diff: number) => 1 / (1 + Math.pow(10, -diff / 400))

/**
 * 538's margin-of-victory multiplier, ln(|margin| + 1) · 2.2 / (0.001·Δelo + 2.2),
 * with the fantasy margin rescaled to the NFL's spread first: fantasy margins
 * run roughly 2.5× wider, and the log would otherwise overweight them.
 */
export const movMultiplier = (margin: number, winnerEloDiff: number, marginScale: number) =>
  (Math.log(Math.abs(margin) * marginScale + 1) * 2.2) / (winnerEloDiff * 0.001 + 2.2)

export type EloRun = {
  /** Ratings going into each week (before its games). */
  before: Record<number, Record<number, number>>
  final: Record<number, number>
}

export const runElo = (games: Game[], teams: number[], start: Record<number, number> = {}, marginSd = 35): EloRun => {
  const r: Record<number, number> = {}
  for (const t of teams) r[t] = start[t] ?? ELO.base
  const before: Record<number, Record<number, number>> = {}
  const scale = 14 / Math.max(1, marginSd)
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b)
  for (const week of weeks) {
    before[week] = { ...r }
    for (const g of games.filter((x) => x.week === week)) {
      const ra = r[g.a] ?? ELO.base
      const rb = r[g.b] ?? ELO.base
      const exp = eloWinProb(ra - rb)
      const actual = g.pa > g.pb ? 1 : g.pa < g.pb ? 0 : 0.5
      const winnerDiff = actual === 1 ? ra - rb : actual === 0 ? rb - ra : 0
      const shift = ELO.k * movMultiplier(g.pa - g.pb, winnerDiff, scale) * (actual - exp)
      r[g.a] = ra + shift
      r[g.b] = rb - shift
    }
  }
  return { before, final: r }
}

/** Last season's closing ratings, a third of the way back to 1500. */
export const preseasonElo = (lastSeason: Record<number, number>) => {
  const out: Record<number, number> = {}
  for (const k of Object.keys(lastSeason)) out[Number(k)] = ELO.base + (1 - ELO.regress) * (lastSeason[Number(k)] - ELO.base)
  return out
}

// ---------- Lineup ratings ----------

/**
 * Prior strength, in games, for a manager's efficiency (points per projected
 * point). Heavy on the evidence: at 8 games, per-manager efficiency graded
 * slightly worse than the raw projection in both leagues tested (Brier 0.213
 * vs 0.192 on 15 games; 0.247 vs 0.242 on 18), so a manager needs most of a
 * season before their own number carries half the weight.
 */
export const EFFICIENCY_PRIOR_GAMES = 24
export const FORM_PRIOR_GAMES = 8
/**
 * How much form counts in the rating. Zero, on the evidence: in both leagues
 * tested, adding form made next-week predictions worse (Brier 0.204 → 0.224
 * on 15 games, 0.248 → 0.253 on 18). Points beyond projection are mostly noise
 * the projections already absorb. It is still computed and shown, and the
 * backtest keeps grading it, so the call can be revisited as games accrue.
 */
export const FORM_WEIGHT = 0

export type TeamRating = {
  rosterId: number
  /** Projected optimal lineup, points per week over the horizon (adjusted for injury odds and byes). */
  projected: number
  /** Share of the optimum this manager starts, shrunk toward the league. */
  efficiency: number
  /** Shrunk points per week beyond projections, from results. */
  form: number
  /** What the model expects per week: projected × efficiency (+ form × FORM_WEIGHT). */
  rating: number
  elo: number
  /** Expected weekly points, keyed by week, for the weeks ahead. */
  byWeek: Record<number, number>
}

export type ForecastInput = {
  slots: Slot[]
  players: PlayerMap
  horizon: Horizon
  floor: WaiverFloor
  teams: TradeTeam[]
  teamWeeks: Record<number, TeamWeek[]>
  playedWeeks: number[]
  /** Sleeper's projection for completed weeks, for form and for measuring weekly noise. */
  pastProjections: Record<number, Record<string, number>>
  /** Remaining regular-season pairings. */
  schedule: { week: number; a: number; b: number }[]
  record: Record<number, { wins: number; losses: number; ties: number; pf: number }>
  playoffWeeks: number[]
  playoffTeams: number
  elo: Record<number, number>
  /** Fallback weekly noise when there is nothing to measure it from. */
  sigmaFallback: number
  /** Regular-season weeks left on the calendar (the schedule above can be missing one that failed to load). */
  weeksLeft?: number
}

/** Each team's projected optimal lineup in every completed week that has projections, from the roster it had then. */
export const pastByWeek = (input: Pick<ForecastInput, 'slots' | 'players' | 'floor' | 'playedWeeks' | 'pastProjections' | 'teamWeeks'>) => {
  const out: Record<number, Record<number, number>> = {}
  for (const w of input.playedWeeks) {
    const pts = input.pastProjections[w]
    if (!pts) continue
    const ev = makeLineupEval(input.slots, input.players, pts, input.floor)
    out[w] = {}
    for (const t of input.teamWeeks[w] ?? []) out[w][t.rosterId] = ev.total(t.players)
  }
  return out
}

/**
 * Points scored, plus a replacement-level body for every slot left dead (empty,
 * or a starter on bye or ruled out). Efficiency should measure how a manager
 * picks between real options, not punish a week they forgot to swap out a bye:
 * that is rare, and it says little about the weeks ahead, where the model
 * already assumes the best lineup available.
 */
export const managedPoints = (tw: TeamWeek, slots: Slot[], proj: Record<string, number> | undefined, floor: WaiverFloor) =>
  proj ? tw.points + deadSlotFill(deadStarters(slots, tw.slotted, proj, tw.playersPoints), floor) : tw.points

/** managedPoints for every team-week that has projections, keyed week → rosterId, so it is solved once. */
export const managedByWeek = (input: Pick<ForecastInput, 'slots' | 'floor' | 'pastProjections' | 'teamWeeks'>, past: Record<number, Record<number, number>>) => {
  const out: Record<number, Record<number, number>> = {}
  for (const w of Object.keys(past).map(Number)) {
    out[w] = {}
    for (const t of input.teamWeeks[w] ?? []) out[w][t.rosterId] = managedPoints(t, input.slots, input.pastProjections[w], input.floor)
  }
  return out
}

/**
 * Weekly noise around a team's expectation: the spread of (actual − projected
 * × efficiency) across every team-week we can measure. Falls back to a share
 * of the league's score spread before any week has both.
 */
export const measureNoise = (input: ForecastInput, efficiency: Record<number, number>, past = pastByWeek(input), managed = managedByWeek(input, past)) => {
  const resid: number[] = []
  for (const w of Object.keys(past).map(Number)) {
    for (const t of input.teamWeeks[w] ?? []) {
      const proj = past[w][t.rosterId]
      if (proj > 0) resid.push(managed[w][t.rosterId] - proj * (efficiency[t.rosterId] ?? 1))
    }
  }
  if (resid.length < 8) return { sigma: input.sigmaFallback, n: resid.length, bias: 0 }
  const m = resid.reduce((a, b) => a + b, 0) / resid.length
  const sd = Math.sqrt(resid.reduce((a, x) => a + (x - m) ** 2, 0) / (resid.length - 1))
  return { sigma: sd, n: resid.length, bias: m }
}

export const teamRatings = (input: ForecastInput, past = pastByWeek(input)) => {
  const { teams, teamWeeks, playedWeeks } = input
  const evalH = input.horizon.length ? makeHorizonEval(input.slots, input.players, input.horizon, input.floor) : null
  // Efficiency is measured against the same thing it scales: points scored per
  // point of *projected* optimal lineup. (Against the hindsight optimum it would
  // count the projection's own shortfall twice.) League first, then each
  // manager, shrunk toward it.
  const managed = managedByWeek(input, past)
  let actualAll = 0
  let projAll = 0
  const games: Record<number, { actual: number; proj: number; n: number }> = {}
  for (const w of Object.keys(past).map(Number)) {
    for (const t of teamWeeks[w] ?? []) {
      const proj = past[w][t.rosterId]
      if (!(proj > 0)) continue
      const g = (games[t.rosterId] ??= { actual: 0, proj: 0, n: 0 })
      const pts = managed[w][t.rosterId]
      g.actual += pts
      g.proj += proj
      g.n++
      actualAll += pts
      projAll += proj
    }
  }
  const leagueEff = projAll ? actualAll / projAll : 1
  const efficiency: Record<number, number> = {}
  for (const t of teams) {
    const g = games[t.rosterId]
    const own = g && g.proj ? g.actual / g.proj : leagueEff
    const n = g?.n ?? 0
    efficiency[t.rosterId] = (n * own + EFFICIENCY_PRIOR_GAMES * leagueEff) / (n + EFFICIENCY_PRIOR_GAMES)
  }
  const noise = measureNoise(input, efficiency, past, managed)

  // Form: points beyond the team's own projection, per game, shrunk hard.
  const form: Record<number, number> = {}
  for (const t of teams) {
    let sum = 0
    let n = 0
    for (const w of Object.keys(past).map(Number)) {
      const pts = managed[w][t.rosterId]
      const proj = past[w][t.rosterId]
      if (pts === undefined || !(proj > 0)) continue
      sum += pts - proj * efficiency[t.rosterId] - noise.bias
      n++
    }
    form[t.rosterId] = n ? sum / (n + FORM_PRIOR_GAMES) : 0
  }

  const ratings: TeamRating[] = teams.map((t) => {
    const perWeek = evalH ? evalH.perWeek(t.players) : []
    const byWeek: Record<number, number> = {}
    input.horizon.forEach((h, i) => (byWeek[h.week] = perWeek[i] * efficiency[t.rosterId] + FORM_WEIGHT * form[t.rosterId]))
    const projected = perWeek.length ? perWeek.reduce((a, b) => a + b, 0) / perWeek.length : 0
    return {
      rosterId: t.rosterId,
      projected: round2(projected),
      efficiency: round3(efficiency[t.rosterId]),
      form: round2(form[t.rosterId]),
      rating: round2(projected * efficiency[t.rosterId] + FORM_WEIGHT * form[t.rosterId]),
      elo: Math.round(input.elo[t.rosterId] ?? ELO.base),
      byWeek,
    }
  })
  return { ratings, noise, leagueEff }
}

// ---------- Simulation ----------

/** Seeds in fixed-bracket order: 1 meets the lowest seed, and the top two only meet in the final. */
export const bracketOrder = (size: number): number[] => {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

export type SimTeam = {
  rosterId: number
  /** Mean simulated regular-season wins, games already played included. */
  wins: number
  playoffs: number
  bye: number
  final: number
  title: number
  /** Probability of each seed, 1-indexed (index 0 unused). */
  seeds: number[]
  /** Settled by the arithmetic of wins alone, whatever happens: 'in', 'out', or null while still open. */
  clinch: 'in' | 'out' | null
}

/**
 * Playoff spots settled by wins alone. A team is in when, even losing out,
 * fewer than `spots` other teams could still reach its win total; out when at
 * least `spots` teams already have more wins than it could reach. Ties count
 * against the team (points-for is unknown in advance), and head-to-head games
 * are not netted out, so this only ever errs toward "still open".
 *
 * `weeksLeft` is how many regular-season weeks remain on the calendar. Each
 * team is assumed to play at least that many games, so a week whose matchups
 * failed to load never makes a race look decided. With nothing left to play,
 * the standings are final and points-for breaks the ties.
 */
export const clinchStatus = (
  teams: number[],
  record: Record<number, { wins: number; ties: number; pf?: number }>,
  schedule: { a: number; b: number }[],
  spots: number,
  weeksLeft = 0,
): Record<number, 'in' | 'out' | null> => {
  const left: Record<number, number> = {}
  for (const g of schedule) {
    left[g.a] = (left[g.a] ?? 0) + 1
    left[g.b] = (left[g.b] ?? 0) + 1
  }
  const now = (t: number) => (record[t]?.wins ?? 0) + 0.5 * (record[t]?.ties ?? 0)
  const games = (t: number) => Math.max(left[t] ?? 0, weeksLeft)
  const max = (t: number) => now(t) + games(t)
  const out: Record<number, 'in' | 'out' | null> = {}
  if (spots > 0 && spots < teams.length && teams.every((t) => games(t) === 0)) {
    const final = [...teams].sort((x, y) => now(y) - now(x) || (record[y]?.pf ?? 0) - (record[x]?.pf ?? 0))
    final.forEach((t, i) => (out[t] = i < spots ? 'in' : 'out'))
    return out
  }
  for (const t of teams) {
    if (spots <= 0 || spots >= teams.length) {
      out[t] = spots >= teams.length ? 'in' : 'out'
      continue
    }
    const threats = teams.filter((o) => o !== t && max(o) >= now(t)).length
    const ahead = teams.filter((o) => o !== t && now(o) > max(t)).length
    out[t] = threats < spots ? 'in' : ahead >= spots ? 'out' : null
  }
  return out
}

export type SimInput = {
  teams: number[]
  record: Record<number, { wins: number; losses: number; ties: number; pf: number }>
  schedule: { week: number; a: number; b: number }[]
  playoffWeeks: number[]
  playoffTeams: number
  mean: (rosterId: number, week: number) => number
  sigma: number
  /** Season-long uncertainty in a team's level, drawn once per simulated season. */
  tau: number
  /** Regular-season weeks left on the calendar, for settling clinches (see clinchStatus). */
  weeksLeft?: number
  sims: number
  seed?: number
}

/**
 * Season-simulation settings, fitted on how 148 real 2025 Sleeper leagues
 * (1,722 teams) actually finished, simulating from week 4 and from week 6.
 *
 *   tauShare     Spread of each team's season-long level around its rating,
 *                as a share of weekly σ: how wrong a rating can be.
 *   persistence  How much of a team's gap to the league average carries
 *                through the rest of the season. Rosters drift (injuries,
 *                trades, waiver pickups), and that pulls teams toward the middle.
 *
 * The earlier settings (0.3, 1.0) were a little overconfident: teams given
 * 95–99% made it 96.4% of the time against 97.2% predicted. These score
 * best on log loss at both start weeks (0.4544 vs 0.4575 at week 4; 0.3990
 * vs 0.4042 at week 6). Every team either setting put at 99% or higher did
 * make the playoffs (34 of 34 and 92 of 92), so a very high number for a
 * team that is far ahead is earned; what it never is, until the arithmetic
 * says so, is 100%.
 */
export const SIM = { sims: 4000, tauShare: 0.4, persistence: 0.85 }

/** A team's expectation pulled toward the week's league average by SIM.persistence, for simulating weeks ahead. */
export const persistMean = (mean: (t: number, w: number) => number, teams: number[], persistence = SIM.persistence) => {
  const avg = new Map<number, number>()
  return (t: number, w: number) => {
    let a = avg.get(w)
    if (a === undefined) avg.set(w, (a = teams.reduce((s, x) => s + mean(x, w), 0) / (teams.length || 1)))
    return a + persistence * (mean(t, w) - a)
  }
}

export const simulateSeason = (input: SimInput): Record<number, SimTeam> => {
  const { teams, schedule, record, sigma, tau, sims, playoffWeeks } = input
  const nPlayoff = Math.min(input.playoffTeams || 0, teams.length)
  const size = nPlayoff > 1 ? 2 ** Math.ceil(Math.log2(nPlayoff)) : 0
  const order = size ? bracketOrder(size) : []
  const byes = size - nPlayoff
  const out: Record<number, SimTeam> = {}
  const settled = clinchStatus(teams, record, schedule, nPlayoff, input.weeksLeft ?? 0)
  for (const t of teams) out[t] = { rosterId: t, wins: 0, playoffs: 0, bye: 0, final: 0, title: 0, seeds: Array(teams.length + 1).fill(0), clinch: settled[t] }
  const z = normals(rng(input.seed ?? 20240917))
  // Means are fixed per sim input; read them once.
  const meanCache = new Map<string, number>()
  const mean = (t: number, w: number) => {
    const k = `${t}:${w}`
    let m = meanCache.get(k)
    if (m === undefined) meanCache.set(k, (m = input.mean(t, w)))
    return m
  }
  const idx = new Map(teams.map((t, i) => [t, i]))
  const wins = new Float64Array(teams.length)
  const pf = new Float64Array(teams.length)
  const level = new Float64Array(teams.length)

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < teams.length; i++) {
      const r = record[teams[i]] ?? { wins: 0, losses: 0, ties: 0, pf: 0 }
      wins[i] = r.wins + r.ties * 0.5
      pf[i] = r.pf
      level[i] = tau * z()
    }
    for (const g of schedule) {
      const ia = idx.get(g.a)
      const ib = idx.get(g.b)
      if (ia === undefined || ib === undefined) continue
      const sa = mean(g.a, g.week) + level[ia] + sigma * z()
      const sb = mean(g.b, g.week) + level[ib] + sigma * z()
      pf[ia] += sa
      pf[ib] += sb
      if (sa > sb) wins[ia]++
      else wins[ib]++
    }
    const standings = teams.map((_, i) => i).sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x])
    standings.forEach((i, rank) => {
      out[teams[i]].seeds[rank + 1]++
      out[teams[i]].wins += wins[i]
    })
    if (!size) continue
    // Fixed bracket; empty slots are byes.
    let alive: (number | null)[] = order.map((seed) => (seed <= nPlayoff ? standings[seed - 1] : null))
    for (let i = 0; i < nPlayoff; i++) out[teams[standings[i]]].playoffs++
    for (let i = 0; i < byes; i++) out[teams[standings[i]]].bye++
    let round = 0
    while (alive.length > 1) {
      // The last two standing are the finalists, whatever the bracket size.
      if (alive.length === 2) for (const f of alive) if (f !== null) out[teams[f]].final++
      const week = playoffWeeks[Math.min(round, playoffWeeks.length - 1)] ?? 0
      const next: (number | null)[] = []
      for (let m = 0; m < alive.length; m += 2) {
        const x = alive[m]
        const y = alive[m + 1]
        if (x === null || y === null) {
          next.push(x ?? y)
          continue
        }
        const sx = mean(teams[x], week) + level[x] + sigma * z()
        const sy = mean(teams[y], week) + level[y] + sigma * z()
        next.push(sx >= sy ? x : y)
      }
      alive = next
      round++
    }
    if (alive[0] !== null && alive[0] !== undefined) out[teams[alive[0]]].title++
  }
  for (const t of teams) {
    const o = out[t]
    o.wins = round2(o.wins / sims)
    o.playoffs = round3(o.playoffs / sims)
    o.bye = round3(o.bye / sims)
    o.final = round3(o.final / sims)
    o.title = round3(o.title / sims)
    o.seeds = o.seeds.map((c) => round3(c / sims))
  }
  return out
}

/** Probability A outscores B in one week. */
export const winProb = (muA: number, muB: number, sigma: number) => phi((muA - muB) / (Math.SQRT2 * Math.max(1, sigma)))

// ---------- Putting it together ----------

export type Forecast = {
  ratings: TeamRating[]
  byId: Record<number, TeamRating>
  sim: Record<number, SimTeam>
  sigma: number
  /** Team-week residuals the noise was measured on (0 means the fallback was used). */
  noiseN: number
  tau: number
  leagueEff: number
  sims: number
  /** Next week's pairings with win probabilities. */
  nextWeek: { week: number; a: number; b: number; muA: number; muB: number; pA: number }[]
  /** Mean of a team's expectation for a week the horizon does not cover. */
  mean: (rosterId: number, week: number) => number
}

export const buildForecast = (input: ForecastInput, sims = SIM.sims, past = pastByWeek(input)): Forecast => {
  const { ratings, noise, leagueEff } = teamRatings(input, past)
  const byId = Object.fromEntries(ratings.map((r) => [r.rosterId, r])) as Record<number, TeamRating>
  const mean = (t: number, w: number) => byId[t]?.byWeek[w] ?? byId[t]?.rating ?? 0
  const tau = SIM.tauShare * noise.sigma
  const ids = input.teams.map((t) => t.rosterId)
  const sim = simulateSeason({
    teams: ids,
    record: input.record,
    schedule: input.schedule,
    playoffWeeks: input.playoffWeeks,
    playoffTeams: input.playoffTeams,
    mean: persistMean(mean, ids),
    sigma: noise.sigma,
    weeksLeft: input.weeksLeft,
    tau,
    sims,
  })
  // Next week's odds read the rating as is: the per-game backtest grades exactly this, and the
  // persistence pull is about drift over many weeks, which one week ahead has barely begun.
  const firstWeek = input.schedule.length ? Math.min(...input.schedule.map((g) => g.week)) : null
  const nextWeek = input.schedule
    .filter((g) => g.week === firstWeek)
    .map((g) => {
      const muA = mean(g.a, g.week)
      const muB = mean(g.b, g.week)
      return { week: g.week, a: g.a, b: g.b, muA: round2(muA), muB: round2(muB), pA: round3(winProb(muA, muB, noise.sigma)) }
    })
  return { ratings, byId, sim, sigma: round2(noise.sigma), noiseN: noise.n, tau: round2(tau), leagueEff: round3(leagueEff), sims, nextWeek, mean }
}

/**
 * What a trade does to both teams' seasons: the same simulation run twice on
 * the same random draws, before and after, so the difference is the trade and
 * not the dice.
 */
const LEVERAGE_SIMS = 2000
const leverageCache = new WeakMap<Forecast, { evalH: ReturnType<typeof makeHorizonEval>; before: Record<number, SimTeam> }>()

export const tradeLeverage = (input: ForecastInput, base: Forecast, trade: { me: number; partner: number; myRoster: string[]; theirRoster: string[] }) => {
  if (!input.horizon.length) return null
  const sims = LEVERAGE_SIMS
  const after: Record<number, Record<number, number>> = {}
  const afterRating: Record<number, number> = {}
  const common = {
    teams: input.teams.map((t) => t.rosterId),
    record: input.record,
    schedule: input.schedule,
    playoffWeeks: input.playoffWeeks,
    playoffTeams: input.playoffTeams,
    sigma: base.sigma,
    tau: base.tau,
    weeksLeft: input.weeksLeft,
    sims,
    seed: 777,
  }
  // The baseline and the lineup evaluator are the same for every trade; build them once per forecast.
  let cached = leverageCache.get(base)
  if (!cached) {
    cached = { evalH: makeHorizonEval(input.slots, input.players, input.horizon, input.floor), before: simulateSeason({ ...common, mean: persistMean(base.mean, common.teams) }) }
    leverageCache.set(base, cached)
  }
  const { evalH, before } = cached
  for (const [rid, roster] of [
    [trade.me, trade.myRoster],
    [trade.partner, trade.theirRoster],
  ] as [number, string[]][]) {
    const r = base.byId[rid]
    const perWeek = evalH.perWeek(roster)
    after[rid] = {}
    input.horizon.forEach((h, i) => (after[rid][h.week] = perWeek[i] * r.efficiency + FORM_WEIGHT * r.form))
    const xs = Object.values(after[rid])
    afterRating[rid] = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  }
  // Weeks the horizon does not cover (the playoffs, in the shorter modes) use the post-trade rating too.
  const post = simulateSeason({ ...common, mean: persistMean((t, w) => (after[t] ? (after[t][w] ?? afterRating[t]) : base.mean(t, w)), common.teams) })
  const delta = (rid: number) => ({
    playoffs: round3(post[rid].playoffs - before[rid].playoffs),
    title: round3(post[rid].title - before[rid].title),
    wins: round2(post[rid].wins - before[rid].wins),
  })
  return { me: delta(trade.me), partner: delta(trade.partner), after: { me: post[trade.me], partner: post[trade.partner] } }
}

// ---------- Backtest ----------

export type BacktestModel = 'coin' | 'ppg' | 'allplay' | 'elo' | 'power' | 'projection' | 'forecast' | 'form'

export type BacktestScore = {
  model: BacktestModel
  n: number
  brier: number
  logLoss: number
  accuracy: number
  /** 1 − Brier / Brier(coin). Positive beats a coin flip. */
  skill: number
  /** Standard error of the Brier score, for reading small samples honestly. */
  se: number
  /** Reliability: predicted vs observed in five bins. */
  bins: { p: number; observed: number; n: number }[]
}

export type BacktestPrediction = { season: string; week: number; a: number; b: number; actual: number; p: Partial<Record<BacktestModel, number>> }

const score = (model: BacktestModel, preds: BacktestPrediction[]): BacktestScore | null => {
  const rows = preds.filter((r) => r.p[model] !== undefined && r.actual !== 0.5)
  if (!rows.length) return null
  const eps = 1e-6
  const sq = rows.map((r) => (r.p[model]! - r.actual) ** 2)
  const brier = sq.reduce((a, b) => a + b, 0) / rows.length
  const sd = Math.sqrt(sq.reduce((a, x) => a + (x - brier) ** 2, 0) / Math.max(1, rows.length - 1))
  const logLoss = -rows.reduce((a, r) => a + (r.actual ? Math.log(Math.max(eps, r.p[model]!)) : Math.log(Math.max(eps, 1 - r.p[model]!))), 0) / rows.length
  const accuracy = rows.filter((r) => r.p[model] === 0.5 ? false : (r.p[model]! > 0.5) === (r.actual === 1)).length / rows.length
  const bins = [0, 1, 2, 3, 4].map((i) => {
    const inBin = rows.filter((r) => Math.min(4, Math.floor(r.p[model]! * 5)) === i)
    return {
      p: inBin.length ? round3(inBin.reduce((a, r) => a + r.p[model]!, 0) / inBin.length) : (i + 0.5) / 5,
      observed: inBin.length ? round3(inBin.reduce((a, r) => a + r.actual, 0) / inBin.length) : NaN,
      n: inBin.length,
    }
  })
  return { model, n: rows.length, brier: round3(brier), logLoss: round3(logLoss), accuracy: round3(accuracy), skill: round3(1 - brier / 0.25), se: round3(sd / Math.sqrt(rows.length)), bins }
}

export type BacktestSeason = {
  season: string
  teamWeeks: Record<number, TeamWeek[]>
  weeks: number[]
  /** Map roster ids onto the current season's (identity for the current season). */
  map?: Record<number, number>
  pastProjections?: Record<number, Record<string, number>>
  /** Elo going in to the season. */
  eloStart?: Record<number, number>
}

/**
 * Walk each season forward a week at a time. Every prediction for week w uses
 * only weeks before w, so no model sees the game it is graded on.
 *
 * The composite power ranking is graded on its margin (points per week over
 * an average team), turned into a probability with the same weekly σ as the
 * other point-based models.
 */
export const backtest = (
  seasons: BacktestSeason[],
  ctx: { slots: Slot[]; players: PlayerMap; floor: WaiverFloor; sigma: number; powerMargin: (teamWeeks: Record<number, TeamWeek[]>, weeks: number[]) => Record<number, number> },
) => {
  const preds: BacktestPrediction[] = []
  for (const s of seasons) {
    const teamIds = [...new Set(s.weeks.flatMap((w) => (s.teamWeeks[w] ?? []).map((t) => t.rosterId)))]
    const games = gamesFrom(s.teamWeeks, s.weeks)
    const marginSd = ctx.sigma * Math.SQRT2
    const elo = runElo(games, teamIds, s.eloStart ?? {}, marginSd)
    for (let wi = 1; wi < s.weeks.length; wi++) {
      const week = s.weeks[wi]
      const prior = s.weeks.slice(0, wi)
      const pts: Record<number, number[]> = {}
      const ap: Record<number, { w: number; g: number }> = {}
      for (const w of prior) {
        const tws = s.teamWeeks[w] ?? []
        for (const t of tws) {
          ;(pts[t.rosterId] ??= []).push(t.points)
          const a = (ap[t.rosterId] ??= { w: 0, g: 0 })
          for (const o of tws) if (o.rosterId !== t.rosterId) {
            a.w += t.points > o.points ? 1 : t.points === o.points ? 0.5 : 0
            a.g++
          }
        }
      }
      const mean = (xs: number[] | undefined) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
      const power = ctx.powerMargin(s.teamWeeks, prior)
      const proj = s.pastProjections?.[week]
      // Efficiency and form going into the week, both against each roster's own projection in earlier weeks.
      const formSum: Record<number, { sum: number; n: number; actual: number; proj: number }> = {}
      for (const w of prior) {
        const pw = s.pastProjections?.[w]
        if (!pw) continue
        const lineup = makeLineupEval(ctx.slots, ctx.players, pw, ctx.floor)
        for (const t of s.teamWeeks[w] ?? []) {
          const proj = lineup.total(t.players)
          if (!(proj > 0)) continue
          const f = (formSum[t.rosterId] ??= { sum: 0, n: 0, actual: 0, proj: 0 })
          const pts = managedPoints(t, ctx.slots, pw, ctx.floor)
          f.sum += pts - proj
          f.n++
          f.actual += pts
          f.proj += proj
        }
      }
      const formAll = Object.values(formSum)
      const formBias = formAll.reduce((a, f) => a + f.sum, 0) / Math.max(1, formAll.reduce((a, f) => a + f.n, 0))
      const form = (rid: number) => {
        const f = formSum[rid]
        return f ? (f.sum - f.n * formBias) / (f.n + FORM_PRIOR_GAMES) : 0
      }
      const leagueEff = (() => {
        const p = formAll.reduce((a, f) => a + f.proj, 0)
        return p ? formAll.reduce((a, f) => a + f.actual, 0) / p : 1
      })()
      for (const g of games.filter((x) => x.week === week)) {
        const p: Partial<Record<BacktestModel, number>> = { coin: 0.5 }
        const ma = mean(pts[g.a])
        const mb = mean(pts[g.b])
        if (ma != null && mb != null) p.ppg = winProb(ma, mb, ctx.sigma)
        const aa = ap[g.a]
        const ab = ap[g.b]
        if (aa && ab) {
          // log5 on all-play rates shrunk with two virtual .500 games.
          const x = (aa.w + 1) / (aa.g + 2)
          const y = (ab.w + 1) / (ab.g + 2)
          p.allplay = (x * (1 - y)) / (x * (1 - y) + y * (1 - x))
        }
        const ea = elo.before[week]?.[g.a]
        const eb = elo.before[week]?.[g.b]
        if (ea != null && eb != null) p.elo = eloWinProb(ea - eb)
        if (power[g.a] != null && power[g.b] != null) p.power = winProb(power[g.a], power[g.b], ctx.sigma)
        if (proj) {
          const twA = (s.teamWeeks[week] ?? []).find((t) => t.rosterId === g.a)
          const twB = (s.teamWeeks[week] ?? []).find((t) => t.rosterId === g.b)
          if (twA && twB) {
            const lineup = makeLineupEval(ctx.slots, ctx.players, proj, ctx.floor)
            const pa = lineup.total(twA.players)
            const pb = lineup.total(twB.players)
            if (pa > 0 && pb > 0) {
              p.projection = winProb(pa, pb, ctx.sigma)
              const k = EFFICIENCY_PRIOR_GAMES
              const shrink = (rid: number) => {
                const f = formSum[rid]
                const n = f?.n ?? 0
                const own = f && f.proj ? f.actual / f.proj : leagueEff
                return (n * own + k * leagueEff) / (n + k)
              }
              p.forecast = winProb(pa * shrink(g.a), pb * shrink(g.b), ctx.sigma)
              p.form = winProb(pa * shrink(g.a) + form(g.a), pb * shrink(g.b) + form(g.b), ctx.sigma)
            }
          }
        }
        preds.push({ season: s.season, week, a: g.a, b: g.b, actual: g.pa > g.pb ? 1 : g.pa < g.pb ? 0 : 0.5, p })
      }
    }
  }
  const models: BacktestModel[] = ['coin', 'ppg', 'allplay', 'elo', 'power', 'projection', 'forecast', 'form']
  const scores = models.map((m) => score(m, preds)).filter((x): x is BacktestScore => !!x)
  // A fair comparison on the games every model could predict.
  const common = preds.filter((r) => models.every((m) => m === 'coin' || r.p[m] !== undefined || !scores.some((s) => s.model === m)))
  const commonScores = models.map((m) => score(m, common)).filter((x): x is BacktestScore => !!x)
  return { preds, scores, commonScores, commonN: common.filter((r) => r.actual !== 0.5).length }
}
