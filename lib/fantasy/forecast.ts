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
/** A stored pre-game probability is never exactly 0 or 1: rounding must not turn a heavy favourite into a certainty. */
const clampOdds = (p: number) => Math.min(0.999, Math.max(0.001, p))

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
  /**
   * How much of the projected-lineup gap between two teams Elo credits before the game, ELWAY-style. Half: a
   * lineup edge is real, but projections miss, and results still have to move the rating.
   */
  lineupShare: 0.5,
}

/**
 * Elo points per point of weekly scoring edge: the slope where both curves meet at even odds. A margin m wins with
 * Φ(m / (√2·σ)); an Elo gap d with 1 / (1 + 10^(−d/400)). Matching their slopes at zero gives d ≈ 196 · m / σ.
 */
export const eloPerPoint = (sigma: number) => (0.3989 / (Math.SQRT2 * Math.max(1, sigma))) / (Math.LN10 / 1600)

/** The Elo credit a team's projected lineup earns against an opponent's that week. */
export const lineupEdge = (la: number | undefined, lb: number | undefined, sigma: number) =>
  la != null && lb != null && la > 0 && lb > 0 ? ELO.lineupShare * eloPerPoint(sigma) * (la - lb) : 0

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

/**
 * Elo over a run of games. With `lineup` (each team's projected optimal lineup, by week), every game is judged
 * against what the two lineups projected: a loss with your starters hurt costs less, a win with a thin lineup earns
 * more. The rating then measures how a team does against its own lineup, and a team's lineup is added back on top
 * when it is read (see `lineupEdge`).
 */
export const runElo = (games: Game[], teams: number[], start: Record<number, number> = {}, marginSd = 35, lineup?: Record<number, Record<number, number>>): EloRun => {
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
      const edge = lineupEdge(lineup?.[week]?.[g.a], lineup?.[week]?.[g.b], marginSd / Math.SQRT2)
      const exp = eloWinProb(ra - rb + edge)
      const actual = g.pa > g.pb ? 1 : g.pa < g.pb ? 0 : 0.5
      const winnerDiff = actual === 1 ? ra - rb + edge : actual === 0 ? rb - ra - edge : 0
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
  /** The weeks each playoff round is scored over (see playoffRoundWeeks); one week a round when absent. */
  playoffRounds?: number[][]
  playoffTeams: number
  elo: Record<number, number>
  /** Fallback weekly noise when there is nothing to measure it from. */
  sigmaFallback: number
  /** Regular-season weeks left on the calendar (the schedule above can be missing one that failed to load). */
  weeksLeft?: number
  /** Each team's division, when the league has divisions (see seedOrder). */
  divisions?: Record<number, number>
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
  const { teams, teamWeeks } = input
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
 * Playoff order from the standings. With divisions, each division's winner (best record there, points-for breaking
 * ties) takes a top seed, the winners ranked among themselves by record, and everyone else follows by record; this is
 * how Sleeper and ESPN seed a league with divisions. Without them it is the standings.
 */
export const seedOrder = <T>(rows: T[], winsOf: (r: T) => number, pfOf: (r: T) => number, divisionOf?: (r: T) => number | null | undefined): T[] => {
  const byRecord = [...rows].sort((x, y) => winsOf(y) - winsOf(x) || pfOf(y) - pfOf(x))
  if (!divisionOf) return byRecord
  const winners: T[] = []
  const seen = new Set<number>()
  for (const r of byRecord) {
    const d = divisionOf(r)
    if (d == null || seen.has(d)) continue
    seen.add(d)
    winners.push(r)
  }
  if (seen.size < 2) return byRecord
  const won = new Set(winners)
  return [...winners, ...byRecord.filter((r) => !won.has(r))]
}

/**
 * Each team's division, when the league has two or more; otherwise nothing, and seeding is by record alone. `count` is
 * the league's setting where it has one (Sleeper); without it (ESPN) the rosters' own divisions decide.
 */
