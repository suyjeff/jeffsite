// Standings, all-play records, luck, and a composite power ranking.

import { optimalLineup, type LineupPlayer, type Slot } from './lineup'
import type { PlayerMap, SleeperMatchup } from './types'

export type TeamWeek = {
  week: number
  rosterId: number
  points: number
  opponentId: number | null
  opponentPoints: number | null
  result: 'W' | 'L' | 'T' | null
  optimalPoints: number
  starters: string[]
  players: string[]
  playersPoints: Record<string, number>
}

export type TeamSeason = {
  rosterId: number
  games: number
  wins: number
  losses: number
  ties: number
  pf: number
  pa: number
  ppg: number
  papg: number
  allPlayWins: number
  allPlayLosses: number
  allPlayPct: number
  expectedWins: number
  luck: number
  recentPpg: number
  sd: number
  high: number
  low: number
  efficiency: number
  streak: string
  weeks: TeamWeek[]
  remainingOpponents: number[]
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Turn raw weekly matchup payloads into per-team week records. A week counts
 * as played when any team posted points.
 */
export const buildTeamWeeks = (
  matchupsByWeek: Record<number, SleeperMatchup[]>,
  playedWeeks: number[],
  slots: Slot[],
  players: PlayerMap,
): Record<number, TeamWeek[]> => {
  const out: Record<number, TeamWeek[]> = {}
  for (const week of playedWeeks) {
    const ms = matchupsByWeek[week] ?? []
    const byMatchup: Record<number, SleeperMatchup[]> = {}
    for (const m of ms) if (m.matchup_id != null) (byMatchup[m.matchup_id] ??= []).push(m)
    for (const m of ms) {
      const opp = m.matchup_id != null ? byMatchup[m.matchup_id]?.find((o) => o.roster_id !== m.roster_id) : undefined
      const playersPoints = m.players_points ?? {}
      const lineupPlayers = (m.players ?? [])
        .filter((id) => players[id])
        .map<LineupPlayer>((id) => ({ id, fpos: players[id].fpos, pts: playersPoints[id] ?? 0 }))
      const optimal = optimalLineup(slots, lineupPlayers).total
      const points = m.points ?? 0
      let result: TeamWeek['result'] = null
      if (opp) result = points > opp.points ? 'W' : points < opp.points ? 'L' : 'T'
      ;(out[week] ??= []).push({
        week,
        rosterId: m.roster_id,
        points,
        opponentId: opp?.roster_id ?? null,
        opponentPoints: opp?.points ?? null,
        result,
        optimalPoints: Math.max(optimal, points),
        starters: (m.starters ?? []).filter((s) => s && s !== '0'),
        players: m.players ?? [],
        playersPoints,
      })
    }
  }
  return out
}

export const futureOpponents = (
  matchupsByWeek: Record<number, SleeperMatchup[]>,
  futureWeeks: number[],
): Record<number, number[]> => {
  const out: Record<number, number[]> = {}
  for (const week of futureWeeks) {
    const ms = matchupsByWeek[week] ?? []
    const byMatchup: Record<number, SleeperMatchup[]> = {}
    for (const m of ms) if (m.matchup_id != null) (byMatchup[m.matchup_id] ??= []).push(m)
    for (const m of ms) {
      const opp = m.matchup_id != null ? byMatchup[m.matchup_id]?.find((o) => o.roster_id !== m.roster_id) : undefined
      if (opp) (out[m.roster_id] ??= []).push(opp.roster_id)
    }
  }
  return out
}

export const buildTeamSeasons = (
  rosterIds: number[],
  teamWeeks: Record<number, TeamWeek[]>,
  playedWeeks: number[],
  remaining: Record<number, number[]>,
  recentWindow = 3,
): TeamSeason[] => {
  return rosterIds.map((rosterId) => {
    const weeks = playedWeeks
      .map((w) => (teamWeeks[w] ?? []).find((t) => t.rosterId === rosterId))
      .filter((t): t is TeamWeek => !!t)
    let wins = 0
    let losses = 0
    let ties = 0
    let allPlayWins = 0
    let allPlayLosses = 0
    let optimalSum = 0
    const results: string[] = []
    for (const tw of weeks) {
      if (tw.result === 'W') wins++
      else if (tw.result === 'L') losses++
      else if (tw.result === 'T') ties++
      if (tw.result) results.push(tw.result)
      optimalSum += tw.optimalPoints
      for (const other of teamWeeks[tw.week] ?? []) {
        if (other.rosterId === rosterId) continue
        if (tw.points > other.points) allPlayWins++
        else if (tw.points < other.points) allPlayLosses++
        else {
          allPlayWins += 0.5
          allPlayLosses += 0.5
        }
      }
    }
    const scores = weeks.map((w) => w.points)
    const pf = scores.reduce((a, b) => a + b, 0)
    const pa = weeks.reduce((a, w) => a + (w.opponentPoints ?? 0), 0)
    const games = weeks.length
    const decided = wins + losses + ties
    const allPlayGames = allPlayWins + allPlayLosses
    const allPlayPct = allPlayGames ? allPlayWins / allPlayGames : 0
    const expectedWins = allPlayPct * decided
    const m = games ? pf / games : 0
    const sd = games > 1 ? Math.sqrt(scores.reduce((a, x) => a + (x - m) ** 2, 0) / (games - 1)) : 0
    const recent = scores.slice(-recentWindow)
    let streak = ''
    if (results.length) {
      const last = results[results.length - 1]
      let n = 0
      for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
      streak = `${last}${n}`
    }
    return {
      rosterId,
      games,
      wins,
      losses,
      ties,
      pf: round2(pf),
      pa: round2(pa),
      ppg: games ? round2(pf / games) : 0,
      papg: games ? round2(pa / games) : 0,
      allPlayWins,
      allPlayLosses,
      allPlayPct,
      expectedWins,
      luck: wins + ties * 0.5 - expectedWins,
      recentPpg: recent.length ? round2(recent.reduce((a, b) => a + b, 0) / recent.length) : 0,
      sd: round2(sd),
      high: scores.length ? Math.max(...scores) : 0,
      low: scores.length ? Math.min(...scores) : 0,
      efficiency: optimalSum ? pf / optimalSum : 0,
      streak,
      weeks,
      remainingOpponents: remaining[rosterId] ?? [],
    }
  })
}

export type PowerWeights = {
  allPlay: number
  points: number
  recent: number
  roster: number
  efficiency: number
}

export const DEFAULT_POWER_WEIGHTS: PowerWeights = {
  allPlay: 0.35,
  points: 0.2,
  recent: 0.15,
  roster: 0.25,
  efficiency: 0.05,
}

export type PowerRow = {
  rosterId: number
  rank: number
  score: number
  components: Record<keyof PowerWeights, number> // z-scores
  sos: number | null
}

const zscores = (xs: number[]) => {
  const n = xs.length
  if (!n) return []
  const m = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / n)
  return xs.map((x) => (sd ? (x - m) / sd : 0))
}

