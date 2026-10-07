// Betting-market player props, turned into expected stats and fantasy points.
//
// Source: Sleeper's own prop board (/lines/available), the same host the rest
// of the app reads, CORS-open, about 100KB gzipped for the NFL slate. Each prop
// carries both sides as payout multipliers, i.e. decimal odds, so the
// probability of the over is read with the margin removed:
//
//   p(over) = (1/m_over) / (1/m_over + 1/m_under)
//
// A line is a median, not a mean. Books hang the number where action splits,
// and weekly yardage is right-skewed, so the mean sits above the line. The
// mean/median factors below were measured on the 2026 week-5 slate as the
// median ratio of Sleeper's projected mean to the market line across every
// player with both (receiving yards n=96, rushing n=49, passing n=28). They
// set the scale only; every player-level difference between the market and
// Sleeper survives.

import { scoreStatLine } from './scoring'
import type { PlayerMap, StatLine, WeekStats } from './types'

export type LineRow = { id: string; game: string; stat: string; line: number; over: number; under: number }

export type PropRead = {
  stat: string
  line: number
  /** Probability of the over with the bookmaker's margin removed. */
  pOver: number
  /** Expected value of the stat implied by the line and its price. */
  mean: number
}

export type MarketPlayer = {
  props: PropRead[]
  /** Implied stat means, keyed like Sleeper stat lines (rec_yd, pass_td...). */
  stats: Record<string, number>
  /** League-scored points from the market's stats, Sleeper's for categories with no line. */
  pts: number
  /** Sleeper's own projection for the same week, league-scored. */
  sleeper: number
  /** P(at least one rushing or receiving TD), when offered. */
  anytimeTd: number | null
}

export type MarketWeek = { week: number; byId: Record<string, MarketPlayer>; players: number; props: number }

/** How much of the market's number goes into the week's projection. An even blend until the tracker says otherwise. */
export const MARKET_WEIGHT = 0.5

/** Mean / median for skewed yardage (see the note at the top). */
export const MEDIAN_TO_MEAN: Record<string, number> = { rec_yd: 1.15, rush_yd: 1.09, pass_yd: 1.0 }

/** Spread of each stat around its median, as a share of it, for reading a price off the line. */
const CV: Record<string, number> = { rec_yd: 0.6, rush_yd: 0.55, pass_yd: 0.25, rec: 0.45, rush_att: 0.35, pass_att: 0.18, pass_cmp: 0.2, kicking_points: 0.45 }

/** Sleeper prop types and the stat key each one prices. */
const STAT: Record<string, string> = {
  passing_yards: 'pass_yd',
  passing_touchdowns: 'pass_td',
  interceptions: 'pass_int',
  pass_completions: 'pass_cmp',
  passing_attempts: 'pass_att',
  rushing_yards: 'rush_yd',
  rushing_attempts: 'rush_att',
  receiving_yards: 'rec_yd',
  receptions: 'rec',
}
/** Small counts read as Poisson. */
const POISSON = new Set(['pass_td', 'pass_int'])

export const PROP_LABEL: Record<string, string> = {
  passing_yards: 'Pass yds',
  passing_touchdowns: 'Pass TD',
  interceptions: 'INT',
  pass_completions: 'Completions',
  passing_attempts: 'Pass att',
  rushing_yards: 'Rush yds',
  rushing_attempts: 'Rush att',
  receiving_yards: 'Rec yds',
  receptions: 'Receptions',
  anytime_touchdowns: 'Anytime TD',
  rushing_and_receiving_yards: 'Rush+rec yds',
  passing_and_rushing_yards: 'Pass+rush yds',
  kicking_points: 'Kicking pts',
}

type RawLine = {
  sport?: string
  subject_type?: string
  subject_id?: string
  game_id?: string
  wager_type?: string
  game_status?: string
  options?: { outcome?: string; outcome_value?: number; payout_multiplier?: string | number }[]
}

/** The board reduced to two-sided NFL player props, before caching. */
export const reduceLines = (raw: unknown): LineRow[] => {
  const out: LineRow[] = []
  for (const x of (Array.isArray(raw) ? raw : []) as RawLine[]) {
    if (x.sport !== 'nfl' || x.subject_type !== 'player' || !x.subject_id || !x.wager_type) continue
    if (x.game_status && x.game_status !== 'pre_game') continue
    const over = x.options?.find((o) => o.outcome === 'over')
    const under = x.options?.find((o) => o.outcome === 'under')
    const mo = Number(over?.payout_multiplier)
    const mu = Number(under?.payout_multiplier)
    if (!over || !under || !(mo > 1) || !(mu > 1) || typeof over.outcome_value !== 'number') continue
    out.push({ id: x.subject_id, game: x.game_id ?? '', stat: x.wager_type, line: over.outcome_value, over: mo, under: mu })
  }
  return out
}