export const divisionsOf = (rows: { roster_id: number; settings?: { division?: number } | null }[], count?: number | null) => {
  if (count != null && count < 2) return undefined
  const out: Record<number, number> = {}
  for (const r of rows) if (r.settings?.division != null) out[r.roster_id] = r.settings.division
  return new Set(Object.values(out)).size >= 2 ? out : undefined
}

/**
 * Playoff spots settled by wins alone. A team is in when, even losing out,
 * fewer than `spots` other teams could still reach its win total; out when at
 * least `spots` teams already have more wins than it could reach. Ties count
 * against the team (points-for is unknown in advance, and platforms break ties
 * differently), and head-to-head games are not netted out, so this only ever
 * errs toward "still open".
 *
 * `weeksLeft` is how many regular-season weeks remain on the calendar. Each
 * team is assumed to play at least that many games, so a week whose matchups
 * failed to load never makes a race look decided. With nothing left to play,
 * the standings are final, and a spot that hangs on a tie in wins stays open
 * rather than being handed out by a tiebreak.
 */
export const clinchStatus = (
  teams: number[],
  record: Record<number, { wins: number; ties: number; pf?: number }>,
  schedule: { a: number; b: number }[],
  spots: number,
  weeksLeft = 0,
  divisions?: Record<number, number>,
  /** Games of those weeks already decided for each team (locked results, counted in `record`). */
  decided?: Record<number, number>,
): Record<number, 'in' | 'out' | null> => {
  const left: Record<number, number> = {}
  for (const g of schedule) {
    left[g.a] = (left[g.a] ?? 0) + 1
    left[g.b] = (left[g.b] ?? 0) + 1
  }
  const now = (t: number) => (record[t]?.wins ?? 0) + 0.5 * (record[t]?.ties ?? 0)
  const games = (t: number) => Math.max(left[t] ?? 0, weeksLeft - (decided?.[t] ?? 0))
  const max = (t: number) => now(t) + games(t)
  const out: Record<number, 'in' | 'out' | null> = {}
  const div = (t: number) => divisions?.[t]
  const divs = new Set(teams.map(div).filter((d): d is number => d != null))
  const split = divs.size >= 2
  if (spots > 0 && spots < teams.length && teams.every((t) => games(t) === 0)) {
    // Final standings. Only a result no tiebreak can change is called: the team is put last, then first, among
    // everyone level with it on wins (platforms break those ties differently, so none is assumed), and it is in or
    // out only if both seatings agree. Without ties that is the plain final order.
    const BIG = 1e12
    const seat = (t: number, pf: number) => seedOrder(teams, now, (o) => (o === t ? pf : 0), split ? div : undefined).indexOf(t)
    for (const t of teams) {
      if (seat(t, -BIG) < spots) out[t] = 'in'
      else if (seat(t, BIG) >= spots) out[t] = 'out'
      else out[t] = null
    }
    return out
  }
  for (const t of teams) {
    if (spots <= 0 || spots >= teams.length) {
      out[t] = spots >= teams.length ? 'in' : 'out'
      continue
    }
    const threats = teams.filter((o) => o !== t && max(o) >= now(t)).length
    const ahead = teams.filter((o) => o !== t && now(o) > max(t)).length
    if (!split) {
      out[t] = threats < spots ? 'in' : ahead >= spots ? 'out' : null
      continue
    }
    // With divisions, a division winner takes a spot whatever its record. Winning its own division puts a team in
    // only when every division's winner makes it (no more divisions than spots; otherwise the winners are ranked
    // among themselves); a team in no division cannot win one. Otherwise every other division's winner may be someone
    // who cannot reach its wins, so each one costs a spot. And a team that can still win its division is never out.
    const rivals = div(t) == null ? null : teams.filter((o) => o !== t && div(o) === div(t))
    const winsDivision = rivals != null && divs.size <= spots && rivals.every((o) => max(o) < now(t))
    const canWinDivision = rivals != null && rivals.every((o) => now(o) <= max(t))
    const otherDivisions = [...divs].filter((d) => d !== div(t)).length
    out[t] = winsDivision || threats + otherDivisions < spots ? 'in' : ahead >= spots && !canWinDivision ? 'out' : null
  }
  return out
}

