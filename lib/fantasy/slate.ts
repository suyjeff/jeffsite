// The week's NFL slate, read for this league: which games decide which fantasy
// matchups, through which players, and what each result does to the season.
//
// Every starter is a distribution, not a number: his projection, with a spread
// set by his position's week-to-week variation measured on this season's
// starters (coefficient of variation, shrunk toward long-run defaults while
// the sample is thin). Each team's spreads are scaled together so a full
// lineup's spread matches the league's measured weekly noise, the same σ the
// season simulation uses, so a matchup here and a matchup there agree.
//
//   win odds     P(your lineup outscores theirs), normal on the difference.
//   swing        how far his game moves his manager's win odds: the gap
//                between a 20th- and an 80th-percentile game for him, with
//                everyone else still uncertain.
//   stakes       what a win is worth in playoff odds (the season simulated
//                with this week won, then lost, on the same draws).
//   standing     swing × stakes: the playoff odds riding on his game.
//
// Once his game is final his number is fact: his spread is gone, and what he
// did shows as the change it made to his manager's win odds against his
// projection.

import type { ScheduleGame } from './context'
import { phi, type Stakes } from './forecast'
import type { PlayerMap, SleeperMatchup } from './types'
import type { TeamTotal } from './waivers'
import type { WeekPoints } from './war'

/** Week-to-week coefficient of variation for a fantasy starter, long-run, by position. */
export const DEFAULT_CV: Record<string, number> = { QB: 0.42, RB: 0.6, WR: 0.65, TE: 0.7, K: 0.5, DEF: 0.75 }
const CV_PRIOR = 12
/** z for the 20th and 80th percentiles. */
const Z80 = 0.8416

export const positionCV = (weekPoints: WeekPoints, weeks: number[], players: PlayerMap): Record<string, number> => {
  const series: Record<string, number[]> = {}
  for (const w of weeks) for (const [id, pts] of Object.entries(weekPoints[w] ?? {})) (series[id] ??= []).push(pts)
  const byPos: Record<string, number[]> = {}
  for (const [id, xs] of Object.entries(series)) {
    const pos = players[id]?.pos
    if (!pos || !(pos in DEFAULT_CV) || xs.length < 3) continue
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    // Starters only: a player averaging under six is mostly noise around zero.
    if (mean < 6) continue
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
    ;(byPos[pos] ??= []).push(sd / mean)
  }
  const out: Record<string, number> = {}
  for (const [pos, prior] of Object.entries(DEFAULT_CV)) {
    const xs = (byPos[pos] ?? []).sort((a, b) => a - b)
    const med = xs.length ? xs[Math.floor(xs.length / 2)] : prior
    out[pos] = (xs.length * med + CV_PRIOR * prior) / (xs.length + CV_PRIOR)
  }
  return out
}

export type SlatePlayer = {
  id: string
  team: string
  pos: string
  owner: number
  proj: number
  sd: number
  /** 20th and 80th percentile games. */
  low: number
  high: number
  /** Points, once his game is final. */
  actual: number | null
  /** Points so far in a game under way. */
  live: number | null
  /** His manager's win odds, a bad game against a good one (0–1). */
  swing: number
  /** Final games: his manager's win odds now, minus with him at projection. */
  realized: number | null
  /** Playoff odds riding on his game: swing × what a win is worth. */
  standing: number | null
}

export type SlateGame = {
  key: string
  week: number
  date: string | null
  status: string
  final: boolean
  /** Under way: points are on the board but the game is not final. */
  live: boolean
  home: string
  away: string
  totals: { home: TeamTotal | null; away: TeamTotal | null }
  /** League starters in it, biggest swing first. */
  players: SlatePlayer[]
  /** Win odds this game moves, a bad game against a good one, summed over the league's matchups. */
  swing: number
}

export type SlateSide = {
  rosterId: number
  /** Expected score, finals counted as scored. */
  mu: number
  sd: number
  /** Points already final. */
  banked: number
  /** Starters still to play. */
  left: number
  starters: string[]
}

export type SlateMatchup = {
  a: SlateSide
  b: SlateSide
  /** P(a wins). */
  pA: number
  /** The game with the most riding on it for these two. */
  keyGame: string | null
}

export type SlateManager = {
  rosterId: number
  opponent: number | null
  win: number
  stakes: Stakes | null
  /** Games that matter to this manager: his starters and his opponent's, by the win odds the game moves. */
  games: { key: string; swing: number; mine: string[]; theirs: string[] }[]
}