export const devig = (over: number, under: number) => 1 / over / (1 / over + 1 / under)

/** Inverse standard normal (Acklam's rational approximation, relative error < 1.2e-9). */
export const invPhi = (p: number) => {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p))
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (q < lo) {
    const r = Math.sqrt(-2 * Math.log(q))
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
  }
  if (q > 1 - lo) {
    const r = Math.sqrt(-2 * Math.log(1 - q))
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
  }
  const r = q - 0.5
  const s = r * r
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
}

/** P(X > line) for Poisson(λ) with a half-point line. */
const poissonOver = (lambda: number, line: number) => {
  let term = Math.exp(-lambda)
  let cdf = term
  for (let k = 1; k <= Math.floor(line); k++) {
    term *= lambda / k
    cdf += term
  }
  return 1 - cdf
}

/** The Poisson rate whose P(over) matches the price. */
export const poissonRate = (line: number, pOver: number) => {
  let lo = 0
  let hi = Math.max(5, line * 4)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (poissonOver(mid, line) < pOver) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Expected value of a stat from its line and de-vigged over probability. */
export const impliedMean = (stat: string, line: number, pOver: number) => {
  if (POISSON.has(stat)) return poissonRate(line, pOver)
  const cv = CV[stat] ?? 0.4
  // Median from the price: the line sits z standard deviations below it when the over is favoured.
  const median = line / Math.max(0.25, 1 - cv * invPhi(pOver))
  return median * (MEDIAN_TO_MEAN[stat] ?? 1)
}

const share = (a: number | undefined, b: number | undefined, fallbackA: number) => {
  const x = Math.max(0, a ?? 0)
  const y = Math.max(0, b ?? 0)
  return x + y > 0 ? x / (x + y) : fallbackA
}

/**
 * One week of market projections. Categories with a line take the market's
 * number; everything else (fumbles, two-pointers, bonuses, return yards)
 * stays on Sleeper's, and the merged line is scored with the league's own
 * settings, so a PPR league and a half-PPR league read the same props
 * differently, as they should.
 */
export const marketWeek = (input: { rows: LineRow[]; gameWeek: Record<string, number>; week: number; projections: WeekStats; scoring: Record<string, number>; players: PlayerMap }): MarketWeek => {
  const { rows, gameWeek, week, projections, scoring, players } = input
  const grouped: Record<string, LineRow[]> = {}
  for (const r of rows) {
    if (gameWeek[r.game] !== undefined && gameWeek[r.game] !== week) continue
    if (!players[r.id]) continue
    ;(grouped[r.id] ??= []).push(r)
  }
  const byId: Record<string, MarketPlayer> = {}
  let props = 0
  for (const id of Object.keys(grouped)) {
    const base: StatLine = projections[id] ?? {}
    const stats: Record<string, number> = {}
    const reads: PropRead[] = []
    let anytimeTd: number | null = null
    let kicking: number | null = null
    const combos: { stat: string; mean: number }[] = []
    for (const r of grouped[id]) {
      const p = devig(r.over, r.under)
      const key = STAT[r.stat]
      if (key) {
        const mean = impliedMean(key, r.line, p)
        stats[key] = mean
        reads.push({ stat: r.stat, line: r.line, pOver: p, mean })
      } else if (r.stat === 'anytime_touchdowns') {
        anytimeTd = p
        // Scoring at least once with probability p means a rate of −ln(1 − p) under Poisson.
        reads.push({ stat: r.stat, line: r.line, pOver: p, mean: -Math.log(1 - Math.min(0.97, p)) })
      } else if (r.stat === 'rushing_and_receiving_yards' || r.stat === 'passing_and_rushing_yards' || r.stat === 'kicking_points') {
        const key2 = r.stat === 'kicking_points' ? 'kicking_points' : r.stat === 'passing_and_rushing_yards' ? 'pass_yd' : 'rec_yd'
        const mean = impliedMean(key2, r.line, p)
        reads.push({ stat: r.stat, line: r.line, pOver: p, mean })
        if (r.stat === 'kicking_points') kicking = mean
        else combos.push({ stat: r.stat, mean })
      } else continue
      props++
    }
    // Combined-yardage lines fill only the parts that have no line of their own, split as Sleeper splits them.
    for (const c of combos) {
      if (c.stat === 'rushing_and_receiving_yards' && stats.rush_yd === undefined && stats.rec_yd === undefined) {
        const r = share(base.rush_yd, base.rec_yd, players[id].pos === 'RB' ? 0.7 : 0.1)
        stats.rush_yd = c.mean * r
        stats.rec_yd = c.mean * (1 - r)
      }
      if (c.stat === 'passing_and_rushing_yards' && stats.pass_yd === undefined && stats.rush_yd === undefined) {
        const r = share(base.pass_yd, base.rush_yd, 0.9)
        stats.pass_yd = c.mean * r
        stats.rush_yd = c.mean * (1 - r)
      }
    }
    if (anytimeTd != null) {
      const lambda = -Math.log(1 - Math.min(0.97, anytimeTd))
      const r = share(base.rush_td, base.rec_td, players[id].pos === 'RB' || players[id].pos === 'QB' ? 0.75 : 0.05)
      stats.rush_td = lambda * r
      stats.rec_td = lambda * (1 - r)
    }
    const merged: StatLine = { ...base, ...stats }
    const sleeper = scoreStatLine(base, scoring)
    // A kicker's line is already in points; a kicker's other categories are noise next to it.
    const pts = kicking != null && players[id].pos === 'K' ? kicking : scoreStatLine(merged, scoring)
    byId[id] = { props: reads, stats, pts: Math.round(pts * 100) / 100, sleeper: Math.round(sleeper * 100) / 100, anytimeTd }
  }
  return { week, byId, players: Object.keys(byId).length, props }
}

/** The week's projection with the market blended in, for players it prices. Sleeper's zeros (ruled out, on bye) stand. */
export const blendWeek = (pts: Record<string, number>, market: MarketWeek, weight = MARKET_WEIGHT) => {
  const out: Record<string, number> = { ...pts }
  for (const id of Object.keys(market.byId)) {
    const s = pts[id]
    if (!(s > 0)) continue
    out[id] = (1 - weight) * s + weight * market.byId[id].pts
  }
  return out
}

// ---------- Accuracy tracker ----------
//
// There is no free archive of past prop lines, so the only honest test is to
// keep our own: each week the page is opened before kickoff, it files what the
// market and Sleeper projected for every priced player; once the week is
// scored, both are graded on what happened.

const SNAP_PREFIX = 'ff:lines:v1:'

export type Snapshot = Record<string, [sleeper: number, market: number]>

export const saveSnapshot = (season: string, market: MarketWeek) => {
  try {
    if (typeof window === 'undefined') return
    const key = `${SNAP_PREFIX}${season}:${market.week}`
    const snap: Snapshot = {}
    for (const id of Object.keys(market.byId)) snap[id] = [market.byId[id].sleeper, market.byId[id].pts]
    // Keep the earliest full snapshot of the week; later loads only add players (lines come and go).
    const prev = JSON.parse(window.localStorage.getItem(key) ?? '{}') as Snapshot
    window.localStorage.setItem(key, JSON.stringify({ ...snap, ...prev }))
  } catch {
    // Private mode or full storage: the tracker simply has fewer weeks.
  }
}

export const loadSnapshots = (season: string): Record<number, Snapshot> => {
  const out: Record<number, Snapshot> = {}
  try {
    if (typeof window === 'undefined') return out
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k?.startsWith(`${SNAP_PREFIX}${season}:`)) continue
      out[Number(k.split(':').pop())] = JSON.parse(window.localStorage.getItem(k) ?? '{}') as Snapshot
    }
  } catch {
    // ignore
  }
  return out
}

export type LinesGrade = { weeks: number[]; n: number; maeSleeper: number; maeMarket: number; maeBlend: number }

/** Mean absolute error of each projection against what happened, over players who played. */
export const gradeSnapshots = (snaps: Record<number, Snapshot>, weekPoints: Record<number, Record<string, number>>, weight = MARKET_WEIGHT): LinesGrade | null => {
  let n = 0
  let s = 0
  let m = 0
  let b = 0
  const weeks: number[] = []
  for (const w of Object.keys(snaps).map(Number)) {
    const actual = weekPoints[w]
    if (!actual) continue
    let used = false
    for (const [id, [sl, mk]] of Object.entries(snaps[w])) {
      const a = actual[id]
      if (a === undefined) continue
      n++
      used = true
      s += Math.abs(a - sl)
      m += Math.abs(a - mk)
      b += Math.abs(a - ((1 - weight) * sl + weight * mk))
    }
    if (used) weeks.push(w)
  }
  return n ? { weeks: weeks.sort((x, y) => x - y), n, maeSleeper: s / n, maeMarket: m / n, maeBlend: b / n } : null
}
