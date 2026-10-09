// Waiver wire: who to add for the long haul, and who to stream for a week.
//
// Streaming (quarterbacks, kickers, defenses) is mostly matchup, so each
// candidate is read four ways, every one from data already on the page:
//
//   projection   Sleeper's league-scored projection for the week (blended with
//                prop lines for the coming week, like everywhere else).
//   environment  The implied team total: points the market expects the team
//                to score. From the kicker's extra-point and field-goal props
//                when the board has them (the market itself), otherwise from
//                Sleeper's projected points allowed by the opponent's defense,
//                which is built on the Vegas line.
//   matchup      Fantasy points the opponent has given up to the position per
//                game this season, as a share of the league average.
//   upside       Chance of a starter-level week: the projection read against
//                the position's measured week-to-week spread.

import { phi } from './forecast'
import type { Horizon } from './trades'
import type { Schedule } from './context'
import type { MarketWeek } from './lines'
import type { PlayerMap, TrendingEntry, WeekStats } from './types'

export type StreamPos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'
export const STREAM_POSITIONS: StreamPos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
/** Positions a whole team shares: what a defense allows to them is the sum over the room, not its best player. */
const SHARED: StreamPos[] = ['RB', 'WR', 'TE']

/** Week-to-week spread by position when there is too little to measure it (pts, typical leagues). */
const FALLBACK_SD: Record<string, number> = {
  QB: 7.5,
  K: 4.5,
  DEF: 5.5,
  RB: 7,
  WR: 7,
  TE: 5.5,
}

/** Share of extra-point tries that are made, for reading touchdowns off an extra-point line. */
const XP_RATE = 0.95

export type Allowed = {
  /** Raw points allowed per game. */
  ppg: number
  games: number
  /** Regressed ppg over the league average, 1 = average. */
  index: number
  /** 1 = gives up the most, on the regressed number. */
  rank: number
}

/**
 * Games of league-average defense mixed into every team's number. A few weeks
 * of points allowed are mostly the quarterbacks a defense happened to draw, so
 * four games in, a team's own record carries a bit over half the weight.
 */
export const ALLOWED_PRIOR_GAMES = 3

/**
 * Fantasy points each NFL team has given up to a position per game, season to
 * date. For quarterbacks and kickers that is what the opposing player scored;
 * for defenses it is read the other way round, as what an offense hands the
 * defense across from it (sacks, turnovers, points), so a high number is a
 * soft offense to stream against.
 *
 * Quarterbacks and kickers count the top scorer at the position on the team
 * that week, so a garbage-time backup does not halve the number. Running backs,
 * receivers and tight ends count the whole room, since that is what a defense
 * gives up to the position.
 *
 * Sleeper's weekly stat lines do not say which team a player played for, so a
 * player is read on his current team. A week where that team had no game (he
 * moved since) is skipped rather than charged to the wrong defense; a move
 * between two teams that both played that week cannot be caught, which is rare
 * at quarterback and kicker and impossible for a defense.
 */
export const pointsAllowed = (
  weekPoints: Record<number, Record<string, number>>,
  weeks: number[],
  players: PlayerMap,
  schedule: Schedule | null,
  pos: StreamPos,
): Record<string, Allowed> => {
  if (!schedule) return {}
  const sum: Record<string, { pts: number; games: number }> = {}
  for (const w of weeks) {
    const pts = weekPoints[w]
    if (!pts) continue
    // Each NFL team's output at the position this week: its best player, or the whole room.
    const shared = SHARED.includes(pos)
    const top: Record<string, number> = {}
    for (const [id, p] of Object.entries(pts)) {
      const pl = players[id]
      if (!pl?.team || pl.pos !== pos) continue
      top[pl.team] = shared ? (top[pl.team] ?? 0) + p : Math.max(top[pl.team] ?? -Infinity, p)
    }
    for (const [team, p] of Object.entries(top)) {
      const opp = schedule.opp[team]?.[w]
      if (!opp) continue
      // QB/K: charged to the defense they faced. DEF: credited to the offense it faced.
      const s = (sum[opp] ??= { pts: 0, games: 0 })
      s.pts += p
      s.games++
    }
  }
  const teams = Object.keys(sum).filter((t) => sum[t].games > 0)
  const avg = teams.reduce((a, t) => a + sum[t].pts / sum[t].games, 0) / (teams.length || 1)
  const shrunk = (t: string) => (sum[t].pts + ALLOWED_PRIOR_GAMES * avg) / (sum[t].games + ALLOWED_PRIOR_GAMES)
  const order = [...teams].sort((a, b) => shrunk(b) - shrunk(a))
  const out: Record<string, Allowed> = {}
  order.forEach((t, i) => {
    out[t] = {
      ppg: sum[t].pts / sum[t].games,
      games: sum[t].games,
      index: avg ? shrunk(t) / avg : 1,
      rank: i + 1,
    }
  })
  return out
}

/** Points the market expects one team to score, from its kicker's extra-point and field-goal props. */
export const kickerImpliedTotal = (xpMean: number, fgMean: number) => {
  const tds = xpMean / XP_RATE
  return 6 * tds + xpMean + 3 * fgMean
}