export type SimInput = {
  teams: number[]
  record: Record<number, { wins: number; losses: number; ties: number; pf: number }>
  schedule: { week: number; a: number; b: number }[]
  playoffWeeks: number[]
  /** The weeks each playoff round is scored over, in order (see playoffRoundWeeks); one week a round when absent. */
  playoffRounds?: number[][]
  playoffTeams: number
  mean: (rosterId: number, week: number) => number
  sigma: number
  /** Season-long uncertainty in a team's level, drawn once per simulated season. */
  tau: number
  /** Regular-season weeks left on the calendar, for settling clinches (see clinchStatus). */
  weeksLeft?: number
  sims: number
  /** The random stream (see simNormal). Runs that share it share their draws, season by season. */
  seed?: number
  /** The first season to play: a run of `sims` plays seasons from..from+sims−1 of the stream, so slices add up. */
  from?: number
  /** Results fixed in advance, by lockKey: the winner's roster id. Their scores are drawn given that result. */
  locks?: Record<string, number>
  /** Each team's division, when the league has divisions: their winners take the top seeds (see seedOrder). */
  divisions?: Record<number, number>
}

/** A regular-season game's key for `locks`, the same whichever side is listed first. */
export const lockKey = (g: { week: number; a: number; b: number }) => `${g.week}:${Math.min(g.a, g.b)}:${Math.max(g.a, g.b)}`

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
 *
 *   sims, seed   Every playoff number in the app is read off the same 4,000
 *                seasons of the same stream: the forecast itself, and every
 *                scenario run from it (a result locked, a trade made, a week
 *                taken back), so a scenario differs from the forecast only where
 *                its inputs do. 4,000 puts the standard error of a 50% chance at
 *                0.8 points.
 */
export const SIM = { sims: 4000, seed: 20240917, tauShare: 0.4, persistence: 0.85 }

/** A team's expectation pulled toward the week's league average by SIM.persistence, for simulating weeks ahead. */
export const persistMean = (mean: (t: number, w: number) => number, teams: number[], persistence = SIM.persistence) => {
  const avg = new Map<number, number>()
  return (t: number, w: number) => {
    let a = avg.get(w)
    if (a === undefined) avg.set(w, (a = teams.reduce((s, x) => s + mean(x, w), 0) / (teams.length || 1)))
    return a + persistence * (mean(t, w) - a)
  }
}

/**
 * The weeks each playoff round is played over, from the league's settings: one week a round unless the league plays a
 * two-week final (round type 1) or two weeks every round (type 2); a two-week round is decided on the two weeks'
 * total. Weeks past `lastWeek` (the NFL's last) are dropped, so a round can come back empty. The one rule: the league
 * loader (lib/fantasy/useLeagueData fantasyPlayoffRounds) builds the rounds with it and the weeks from the rounds.
 */
export const playoffRoundWeeks = (start: number, playoffTeams: number, roundType = 0, lastWeek = Infinity): number[][] => {
  const n = playoffTeams > 1 ? Math.ceil(Math.log2(playoffTeams)) : 0
  const out: number[][] = []
  let w = start
  for (let r = 0; r < n; r++) {
    const len = roundType === 2 || (roundType === 1 && r === n - 1) ? 2 : 1
    out.push(Array.from({ length: len }, (_, k) => w + k).filter((x) => x <= lastWeek))
    w += len
  }
  return out
}

/**
 * A round the calendar has no week for (past the NFL's last, or no playoff weeks known) is still played in the
 * simulation, as a week of its own at the team's rating, numbered from here. Never a week to show anyone.
 */
export const PLACEHOLDER_WEEK = 100
export const isPlaceholderWeek = (w: number) => w >= PLACEHOLDER_WEEK

/** 32-bit integer hash (murmur3's finalizer). */
const mix32 = (h: number) => {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}
/** The draw slot of a team's season level; weeks use their own number. */
const LEVEL_SLOT = 4095

