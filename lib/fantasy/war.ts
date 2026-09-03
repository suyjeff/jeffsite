// A wins-above-replacement model for a fantasy league.
//
//   1. Replacement level per position per week = the points scored by the player
//      ranked just past "everyone a team would start" plus a bench buffer. With
//      benchFactor=0 that is the worst weekly starter (classic VBD); ~0.6 puts it
//      at "best player sitting on waivers".
//   2. Points above replacement (PAR) per week = player points minus that level.
//   3. Wins: a team facing a random opponent wins with probability
//      Phi(margin / sigma_margin). Adding PAR to an average team moves it from 0.5
//      to Phi(PAR / sigma_margin). The difference is wins added that week.
//      WAR = sum over played weeks. Big weeks are capped naturally: 60 points
//      does not win you more than one game.

import { optimalLineup, startingSlots, starterDemand, type LineupPlayer, type Slot } from './lineup'
import type { PlayerMap } from './types'

export type WeekPoints = Record<number, Record<string, number>>

export type ModelConfig = {
  /** Bench buffer on top of starter demand when locating replacement level. */
  benchFactor: number
  /** Half-life in weeks for recency weighting. 0 disables it. */
  halfLife: number
  /** Penalty per point of weekly standard deviation for the risk-adjusted view. */
  riskAversion: number
}

export const DEFAULT_MODEL: ModelConfig = { benchFactor: 0.6, halfLife: 4, riskAversion: 0.25 }

export type ReplacementLevels = Record<number, Record<string, number>> // week -> pos -> pts

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const stddev = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7). */
export const normalCdf = (x: number) => {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z)
  return 0.5 * (1 + sign * y)
}

export const replacementLevels = (
  weekPoints: WeekPoints,
  weeks: number[],
  players: PlayerMap,
  rosterPositions: string[],
  numTeams: number,
  benchFactor: number,
): ReplacementLevels => {
  const demand = starterDemand(rosterPositions, numTeams)
  const out: ReplacementLevels = {}
  for (const week of weeks) {
    const byPos: Record<string, number[]> = {}
    const pts = weekPoints[week] ?? {}
    for (const id of Object.keys(pts)) {
      const pos = players[id]?.pos
      if (!pos || demand[pos] === undefined) continue
      ;(byPos[pos] ??= []).push(pts[id])
    }
    out[week] = {}
    for (const pos of Object.keys(demand)) {
      const sorted = (byPos[pos] ?? []).sort((a, b) => b - a)
      if (!sorted.length) {
        out[week][pos] = 0
        continue
      }
      const rank = Math.max(1, Math.round(demand[pos] * (1 + benchFactor)))
      // Average a 3-player band around the rank so one odd score does not move the baseline.
      const idx = Math.min(rank - 1, sorted.length - 1)
      const band = sorted.slice(Math.max(0, idx - 1), Math.min(sorted.length, idx + 2))
      out[week][pos] = Math.round(mean(band) * 100) / 100
    }
  }
  return out
}

/**
 * Standard deviation of a single team's weekly score. Prefer the league's real
 * team scores; fall back to summing positional variance over the starting slots.
 */
export const teamScoreSigma = (
  teamScores: number[],
  weekPoints: WeekPoints,
  weeks: number[],
  players: PlayerMap,
  rosterPositions: string[],
  numTeams: number,
): number => {
  if (teamScores.length >= 8) return stddev(teamScores)
  const demand = starterDemand(rosterPositions, numTeams)
  const slots = startingSlots(rosterPositions)
  const perPosVar: Record<string, number> = {}
  for (const pos of Object.keys(demand)) {
    // Variance of a typical starter: average within-player variance among the top N at the position.
    const seasonPts: Record<string, number[]> = {}
    for (const week of weeks) {
      const pts = weekPoints[week] ?? {}
      for (const id of Object.keys(pts)) {
        if (players[id]?.pos !== pos) continue
        ;(seasonPts[id] ??= []).push(pts[id])
      }
    }
    const ranked = Object.values(seasonPts)
      .filter((xs) => xs.length >= 3)
      .sort((a, b) => mean(b) - mean(a))
      .slice(0, Math.max(1, Math.round(demand[pos])))
    perPosVar[pos] = mean(ranked.map((xs) => stddev(xs) ** 2))
  }
  const total = slots.reduce((acc, slot) => {
    const vars = slot.eligible.map((p) => perPosVar[p] ?? 0)
    return acc + mean(vars)
  }, 0)
  return Math.sqrt(total) || 20
}

export type PlayerValue = {
  id: string
  games: number
  ppg: number
  sd: number
  floor: number
  ceiling: number
  riskAdjPpg: number
  par: number
  parPerGame: number
  war: number
  warPerGame: number
  /** Recency-weighted WAR per game: what the player is worth right now. */
  recentWarPerGame: number
  weekly: { week: number; pts: number; par: number; war: number }[]
}