export type TeamTotal = { pts: number; source: 'market' | 'projection' }

/**
 * Implied points for every team playing in a week. Market first (kicker props,
 * coming week only), then Sleeper's projected points allowed by the opponent.
 */
export const impliedTotals = (input: {
  week: number
  schedule: Schedule | null
  statLines: WeekStats | null
  market: MarketWeek | null
  players: PlayerMap
}): Record<string, TeamTotal> => {
  const { week, schedule, statLines, market, players } = input
  const out: Record<string, TeamTotal> = {}
  if (!schedule) return out
  if (statLines) {
    for (const team of Object.keys(schedule.opp)) {
      const opp = schedule.opp[team][week]
      const allow = opp ? statLines[opp]?.pts_allow : undefined
      if (typeof allow === 'number' && allow > 0) out[team] = { pts: allow, source: 'projection' }
    }
  }
  if (market?.week === week) {
    for (const [id, k] of Object.entries(market.kickers ?? {})) {
      const pl = players[id]
      if (pl?.pos !== 'K' || !pl.team || !schedule.opp[pl.team]?.[week] || k.xp == null || k.fg == null) continue
      out[pl.team] = { pts: kickerImpliedTotal(k.xp, k.fg), source: 'market' }
    }
  }
  return out
}

/**
 * Week-to-week standard deviation of fantasy points at a position, pooled
 * within players who were regulars (three or more games, averaging at least
 * half the position's typical starter). Falls back to typical values early in
 * the season.
 */
export const positionSpread = (weekPoints: Record<number, Record<string, number>>, weeks: number[], players: PlayerMap, pos: string, starter: number) => {
  const by: Record<string, number[]> = {}
  for (const w of weeks) for (const [id, p] of Object.entries(weekPoints[w] ?? {})) if (players[id]?.pos === pos) (by[id] ??= []).push(p)
  let ss = 0
  let df = 0
  for (const xs of Object.values(by)) {
    if (xs.length < 3) continue
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    if (m < starter * 0.5) continue
    ss += xs.reduce((a, x) => a + (x - m) ** 2, 0)
    df += xs.length - 1
  }
  // Need a real sample before it beats the prior; blend toward it otherwise.
  const prior = FALLBACK_SD[pos] ?? 6
  if (!df) return prior
  const measured = Math.sqrt(ss / df)
  const k = 30
  return (df * measured + k * prior) / (df + k)
}

/** P(a week at or above `threshold`), reading the projection as the mean of a normal with spread `sd`. */
export const boomOdds = (proj: number, sd: number, threshold: number) => (proj > 0 ? 1 - phi((threshold - proj) / Math.max(1, sd)) : 0)

export type StreamRow = {
  id: string
  week: number
  proj: number
  opp: string | null
  home: boolean | null
  /** Implied points for the player's team. */
  teamTotal: TeamTotal | null
  /** Implied points for the opponent: what a defense streamer is up against. */
  oppTotal: TeamTotal | null
  /** How the opponent has treated the position this season. */
  matchup: Allowed | null
  /** P(at least a league-average starter's week). */
  boom: number
  /** Projection minus the player he would replace: your weakest starter at the position this week. */
  vsMine: number | null
  /** Weeks ahead: projection and matchup, for streamers worth holding. */
  ahead: {
    week: number
    opp: string | null
    proj: number
    matchup: Allowed | null
  }[]
  trending: number
  /** Key projected stats for the reason line. */
  stats: Record<string, number>
}

export const streamRows = (input: {
  pos: StreamPos
  week: number
  aheadWeeks: number[]
  players: PlayerMap
  rosteredBy: Record<string, number>
  myPlayers: string[]
  horizon: Horizon
  schedule: Schedule | null
  totals: Record<string, TeamTotal>
  allowed: Record<string, Allowed>
  statLines: WeekStats | null
  starter: number
  sd: number
  trending: TrendingEntry[]
  /** Lineup slots for the position alone (no flex); defaults to one. */
  starts?: number
  limit?: number
}): { rows: StreamRow[]; mine: { id: string; proj: number } | null } => {
  const { pos, week, players, rosteredBy, horizon, schedule, totals, allowed, statLines, starter, sd } = input
  const h = horizon.find((x) => x.week === week)
  if (!h) return { rows: [], mine: null }
  const trend: Record<string, number> = {}
  for (const t of input.trending) trend[t.player_id] = t.count
  const myAtPos = input.myPlayers.filter((id) => players[id]?.pos === pos).map((id) => ({ id, proj: h.pts[id] ?? 0 }))
  // A streamer replaces your weakest starter at the spot, not your best: RB2 when you start two.
  const ranked = myAtPos.sort((a, b) => b.proj - a.proj)
  const mine = ranked[Math.min(Math.max(1, input.starts ?? 1), ranked.length) - 1] ?? null
  const projAt = (id: string, w: number) => horizon.find((x) => x.week === w)?.pts[id] ?? 0
  const rows: StreamRow[] = []
  for (const [id, pl] of Object.entries(players)) {
    if (pl.pos !== pos || rosteredBy[id] != null || !pl.team) continue
    const proj = h.pts[id] ?? 0
    if (!(proj > 0)) continue
    const opp = schedule?.opp[pl.team]?.[week] ?? null
    const line = statLines?.[id] ?? {}
    const stats: Record<string, number> = {}
    for (const k of ['pass_yd', 'pass_td', 'rush_yd', 'rush_att', 'rec_tgt', 'rec', 'pass_int', 'fga', 'xpa', 'sack', 'int', 'fum_rec', 'pts_allow'])
      if (typeof line[k] === 'number') stats[k] = line[k]
    rows.push({
      id,
      week,
      proj,
      opp,
      home: schedule?.home?.[pl.team]?.[week] ?? null,
      teamTotal: totals[pl.team] ?? null,
      oppTotal: opp ? (totals[opp] ?? null) : null,
      matchup: opp ? (allowed[opp] ?? null) : null,
      boom: boomOdds(proj, sd, starter),
      vsMine: mine ? proj - mine.proj : null,
      ahead: input.aheadWeeks.map((w) => {
        const o = schedule?.opp[pl.team!]?.[w] ?? null
        return {
          week: w,
          opp: o,
          proj: projAt(id, w),
          matchup: o ? (allowed[o] ?? null) : null,
        }
      }),
      trending: trend[id] ?? 0,
      stats,
    })
  }
  rows.sort((a, b) => b.proj - a.proj)
  return { rows: rows.slice(0, input.limit ?? 25), mine }
}