/**
 * The simulation's random numbers: a standard normal for season `sim` of stream `seed`, team `team`, in week `slot`.
 * Keyed by what each draw is for rather than drawn in sequence, so a team's luck in a week of a given season is the
 * same in every run on the stream, whatever else that run fixes or leaves out (common random numbers). The odds with a
 * result locked then match the odds without it in every season where the game went that way anyway, a reveal's
 * "after" plays exactly the forecast's seasons, and a trade's effect is the trade and not the dice.
 */
export const simNormal = (seed: number, sim: number, slot: number, team: number) => {
  let h = mix32((seed ^ Math.imul(sim + 1, 0x9e3779b1)) >>> 0)
  h = mix32((h ^ Math.imul(slot + 1, 0x85ebca6b)) >>> 0)
  h = mix32((h ^ Math.imul(team + 1, 0xc2b2ae35)) >>> 0)
  // By inversion: one hash a draw, and no logarithm outside the 5% tails.
  return phiInv((h + 0.5) / 4294967296)
}

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export const phiInv = (p: number) => {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const tail = (q: number) => {
    const r = Math.sqrt(-2 * Math.log(q))
    return (((((-7.784894002430293e-3 * r - 3.223964580411365e-1) * r - 2.400758277161838) * r - 2.549732539343734) * r + 4.374664141464968) * r + 2.938163982698783) /
      ((((7.784695709041462e-3 * r + 3.224671290700398e-1) * r + 2.445134137142996) * r + 3.754408661907416) * r + 1)
  }
  if (p < 0.02425) return tail(p)
  if (p > 1 - 0.02425) return -tail(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((-3.969683028665376e1 * r + 2.209460984245205e2) * r - 2.759285104469687e2) * r + 1.38357751867269e2) * r - 3.066479806614716e1) * r + 2.506628277459239) * q) /
    (((((-5.447609879822406e1 * r + 1.615858368580409e2) * r - 1.556989798598866e2) * r + 6.680131188771972e1) * r - 1.328068155288572e1) * r + 1)
}

/**
 * Scores for a game whose winner is fixed, from the scores drawn for it. A draw that already went that way is kept.
 * One that did not keeps the two scores' sum and moves the margin by its quantile into the winning side's range, so
 * across seasons the margin has exactly its distribution given that result, and in every season the locked winner
 * scores more than it was drawn to and the loser less. That is what makes a locked win never hurt the team that wins
 * it: the odds with a win, the odds as they are and the odds with a loss come in that order, season by season.
 * `mu` is the expected margin (a − b) and `sd` its spread.
 */
export const lockedScores = (aWins: boolean, sa: number, sb: number, mu: number, sd: number): [number, number] => {
  const d = sa - sb
  if (d > 0 === aWins && d !== 0) return [sa, sb]
  const sum = sa + sb
  const p0 = phi(-mu / sd) // P(b wins)
  const u = phi((d - mu) / sd)
  const level = aWins ? p0 + (p0 > 0 ? Math.min(1, u / p0) : 0.5) * (1 - p0) : (p0 < 1 ? Math.max(0, (u - p0) / (1 - p0)) : 0.5) * p0
  let m = mu + sd * phiInv(Math.min(1 - 1e-12, Math.max(1e-12, level)))
  // The quantile maps into the winner's range; a hair of rounding at the edge must still leave the right winner.
  if (aWins ? !(m > 0) : !(m < 0)) m = aWins ? 1e-6 : -1e-6
  return [(sum + m) / 2, (sum - m) / 2]
}

/** Raw tallies from a run of simulated seasons: sums, so slices of one stream add up to the whole run exactly. */
export type SimCounts = {
  sims: number
  clinch: Record<number, SimTeam['clinch']>
  teams: Record<number, { wins: number; playoffs: number; bye: number; final: number; title: number; seeds: number[] }>
}

type SimGame = { week: number; a: number; b: number; ia: number; ib: number; ma: number; mb: number; lock: number | undefined }