export type Slate = {
  week: number
  games: SlateGame[]
  matchups: SlateMatchup[]
  managers: Record<number, SlateManager>
  /** Every player in the slate, by id. */
  byId: Record<string, SlatePlayer>
  /** Each NFL team's game this week: final, under way, or not started (missing: a bye). */
  teamState: Record<string, 'final' | 'live' | 'pre'>
}

export type SlateInput = {
  week: number
  games: ScheduleGame[]
  players: PlayerMap
  /** This week's matchups (starters and points as Sleeper has them); empty before the week is set. */
  matchups: SleeperMatchup[]
  /** Fallback starters by roster, when a matchup has none. */
  lineups: Record<number, string[]>
  /** This week's projections in league scoring. */
  proj: Record<string, number>
  cv: Record<string, number>
  /** Weekly team-score noise. */
  sigma: number
  totals: Record<string, TeamTotal>
  stakes: Record<number, Stakes> | null
  /** YYYY-MM-DD, for tests; defaults to today (UTC). */
  today?: string
}

const gameKey = (g: ScheduleGame) => `${g.week}:${g.away}@${g.home}`

export const buildSlate = (input: SlateInput): Slate => {
  const { players, proj, cv, sigma } = input
  const games = input.games.filter((g) => g.week === input.week && g.status !== 'canceled')
  const gameOf: Record<string, ScheduleGame> = {}
  for (const g of games) gameOf[g.home] = gameOf[g.away] = g
  // Final by Sleeper's status, or by the calendar once the game's date is past (the status can lag).
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const isFinal = (g: ScheduleGame | undefined) => g?.status === 'complete' || (!!g?.date && g.date < today)
  // Under way: Sleeper says so, or points are already on the board for its players.
  const isLive = (g: ScheduleGame | undefined) => g?.status === 'in_game' || g?.status === 'in_progress'

  // Pairings and lineups, from Sleeper's own matchups when the week has them.
  const byMatchup = new Map<number, SleeperMatchup[]>()
  for (const m of input.matchups) if (m.matchup_id != null) byMatchup.set(m.matchup_id, [...(byMatchup.get(m.matchup_id) ?? []), m])
  const pairs = [...byMatchup.values()].filter((xs) => xs.length === 2)

  const sideOf = (m: SleeperMatchup) => {
    const starters = (m.starters?.length ? m.starters : (input.lineups[m.roster_id] ?? [])).filter((id) => id && id !== '0' && players[id])
    // Spreads scaled so the full lineup carries the league's weekly σ.
    const raw = starters.map((id) => (cv[players[id].pos] ?? 0.65) * Math.max(1, proj[id] ?? 0))
    const k = Math.min(2.5, Math.max(0.8, sigma / Math.sqrt(raw.reduce((a, b) => a + b * b, 0) || 1)))
    const parts = starters.map((id, i) => {
      const g = gameOf[players[id].team ?? '']
      const final = isFinal(g)
      const posted = m.players_points?.[id]
      const actual = final ? (posted ?? 0) : null
      const p = g ? (proj[id] ?? 0) : 0
      // A game under way: what he has plus half his projection still to come (the clock is not in the data, so
      // halftime is the assumption), and the spread of half a game.
      const live = !final && (isLive(g) || (posted != null && posted !== 0)) ? (posted ?? 0) : null
      if (live != null) return { id, final, actual, live, proj: p, mu: live + 0.5 * p, sd: raw[i] * k * Math.SQRT1_2, sd0: raw[i] * k }
      return { id, final, actual, live, proj: p, mu: final ? (posted ?? 0) : p, sd: final || !g ? 0 : raw[i] * k, sd0: raw[i] * k }
    })
    const mu = parts.reduce((a, p) => a + p.mu, 0)
    const v = parts.reduce((a, p) => a + p.sd ** 2, 0)
    return {
      side: {
        rosterId: m.roster_id,
        mu,
        sd: Math.sqrt(v),
        banked: parts.reduce((a, p) => a + (p.actual ?? p.live ?? 0), 0),
        left: parts.filter((p) => !p.final && p.proj > 0).length,
        starters,
      },
      parts,
      v,
    }
  }

  const byId: Record<string, SlatePlayer> = {}
  const matchups: SlateMatchup[] = []
  const managers: Record<number, SlateManager> = {}
  const swingByGame: Record<string, number> = {}

  for (const [ma, mb] of pairs) {
    const A = sideOf(ma)
    const B = sideOf(mb)
    const V = A.v + B.v
    const pOf = (d: number, v: number) => (v > 1e-9 ? phi(d / Math.sqrt(v)) : d > 0 ? 1 : d < 0 ? 0 : 0.5)
    const pA = pOf(A.side.mu - B.side.mu, V)
    for (const [me, them] of [
      [A, B],
      [B, A],
    ] as const) {
      const d = me.side.mu - them.side.mu
      const st = input.stakes?.[me.side.rosterId] ?? null
      const worth = st ? st.win.playoffs - st.loss.playoffs : null
      for (const p of me.parts) {
        const pl = players[p.id]
        const g = gameOf[pl.team ?? '']
        if (!g) continue
        const rest = Math.max(1, V - p.sd ** 2)
        const swing = p.final ? 0 : pOf(d + Z80 * p.sd, rest) - pOf(d - Z80 * p.sd, rest)
        // A final game: odds now, against the same week with him back at his projection and his spread restored.
        const realized = p.final ? pOf(d, V) - pOf(d - p.actual! + p.proj, V + p.sd0 ** 2) : null
        byId[p.id] = {
          id: p.id,
          team: pl.team!,
          pos: pl.pos,
          owner: me.side.rosterId,
          proj: p.proj,
          sd: p.sd,
          low: Math.max(p.live ?? 0, p.mu - Z80 * p.sd),
          high: p.mu + Z80 * p.sd,
          live: p.live,
          actual: p.actual,
          swing,
          realized,
          standing: worth == null ? null : (p.final ? (realized ?? 0) : swing) * worth,
        }
      }
    }
    // Per game, for this matchup: everyone in it on either side as one bet. Your starters' points count for
    // you and theirs against, so the game's net spread is the root of all their variances together (each
    // player's game taken as independent), and its swing is a bad game against a good one for that net.
    const per: Record<string, { key: string; v: number; a: string[]; b: string[] }> = {}
    for (const [side, parts] of [
      ['a', A.parts],
      ['b', B.parts],
    ] as const)
      for (const p of parts) {
        const g = gameOf[players[p.id].team ?? '']
        if (!g || !byId[p.id]) continue
        const e = (per[gameKey(g)] ??= { key: gameKey(g), v: 0, a: [], b: [] })
        e[side].push(p.id)
        e.v += p.sd ** 2
      }
    const dA = A.side.mu - B.side.mu
    const gameSwing: Record<string, number> = {}
    for (const e of Object.values(per)) {
      const sg = Math.sqrt(e.v)
      const rest = Math.max(1, V - e.v)
      gameSwing[e.key] = e.v > 0 ? pOf(dA + Z80 * sg, rest) - pOf(dA - Z80 * sg, rest) : 0
      swingByGame[e.key] = (swingByGame[e.key] ?? 0) + gameSwing[e.key]
    }
    for (const [me, them, mineK, theirsK] of [
      [A, B, 'a', 'b'],
      [B, A, 'b', 'a'],
    ] as const) {
      managers[me.side.rosterId] = {
        rosterId: me.side.rosterId,
        opponent: them.side.rosterId,
        win: me === A ? pA : 1 - pA,
        stakes: input.stakes?.[me.side.rosterId] ?? null,
        games: Object.values(per)
          .map((e) => ({ key: e.key, swing: gameSwing[e.key], mine: e[mineK], theirs: e[theirsK] }))
          .sort((x, y) => y.swing - x.swing),
      }
    }
    matchups.push({ a: A.side, b: B.side, pA, keyGame: managers[A.side.rosterId].games[0]?.key ?? null })
  }

  const outGames: SlateGame[] = games
    .map((g) => {
      const key = gameKey(g)
      const ps = Object.values(byId)
        .filter((p) => (p.team === g.home || p.team === g.away) && (p.proj > 0 || p.actual != null))
        .sort((x, y) => y.swing - x.swing || Math.abs(y.realized ?? 0) - Math.abs(x.realized ?? 0) || y.proj - x.proj)
      return {
        key,
        week: g.week,
        date: g.date ?? null,
        status: g.status ?? 'pre_game',
        final: isFinal(g),
        live: !isFinal(g) && (isLive(g) || ps.some((p) => p.live != null)),
        home: g.home,
        away: g.away,
        totals: { home: input.totals[g.home] ?? null, away: input.totals[g.away] ?? null },
        players: ps,
        swing: swingByGame[key] ?? 0,
      }
    })
    .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '') || Number(x.final) - Number(y.final) || y.swing - x.swing)

  const teamState: Slate['teamState'] = {}
  for (const g of outGames) teamState[g.home] = teamState[g.away] = g.final ? 'final' : g.live ? 'live' : 'pre'
  return { week: input.week, games: outGames, matchups, managers, byId, teamState }
}