export type StreamReason = { text: string; tone: 'pos' | 'neg' | 'warn' | 'neutral' }

/**
 * Why a player is on the list, as whole sentences with a tone each: the
 * signals that stand out (top or bottom third of the league), strongest first.
 */
export const streamReasons = (r: StreamRow, pos: StreamPos, teamCount = 32): StreamReason[] => {
  const out: StreamReason[] = []
  const third = teamCount / 3
  const src = (t: TeamTotal) => (t.source === 'market' ? 'from betting lines' : 'from Sleeper, on the Vegas line')
  if (pos === 'DEF') {
    if (r.oppTotal)
      out.push({ text: `${r.opp} is projected to score ${r.oppTotal.pts.toFixed(1)} (${src(r.oppTotal)})`, tone: r.oppTotal.pts <= 19 ? 'pos' : r.oppTotal.pts >= 25 ? 'neg' : 'neutral' })
    if (r.matchup && r.matchup.rank <= third) out.push({ text: `${r.opp} gives up ${r.matchup.ppg.toFixed(1)} fantasy pts a game to defenses, #${r.matchup.rank} most`, tone: 'pos' })
    if (r.matchup && r.matchup.rank > teamCount - third) out.push({ text: `${r.opp} protects the ball: #${r.matchup.rank} in points allowed to defenses`, tone: 'neg' })
    if ((r.stats.sack ?? 0) >= 2.8) out.push({ text: `${r.stats.sack.toFixed(1)} sacks projected`, tone: 'pos' })
    const takeaways = (r.stats.int ?? 0) + (r.stats.fum_rec ?? 0)
    if (takeaways >= 1.3) out.push({ text: `${takeaways.toFixed(1)} takeaways projected`, tone: 'pos' })
  } else {
    if (r.teamTotal) out.push({ text: `His team projects ${r.teamTotal.pts.toFixed(1)} points (${src(r.teamTotal)})`, tone: r.teamTotal.pts >= 26 ? 'pos' : r.teamTotal.pts <= 19 ? 'neg' : 'neutral' })
    if (r.matchup && r.matchup.rank <= third) out.push({ text: `${r.opp} allows ${r.matchup.ppg.toFixed(1)} pts a game to ${pos}s, #${r.matchup.rank} most`, tone: 'pos' })
    if (r.matchup && r.matchup.rank > teamCount - third) out.push({ text: `Tough draw: ${r.opp} is #${r.matchup.rank} of ${teamCount} against ${pos}s`, tone: 'neg' })
    if (pos === 'QB' && (r.stats.rush_yd ?? 0) >= 25) out.push({ text: `${Math.round(r.stats.rush_yd)} rushing yards projected: a floor most QBs lack`, tone: 'pos' })
    if (pos === 'K' && (r.stats.fga ?? 0) >= 2.2) out.push({ text: `${r.stats.fga.toFixed(1)} field-goal tries projected`, tone: 'pos' })
    if (pos === 'RB' && (r.stats.rush_att ?? 0) >= 12) out.push({ text: `${Math.round(r.stats.rush_att)} carries projected: a real share of the backfield`, tone: 'pos' })
    if ((pos === 'WR' || pos === 'TE' || pos === 'RB') && (r.stats.rec_tgt ?? 0) >= 5) out.push({ text: `${r.stats.rec_tgt.toFixed(1)} targets projected`, tone: 'pos' })
  }
  if (r.home === true) out.push({ text: 'Home game', tone: 'neutral' })
  if (r.trending >= 500) out.push({ text: `${r.trending.toLocaleString()} Sleeper adds in the last day`, tone: r.trending >= 5000 ? 'warn' : 'neutral' })
  return out
}