/** One run's fixed parts, worked out once: indices, each game's expectation, each round's, the clinches. */
const compile = (input: SimInput) => {
  const { teams, record } = input
  const n = teams.length
  const idx = new Map(teams.map((t, i) => [t, i]))
  const nPlayoff = Math.min(input.playoffTeams || 0, n)
  const size = nPlayoff > 1 ? 2 ** Math.ceil(Math.log2(nPlayoff)) : 0
  // Each round's weeks: the league's, else one playoff week a round; a round with none plays a placeholder week.
  const given = input.playoffRounds ?? input.playoffWeeks.map((w) => [w])
  const rounds: number[][] = []
  for (let r = 0; size && 2 ** r < size; r++) rounds.push(given[r]?.length ? given[r] : [PLACEHOLDER_WEEK + r])
  const games: SimGame[] = []
  // Locked results count as played for the clinch arithmetic: a spot they settle reads as settled.
  const decidedRecord: SimInput['record'] = {}
  const decided: Record<number, number> = {}
  for (const t of teams) decidedRecord[t] = { ...(record[t] ?? { wins: 0, losses: 0, ties: 0, pf: 0 }) }
  const open: { week: number; a: number; b: number }[] = []
  for (const g of [...input.schedule].sort((x, y) => x.week - y.week)) {
    const ia = idx.get(g.a)
    const ib = idx.get(g.b)
    if (ia === undefined || ib === undefined) continue
    const lock = input.locks?.[lockKey(g)]
    games.push({ week: g.week, a: g.a, b: g.b, ia, ib, ma: input.mean(g.a, g.week), mb: input.mean(g.b, g.week), lock: lock === g.a || lock === g.b ? lock : undefined })
    if (lock === g.a || lock === g.b) {
      const loser = lock === g.a ? g.b : g.a
      decidedRecord[lock].wins++
      decidedRecord[loser].losses++
      decided[g.a] = (decided[g.a] ?? 0) + 1
      decided[g.b] = (decided[g.b] ?? 0) + 1
    } else open.push(g)
  }
  const clinch = clinchStatus(teams, decidedRecord, open, nPlayoff, input.weeksLeft ?? 0, input.divisions, decided)
  // Each round's expectation per team: the sum over its weeks.
  const roundMean = rounds.map((ws) => Float64Array.from(teams, (t) => ws.reduce((a, w) => a + input.mean(t, w), 0)))
  return { n, nPlayoff, size, order: size ? bracketOrder(size) : [], byes: size - nPlayoff, rounds, roundMean, games, clinch }
}

type Compiled = ReturnType<typeof compile>

/** What one season's playoffs did, by team index. */
type Played = { standings: number[]; finalists: number[]; champion: number | null }

/**
 * Season `s` of the stream, played into the arrays given (wins, points for, each game's scores and each playoff game,
 * when asked for): the one place a season is simulated, for the odds and for the single season the simulator shows.
 */