/**
 * Composite ranking: z-score each component across the league, weight, then
 * min-max to 0-100. Components with no data (e.g. preseason) are dropped and
 * the remaining weights renormalized, so the ranking still works in week 0.
 */
export const computePower = (
  teams: TeamSeason[],
  rosterStrength: Record<number, number>,
  weights: PowerWeights,
): PowerRow[] => {
  const hasGames = teams.some((t) => t.games > 0)
  const hasRoster = Object.values(rosterStrength).some((v) => v !== 0)
  const raw: Record<keyof PowerWeights, number[]> = {
    allPlay: teams.map((t) => t.allPlayPct),
    points: teams.map((t) => t.ppg),
    recent: teams.map((t) => t.recentPpg),
    roster: teams.map((t) => rosterStrength[t.rosterId] ?? 0),
    efficiency: teams.map((t) => t.efficiency),
  }
  const active: (keyof PowerWeights)[] = (Object.keys(weights) as (keyof PowerWeights)[]).filter((k) => {
    if (weights[k] <= 0) return false
    if (k === 'roster') return hasRoster
    return hasGames
  })
  const weightSum = active.reduce((a, k) => a + weights[k], 0) || 1
  const z: Record<keyof PowerWeights, number[]> = {
    allPlay: zscores(raw.allPlay),
    points: zscores(raw.points),
    recent: zscores(raw.recent),
    roster: zscores(raw.roster),
    efficiency: zscores(raw.efficiency),
  }
  const composite = teams.map((_, i) => active.reduce((a, k) => a + (weights[k] / weightSum) * z[k][i], 0))
  const lo = Math.min(...composite)
  const hi = Math.max(...composite)
  const rows = teams.map((t, i) => ({
    rosterId: t.rosterId,
    rank: 0,
    score: hi > lo ? ((composite[i] - lo) / (hi - lo)) * 100 : 50,
    components: {
      allPlay: z.allPlay[i],
      points: z.points[i],
      recent: z.recent[i],
      roster: z.roster[i],
      efficiency: z.efficiency[i],
    },
    sos: null as number | null,
  }))
  const scoreById: Record<number, number> = {}
  rows.forEach((r) => (scoreById[r.rosterId] = r.score))
  teams.forEach((t, i) => {
    const opp = t.remainingOpponents
    rows[i].sos = opp.length ? opp.reduce((a, id) => a + (scoreById[id] ?? 50), 0) / opp.length : null
  })
  rows.sort((a, b) => b.score - a.score)
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}