export const playerValues = (
  weekPoints: WeekPoints,
  weeks: number[],
  players: PlayerMap,
  levels: ReplacementLevels,
  teamSigma: number,
  config: ModelConfig,
): Record<string, PlayerValue> => {
  const sigmaMargin = Math.max(1, teamSigma * Math.SQRT2)
  const lastWeek = weeks.length ? Math.max(...weeks) : 0
  const perPlayer: Record<string, PlayerValue['weekly']> = {}
  for (const week of weeks) {
    const pts = weekPoints[week] ?? {}
    for (const id of Object.keys(pts)) {
      const pos = players[id]?.pos
      if (!pos) continue
      const repl = levels[week]?.[pos]
      if (repl === undefined) continue
      const par = pts[id] - repl
      const war = normalCdf(par / sigmaMargin) - 0.5
      ;(perPlayer[id] ??= []).push({ week, pts: pts[id], par, war })
    }
  }
  const out: Record<string, PlayerValue> = {}
  for (const id of Object.keys(perPlayer)) {
    const weekly = perPlayer[id].sort((a, b) => a.week - b.week)
    const scores = weekly.map((w) => w.pts)
    const sorted = [...scores].sort((a, b) => a - b)
    const ppg = mean(scores)
    const sd = stddev(scores)
    const par = weekly.reduce((a, w) => a + w.par, 0)
    const war = weekly.reduce((a, w) => a + w.war, 0)
    let wSum = 0
    let wWar = 0
    for (const w of weekly) {
      const weight = config.halfLife > 0 ? Math.pow(0.5, (lastWeek - w.week) / config.halfLife) : 1
      wSum += weight
      wWar += weight * w.war
    }
    out[id] = {
      id,
      games: weekly.length,
      ppg,
      sd,
      floor: quantile(sorted, 0.25),
      ceiling: quantile(sorted, 0.75),
      riskAdjPpg: ppg - config.riskAversion * sd,
      par,
      parPerGame: par / weekly.length,
      war,
      warPerGame: war / weekly.length,
      recentWarPerGame: wSum ? wWar / wSum : 0,
      weekly,
    }
  }
  return out
}

/** Sort key helper: rank within position by a metric. */
export const positionRanks = (
  values: Record<string, PlayerValue>,
  players: PlayerMap,
  metric: (v: PlayerValue) => number,
): Record<string, number> => {
  const byPos: Record<string, PlayerValue[]> = {}
  for (const v of Object.values(values)) {
    const pos = players[v.id]?.pos
    if (!pos) continue
    ;(byPos[pos] ??= []).push(v)
  }
  const ranks: Record<string, number> = {}
  for (const pos of Object.keys(byPos)) {
    byPos[pos]
      .sort((a, b) => metric(b) - metric(a))
      .forEach((v, i) => {
        ranks[v.id] = i + 1
      })
  }
  return ranks
}

const toLineupPlayers = (ids: string[], players: PlayerMap, pts: Record<string, number>) =>
  ids
    .filter((id) => players[id])
    .map<LineupPlayer>((id) => ({ id, fpos: players[id].fpos, pts: pts[id] ?? 0 }))

export type LineupDelta = { perWeek: { week: number; before: number; after: number }[]; avg: number; total: number }

/**
 * How many points per week a roster change would have added to the optimal
 * lineup over the given weeks. This is the "value to me" number: a WR3 is
 * worth a lot less to a team with three good WRs than the same WR's WAR says.
 */
export const lineupDelta = (
  slots: Slot[],
  weekPoints: WeekPoints,
  weeks: number[],
  players: PlayerMap,
  base: string[],
  remove: string[],
  add: string[],
): LineupDelta => {
  const removeSet = new Set(remove)
  const after = [...base.filter((id) => !removeSet.has(id)), ...add.filter((id) => !base.includes(id))]
  const perWeek = weeks.map((week) => {
    const pts = weekPoints[week] ?? {}
    const before = optimalLineup(slots, toLineupPlayers(base, players, pts)).total
    const afterPts = optimalLineup(slots, toLineupPlayers(after, players, pts)).total
    return { week, before, after: afterPts }
  })
  const total = perWeek.reduce((a, w) => a + (w.after - w.before), 0)
  return { perWeek, avg: perWeek.length ? total / perWeek.length : 0, total }
}

/**
 * Forward-looking roster strength: optimal lineup by recent WAR/game plus a
 * discounted bench. Used as the roster component of power rankings.
 */
export const rosterStrength = (
  slots: Slot[],
  ids: string[],
  players: PlayerMap,
  values: Record<string, PlayerValue>,
  benchWeight = 0.25,
  benchDepth = 3,
): number => {
  const lineupPlayers = ids
    .filter((id) => players[id])
    .map<LineupPlayer>((id) => ({ id, fpos: players[id].fpos, pts: values[id]?.recentWarPerGame ?? 0 }))
  const lineup = optimalLineup(slots, lineupPlayers)
  const started = new Set(lineup.assignments.filter(Boolean).map((p) => p!.id))
  const bench = lineupPlayers
    .filter((p) => !started.has(p.id) && p.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, benchDepth)
  return lineup.total + benchWeight * bench.reduce((a, p) => a + p.pts, 0)
}