const playSeason = (
  input: SimInput,
  c: Compiled,
  s: number,
  wins: Float64Array,
  pf: Float64Array,
  level: Float64Array,
  trace?: { regular: { sa: number; sb: number }[]; playoff: { round: number; x: number; y: number; sx: number; sy: number }[] },
): Played => {
  const { teams, record, sigma, tau } = input
  const seed = input.seed ?? SIM.seed
  const sd = Math.SQRT2 * sigma
  for (let i = 0; i < c.n; i++) {
    const r = record[teams[i]] ?? { wins: 0, losses: 0, ties: 0, pf: 0 }
    wins[i] = r.wins + r.ties * 0.5
    pf[i] = r.pf
    level[i] = tau * simNormal(seed, s, LEVEL_SLOT, teams[i])
  }
  for (const g of c.games) {
    let sa = g.ma + level[g.ia] + sigma * simNormal(seed, s, g.week, g.a)
    let sb = g.mb + level[g.ib] + sigma * simNormal(seed, s, g.week, g.b)
    if (g.lock !== undefined) [sa, sb] = lockedScores(g.lock === g.a, sa, sb, g.ma + level[g.ia] - g.mb - level[g.ib], sd)
    pf[g.ia] += sa
    pf[g.ib] += sb
    if (sa > sb) wins[g.ia]++
    else wins[g.ib]++
    trace?.regular.push({ sa, sb })
  }
  const standings = seedOrder(
    teams.map((_, i) => i),
    (i) => wins[i],
    (i) => pf[i],
    input.divisions ? (i) => input.divisions![teams[i]] : undefined,
  )
  if (!c.size) return { standings, finalists: [], champion: null }
  // Fixed bracket; empty slots are byes.
  let alive: (number | null)[] = c.order.map((seedNo) => (seedNo <= c.nPlayoff ? standings[seedNo - 1] : null))
  let finalists: number[] = []
  let round = 0
  while (alive.length > 1) {
    // The last two standing are the finalists, whatever the bracket size.
    if (alive.length === 2) finalists = alive.filter((x): x is number => x !== null)
    const ws = c.rounds[round]
    const score = (i: number) => {
      let x = c.roundMean[round][i]
      for (const w of ws) x += level[i] + sigma * simNormal(seed, s, w, teams[i])
      return x
    }
    const next: (number | null)[] = []
    for (let m = 0; m < alive.length; m += 2) {
      const x = alive[m]
      const y = alive[m + 1]
      if (x === null || y === null) {
        next.push(x ?? y)
        continue
      }
      const sx = score(x)
      const sy = score(y)
      next.push(sx >= sy ? x : y)
      trace?.playoff.push({ round, x, y, sx, sy })
    }
    alive = next
    round++
  }
  return { standings, finalists, champion: alive[0] ?? null }
}

/** Tally seasons from..from+sims−1 of the stream. */
export const simulateCounts = (input: SimInput): SimCounts => {
  const { teams } = input
  const c = compile(input)
  const tally: SimCounts['teams'] = {}
  for (const t of teams) tally[t] = { wins: 0, playoffs: 0, bye: 0, final: 0, title: 0, seeds: Array(teams.length + 1).fill(0) }
  const wins = new Float64Array(c.n)
  const pf = new Float64Array(c.n)
  const level = new Float64Array(c.n)
  const from = input.from ?? 0
  for (let s = from; s < from + input.sims; s++) {
    const { standings, finalists, champion } = playSeason(input, c, s, wins, pf, level)
    standings.forEach((i, rank) => {
      const o = tally[teams[i]]
      o.seeds[rank + 1]++
      o.wins += wins[i]
      if (rank < c.nPlayoff && c.size) o.playoffs++
      if (rank < c.byes) o.bye++
    })
    for (const f of finalists) tally[teams[f]].final++
    if (champion !== null) tally[teams[champion]].title++
  }
  return { sims: input.sims, clinch: c.clinch, teams: tally }
}

/** Slices of one stream added into one run. */
export const addCounts = (parts: SimCounts[]): SimCounts => {
  const out: SimCounts = { sims: 0, clinch: parts[0]?.clinch ?? {}, teams: {} }
  for (const p of parts) {
    out.sims += p.sims
    for (const [id, t] of Object.entries(p.teams)) {
      const o = (out.teams[Number(id)] ??= { wins: 0, playoffs: 0, bye: 0, final: 0, title: 0, seeds: t.seeds.map(() => 0) })
      o.wins += t.wins
      o.playoffs += t.playoffs
      o.bye += t.bye
      o.final += t.final
      o.title += t.title
      t.seeds.forEach((x, i) => (o.seeds[i] += x))
    }
  }
  return out
}

/** Tallies as probabilities. */
export const finishSim = (c: SimCounts): Record<number, SimTeam> => {
  const out: Record<number, SimTeam> = {}
  const n = Math.max(1, c.sims)
  for (const [id, t] of Object.entries(c.teams)) {
    const rid = Number(id)
    out[rid] = {
      rosterId: rid,
      wins: round2(t.wins / n),
      playoffs: round3(t.playoffs / n),
      bye: round3(t.bye / n),
      final: round3(t.final / n),
      title: round3(t.title / n),
      seeds: t.seeds.map((x) => round3(x / n)),
      clinch: c.clinch[rid] ?? null,
    }
  }
  return out
}

export const simulateSeason = (input: SimInput): Record<number, SimTeam> => finishSim(simulateCounts(input))

/** One season of a run kept whole, by index in its stream: what the playoff simulator shows. */
export const playOne = (input: SimInput, s: number) => {
  const c = compile(input)
  const wins = new Float64Array(c.n)
  const pf = new Float64Array(c.n)
  const level = new Float64Array(c.n)
  const trace = { regular: [] as { sa: number; sb: number }[], playoff: [] as { round: number; x: number; y: number; sx: number; sy: number }[] }
  const played = playSeason(input, c, s, wins, pf, level, trace)
  return { c, played, trace, rounds: c.rounds }
}

/** Probability A outscores B in one week. */
export const winProb = (muA: number, muB: number, sigma: number) => phi((muA - muB) / (Math.SQRT2 * Math.max(1, sigma)))

// ---------- Putting it together ----------

export type Forecast = {
  ratings: TeamRating[]
  byId: Record<number, TeamRating>
  sim: Record<number, SimTeam>
  /**
   * Exactly what `sim` was simulated from. Every scenario on top of the current odds (a result locked, a trade, the
   * simulator's what-ifs) runs from this, so with nothing changed it reproduces `sim` number for number.
   */
  simInput: SimInput
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
  const simInput: SimInput = {
    teams: ids,
    record: input.record,
    schedule: input.schedule,
    playoffWeeks: input.playoffWeeks,
    playoffRounds: input.playoffRounds,
    playoffTeams: input.playoffTeams,
    mean: persistMean(mean, ids),
    sigma: noise.sigma,
    weeksLeft: input.weeksLeft,
    divisions: input.divisions,
    tau,
    sims,
    seed: SIM.seed,
  }
  const sim = simulateSeason(simInput)
  // Next week's odds read the rating as is: the per-game backtest grades exactly this, and the
  // persistence pull is about drift over many weeks, which one week ahead has barely begun.
  const firstWeek = input.schedule.length ? Math.min(...input.schedule.map((g) => g.week)) : null
  const nextWeek = input.schedule
    .filter((g) => g.week === firstWeek)
    .map((g) => {
      const muA = mean(g.a, g.week)
      const muB = mean(g.b, g.week)
      return { week: g.week, a: g.a, b: g.b, muA: round2(muA), muB: round2(muB), pA: clampOdds(round3(winProb(muA, muB, noise.sigma))) }
    })
  return { ratings, byId, sim, simInput, sigma: round2(noise.sigma), noiseN: noise.n, tau: round2(tau), leagueEff: round3(leagueEff), sims, nextWeek, mean }
}

/** What a team's odds are in one outcome of its game; `clinch` is that outcome's settled status, if any. */
export type Stake = { playoffs: number; bye?: number; title: number; clinch?: SimTeam['clinch'] }
export type Stakes = { win: Stake; loss: Stake }

/**
 * What this week's result is worth: each team's odds if it wins this week's game and if it loses. Both are the
 * forecast's own seasons with that one result locked (same model, inputs, seasons and draws), so they differ from the
 * forecast only in the seasons where the game went the other way, and in every one of those a win can only help: the
 * playoff and bye odds with a loss, as they are, and with a win always come in that order. The week's other games
 * stay simulated. A week in play counts no result until it is settled, so the stakes are the week's from kickoff.
 */
export const weekStakes = (_input: ForecastInput, base: Forecast): Record<number, Stakes> => {
  const out: Record<number, Stakes> = {}
  for (const r of stakesRuns(base)) Object.assign(out, stakesOf(r.game, simulateSeason(r.aWins), simulateSeason(r.bWins)))
  return out
}

/** The two runs behind each of this week's games' stakes, for a caller that runs them itself (lib/fantasy/simRunner). */
export const stakesRuns = (base: Forecast) =>
  base.nextWeek.map((game) => {
    const k = lockKey(game)
    return { game, aWins: { ...base.simInput, locks: { [k]: game.a } } as SimInput, bWins: { ...base.simInput, locks: { [k]: game.b } } as SimInput }
  })

/** A game's stakes from its two runs. */
export const stakesOf = (g: { a: number; b: number }, aWon: Record<number, SimTeam>, bWon: Record<number, SimTeam>): Record<number, Stakes> => {
  const pick = (t: SimTeam | undefined): Stake => ({ playoffs: t?.playoffs ?? 0, bye: t?.bye ?? 0, title: t?.title ?? 0, clinch: t?.clinch ?? null })
  return { [g.a]: { win: pick(aWon[g.a]), loss: pick(bWon[g.a]) }, [g.b]: { win: pick(bWon[g.b]), loss: pick(aWon[g.b]) } }
}

/**
 * What a trade does to both teams' seasons: the forecast's own seasons played again with the two rosters swapped,
 * on the same draws, so the difference from the current odds is the trade and not the dice.
 */
const evalCache = new WeakMap<Forecast, ReturnType<typeof makeHorizonEval>>()

export type TradeSides = { me: number; partner: number; myRoster: string[]; theirRoster: string[] }
export type Leverage = { me: { playoffs: number; title: number; wins: number }; partner: { playoffs: number; title: number; wins: number }; after: { me: SimTeam; partner: SimTeam } }

/** The run behind tradeLeverage: the forecast's simulation with both teams rated on their rosters after the trade. */
export const leverageRun = (input: ForecastInput, base: Forecast, trade: TradeSides): SimInput | null => {
  if (!input.horizon.length) return null
  const after: Record<number, Record<number, number>> = {}
  const afterRating: Record<number, number> = {}
  // The lineup evaluator is the same for every trade; build it once per forecast.
  let evalH = evalCache.get(base)
  if (!evalH) evalCache.set(base, (evalH = makeHorizonEval(input.slots, input.players, input.horizon, input.floor)))
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
  return { ...base.simInput, mean: persistMean((t, w) => (after[t] ? (after[t][w] ?? afterRating[t]) : base.mean(t, w)), base.simInput.teams) }
}

/** A trade's effect from its run, against the current odds. */
export const leverageOf = (base: Forecast, trade: TradeSides, post: Record<number, SimTeam>): Leverage => {
  const before = base.sim
  const delta = (rid: number) => ({
    playoffs: round3(post[rid].playoffs - before[rid].playoffs),
    title: round3(post[rid].title - before[rid].title),
    wins: round2(post[rid].wins - before[rid].wins),
  })
  return { me: delta(trade.me), partner: delta(trade.partner), after: { me: post[trade.me], partner: post[trade.partner] } }
}

export const tradeLeverage = (input: ForecastInput, base: Forecast, trade: TradeSides): Leverage | null => {
  const run = leverageRun(input, base, trade)
  return run ? leverageOf(base, trade, simulateSeason(run)) : null
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
    // Each team's projected lineup in every week with projections, for the lineup-aware Elo.
    const lineupByWeek: Record<number, Record<number, number>> = {}
    for (const w of s.weeks) {
      const pw = s.pastProjections?.[w]
      if (!pw) continue
      const ev = makeLineupEval(ctx.slots, ctx.players, pw, ctx.floor)
      lineupByWeek[w] = Object.fromEntries((s.teamWeeks[w] ?? []).map((t) => [t.rosterId, ev.total(t.players)]))
    }
    const elo = runElo(games, teamIds, s.eloStart ?? {}, marginSd, lineupByWeek)
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
        if (ea != null && eb != null) p.elo = eloWinProb(ea - eb + lineupEdge(lineupByWeek[week]?.[g.a], lineupByWeek[week]?.[g.b], ctx.sigma))
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
