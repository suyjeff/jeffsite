// What a raw weekly projection leaves out, and the adjustments that put it back.
//
// Sleeper's weekly projections (Rotowire) already price a lot: the opponent
// each week, byes, and — for injuries their analysts have modelled — a return
// date and the backup's bigger role until then. Measured on 2026 data, a
// starter zeroed in some weeks and back in others hands his backup the work in
// exactly those weeks. Re-pricing any of that here would count it twice.
//
// What they leave out is the subject of this file:
//
//   1. Injury risk in weeks a player is projected healthy. A projection is
//      "if he plays" (every row carries gp: 1). Skill players actually suit up
//      for about 86% of their team's games, and the ones who missed games
//      before keep missing them: one season's availability correlates 0.42
//      with the next across 146 fantasy-relevant players in 2024–25.
//   2. A designation that disagrees with the projection. Ja'Marr Chase was
//      listed Out on Sleeper going into week 5 of 2026 and still projected for
//      17.4. One of the two is wrong, and the projection alone cannot say which.
//   3. Where an absent player's production goes. When a starter misses time
//      his touches do not vanish; they go to the next man up. That is what makes
//      a handcuff worth rostering and a backup a buy-low before the news breaks.
//
// The adjusted horizon is still points per player per week, so everything
// downstream — lineups, replacement level, trade search — runs unchanged on it.

import type { Horizon } from './trades'
import type { PlayerMap, StatLine } from './types'

const round2 = (x: number) => Math.round(x * 100) / 100
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

// ---------- Schedule ----------

export type ScheduleGame = { week: number; home: string; away: string; status?: string | null; date?: string | null }

export type Schedule = {
  /** team -> week -> opponent. A missing week is a bye. */
  opp: Record<string, Record<number, string>>
  /** team -> bye weeks within the season. */
  byes: Record<string, number[]>
  /** team -> week -> true when at home. */
  home?: Record<string, Record<number, boolean>>
  weeks: number[]
}

export const buildSchedule = (games: ScheduleGame[]): Schedule => {
  const opp: Record<string, Record<number, string>> = {}
  const home: Record<string, Record<number, boolean>> = {}
  const weekSet = new Set<number>()
  for (const g of games) {
    if (!g?.home || !g?.away || typeof g.week !== 'number') continue
    ;(opp[g.home] ??= {})[g.week] = g.away
    ;(opp[g.away] ??= {})[g.week] = g.home
    ;(home[g.home] ??= {})[g.week] = true
    ;(home[g.away] ??= {})[g.week] = false
    weekSet.add(g.week)
  }
  const weeks = [...weekSet].sort((a, b) => a - b)
  const byes: Record<string, number[]> = {}
  for (const team of Object.keys(opp)) byes[team] = weeks.filter((w) => !opp[team][w])
  return { opp, byes, home, weeks }
}

// ---------- Availability from injury history ----------

/** Share of team games a fantasy-relevant skill player suits up for, 2024–25. */
export const BASE_AVAILABILITY = 0.86
/**
 * Prior strength in games. A season's availability predicts the next with
 * r = 0.42, so 17 games of history earn 42% weight: 17 x (1 - 0.42) / 0.42 = 23.
 */
export const AVAILABILITY_PRIOR_GAMES = 23

export type SeasonGames = {
  season: number
  /** Games played per player. */
  gp: Record<string, number>
  /** Games each team played that season, for the denominator. */
  teamGames: number
}

export type Availability = {
  /** Long-run probability of suiting up for a given team game. */
  rate: number
  /** Games he was on a roster for, in the seasons counted. */
  games: number
  played: number
}

/**
 * Shrunk games-played rate. A whole season at zero counts when the player was
 * in the league that season — that is exactly the torn-ACL year that should
 * follow him — which is why years of experience decide whether a season is in
 * the denominator.
 */
export const availabilityRates = (
  players: PlayerMap,
  seasons: SeasonGames[],
  currentSeason: number,
  current?: { gp: Record<string, number>; teamGames: Record<string, number> },
): Record<string, Availability> => {
  const out: Record<string, Availability> = {}
  for (const id of Object.keys(players)) {
    const p = players[id]
    if (!SKILL_POSITIONS.includes(p.pos as (typeof SKILL_POSITIONS)[number])) continue
    let games = 0
    let played = 0
    for (const s of seasons) {
      const yearsAgo = currentSeason - s.season
      const gp = s.gp[id] ?? 0
      const inLeague = gp > 0 || (p.exp != null && p.exp >= yearsAgo)
      if (!inLeague) continue
      games += s.teamGames
      played += Math.min(gp, s.teamGames)
    }
    if (current && p.team) {
      const teamGames = current.teamGames[p.team] ?? 0
      if (teamGames > 0) {
        games += teamGames
        played += Math.min(current.gp[id] ?? 0, teamGames)
      }
    }
    const k = AVAILABILITY_PRIOR_GAMES
    out[id] = { rate: round2((played + k * BASE_AVAILABILITY) / (games + k)), games, played }
  }
  return out
}

/**
 * How likely a player who is healthy today is to play `weeksAhead` games from
 * now. Most missed games follow an injury already on the report, so the next
 * game is close to certain and the risk climbs toward the long-run rate.
 */
export const HEALTHY_DECAY = 0.75
export const playProbability = (rate: number, weeksAhead: number, decay = HEALTHY_DECAY) =>
  rate + (1 - rate) * Math.pow(decay, Math.max(1, weeksAhead))

/**
 * Chance of playing the next game when Sleeper's designation and the
 * projection disagree — the projection has him playing, the report does not.
 * Questionable players suit up about three times in four. An Out or IR tag
 * that the projection ignores is genuinely ambiguous: on a weekday the tag
 * usually describes the last game, while the projection describes the next.
 */
export const STATUS_PLAY: Record<string, number> = {
  Questionable: 0.75,
  Doubtful: 0.25,
  Out: 0.5,
  IR: 0.3,
  PUP: 0.3,
  Sus: 0.3,
}

/** Designations that rule a player out of inheriting anyone else's work this week. */
const UNAVAILABLE = new Set(['Out', 'IR', 'PUP', 'Sus', 'Doubtful', 'NA', 'DNR'])

/**
 * Share of an absent player's projected points that his teammates at the
 * position absorb. Measured on 2026 weekly projections wherever Sleeper zeroes
 * a player for some weeks and has him back for others: QB 0.84 (4 cases, all
 * to the backup), RB 0.89 (5, spread across the committee), WR 0.64 (4),
 * TE 0.16 (2). Tight end is the thinnest sample, and its targets largely go to
 * receivers instead, so it is set low rather than to zero.
 */
export const TRANSFER: Record<string, number> = { QB: 0.85, RB: 0.85, WR: 0.6, TE: 0.3 }
/** Of what moves, the share the next man up takes; the rest spreads by role. */
export const NEXT_MAN_SHARE = 0.6

// ---------- Usage ----------

export type Usage = {
  /** Offensive snap share, season to date. */
  snaps: number
  /** Offensive snap share over the last two games played. */
  recentSnaps: number
  /** Carries plus targets per game, season to date and recently. */
  opps: number
  recentOpps: number
  /** Carries plus targets in his last game, and per game in the games before it. */
  lastOpps: number
  priorOpps: number
  /** Snap share in his last game. */
  lastSnaps: number
  /** The week of his last game. */
  lastWeek: number
  games: number
}

/**
 * How much of a one-game swing in carries plus targets shows up again the
 * next game, measured on 2024–25 (RBs 0.34, WRs and TEs 0.29). Sleeper's
 * projection moves by about the same (0.35 and 0.24), so this explains a role
 * change rather than adjusting for it.
 */
export const ROLE_CARRYOVER = { RB: 0.34, WR: 0.29, TE: 0.29 } as Record<string, number>
/** A swing worth a note: at least this many carries plus targets, and a third of his usual. */
export const ROLE_SWING = 6

/** Snap share and opportunities from weekly stat lines, oldest week first. */
export const usageFromStats = (weeks: { week: number; stats: Record<string, StatLine> }[], players: PlayerMap): Record<string, Usage> => {
  const perPlayer: Record<string, { snap: number; opps: number; week: number }[]> = {}
  for (const { week, stats } of [...weeks].sort((a, b) => a.week - b.week)) {
    for (const id of Object.keys(stats)) {
      const p = players[id]
      if (!p || !SKILL_POSITIONS.includes(p.pos as (typeof SKILL_POSITIONS)[number])) continue
      const s = stats[id]
      if (!s?.gp) continue
      const team = s.tm_off_snp ?? 0
      ;(perPlayer[id] ??= []).push({
        snap: team > 0 ? (s.off_snp ?? 0) / team : 0,
        opps: (s.rush_att ?? 0) + (s.rec_tgt ?? 0),
        week,
      })
    }
  }
  const out: Record<string, Usage> = {}
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  for (const id of Object.keys(perPlayer)) {
    const g = perPlayer[id]
    const recent = g.slice(-2)
    out[id] = {
      snaps: round2(avg(g.map((x) => x.snap))),
      recentSnaps: round2(avg(recent.map((x) => x.snap))),
      opps: round2(avg(g.map((x) => x.opps))),
      recentOpps: round2(avg(recent.map((x) => x.opps))),
      lastOpps: g[g.length - 1].opps,
      priorOpps: round2(avg(g.slice(0, -1).map((x) => x.opps))),
      lastSnaps: round2(g[g.length - 1].snap),
      lastWeek: g[g.length - 1].week,
      games: g.length,
    }
  }
  return out
}

// ---------- Putting it together ----------

export type ContextNote =
  | { kind: 'status'; status: string; week: number; play: number }
  | { kind: 'history'; played: number; games: number; rate: number }
  | { kind: 'bump'; from: string[]; pts: number }
  | { kind: 'temporary'; weeks: number[]; behind: string[]; during: number; after: number }
  | { kind: 'returns'; week: number | null }
  | { kind: 'usage'; prior: number; last: number; lastSnaps: number; carryover: number; injury: string | null }
  | { kind: 'playoffs'; weeks: number[]; vsNormal: number }

export type PlayerContext = {
  /** Mean probability of playing across the horizon's game weeks. */
  play: number
  availability: Availability | null
  /** Weighted mean points per week before and after adjustment. */
  raw: number
  adjusted: number
  /** Points per week removed for availability, and gained from teammates' absences. */
  lost: number
  gained: number
  /** Weeks the team does not play inside the horizon. */
  byes: number[]
  /** Opponent per horizon week; null is a bye. */
  schedule: { week: number; opp: string | null; playoff: boolean }[]
  notes: ContextNote[]
}

export type AdjustInput = {
  horizon: Horizon
  players: PlayerMap
  availability: Record<string, Availability>
  schedule: Schedule | null
  usage?: Record<string, Usage>
  /** First week of the fantasy playoffs, for the playoff schedule note. */
  playoffStart?: number
  decay?: number
}

type Group = { team: string; pos: string; ids: string[] }

/**
 * Re-price a horizon of raw projections as expected points.
 *
 * Per week: each player keeps his projection times his chance of playing; the
 * rest leaves him, and his teammates at the position pick up their measured
 * share of it — most of it to the next man up, the remainder spread by role.
 * Weeks the projection already zeroes him are left alone, because Sleeper has
 * already moved that work to whoever inherits it.
 */
export const adjustHorizon = (input: AdjustInput): { horizon: Horizon; context: Record<string, PlayerContext> } => {
  const { horizon, players, availability, schedule, usage } = input
  const decay = input.decay ?? HEALTHY_DECAY
  if (!horizon.length) return { horizon: [], context: {} }
  const latestUsageWeek = Math.max(0, ...Object.values(usage ?? {}).map((u) => u.lastWeek))

  // Normal level: a player's typical projection in weeks he is projected to play.
  const normal: Record<string, number> = {}
  const nonzero: Record<string, number[]> = {}
  for (const w of horizon) for (const id of Object.keys(w.pts)) if (w.pts[id] > 0) (nonzero[id] ??= []).push(w.pts[id])
  for (const id of Object.keys(nonzero)) normal[id] = median(nonzero[id])

  // Skill-position groups per NFL team, including backups with no projection —
  // they are exactly the players an injury promotes.
  const groups = new Map<string, Group>()
  for (const id of Object.keys(players)) {
    const p = players[id]
    if (!p.team || !SKILL_POSITIONS.includes(p.pos as (typeof SKILL_POSITIONS)[number])) continue
    const key = `${p.team}:${p.pos}`
    const g = groups.get(key)
    if (g) g.ids.push(id)
    else groups.set(key, { team: p.team, pos: p.pos, ids: [id] })
  }
  // Depth order within each group. Quarterbacks follow the depth chart because
  // a backup projects zero while the starter plays; everyone else follows the
  // size of their projected role, since receivers' depth charts are split by
  // alignment and say little about who inherits targets.
  for (const g of groups.values()) {
    g.ids.sort((a, b) => {
      if (g.pos === 'QB') {
        const da = players[a].depth ?? 99
        const db = players[b].depth ?? 99
        if (da !== db) return da - db
      }
      return (normal[b] ?? 0) - (normal[a] ?? 0) || (players[a].depth ?? 99) - (players[b].depth ?? 99)
    })
  }

  const firstWeek = horizon[0].week
  const adjusted: Horizon = horizon.map((w) => ({ week: w.week, weight: w.weight, pts: {} as Record<string, number> }))
  const lostBy: Record<string, number> = {}
  const gainedBy: Record<string, number> = {}
  const bumpSources: Record<string, Record<string, number>> = {}
  const playSum: Record<string, number> = {}
  const playWeight: Record<string, number> = {}
  const statusNote: Record<string, ContextNote> = {}

  horizon.forEach((w, wi) => {
    const out = adjusted[wi].pts
    const weight = w.weight ?? 1
    const weeksAhead = w.week - firstWeek + 1
    const playThisWeek: Record<string, number> = {}

    // 1. Each player's own chance of playing.
    for (const id of Object.keys(w.pts)) {
      const p = players[id]
      const raw = w.pts[id]
      if (raw <= 0 || !p || !SKILL_POSITIONS.includes(p.pos as (typeof SKILL_POSITIONS)[number])) {
        if (raw) out[id] = raw
        continue
      }
      let play: number
      const status = p.injury ?? ''
      if (wi === 0 && STATUS_PLAY[status] !== undefined && raw >= 0.8 * (normal[id] ?? raw)) {
        play = STATUS_PLAY[status]
        statusNote[id] = { kind: 'status', status, week: w.week, play }
      } else {
        play = playProbability(availability[id]?.rate ?? BASE_AVAILABILITY, weeksAhead, decay)
      }
      playThisWeek[id] = play
      out[id] = raw * play
      playSum[id] = (playSum[id] ?? 0) + play * weight
      playWeight[id] = (playWeight[id] ?? 0) + weight
      lostBy[id] = (lostBy[id] ?? 0) + raw * (1 - play) * weight
    }

    // 2. Their missing work goes to teammates at the position.
    for (const g of groups.values()) {
      if (schedule && !schedule.opp[g.team]?.[w.week]) continue
      const rate = TRANSFER[g.pos] ?? 0
      if (!rate) continue
      for (const absent of g.ids) {
        const raw = w.pts[absent] ?? 0
        if (raw <= 0) continue
        const missing = raw * (1 - (playThisWeek[absent] ?? 1)) * rate
        if (missing <= 0.005) continue
        // Anyone not ruled out can inherit, a questionable teammate included —
        // his own odds of playing scale what he takes. An injured teammate
        // counts again from the week he is projected back.
        const candidates = g.ids.filter(
          (id) => id !== absent && !(UNAVAILABLE.has(players[id].injury ?? '') && (w.pts[id] ?? 0) <= 0),
        )
        if (!candidates.length) continue
        const rank = g.ids.indexOf(absent)
        const next = candidates.find((id) => g.ids.indexOf(id) > rank) ?? candidates[0]
        const shares: Record<string, number> = {}
        if (g.pos === 'QB') {
          shares[next] = 1
        } else {
          shares[next] = NEXT_MAN_SHARE
          const basis = candidates.map((id) => Math.max(w.pts[id] ?? 0, 0))
          const total = basis.reduce((a, b) => a + b, 0)
          candidates.forEach((id, i) => {
            const part = total > 0 ? basis[i] / total : id === next ? 1 : 0
            shares[id] = (shares[id] ?? 0) + (1 - NEXT_MAN_SHARE) * part
          })
        }
        for (const id of Object.keys(shares)) {
          const own = playThisWeek[id] ?? playProbability(availability[id]?.rate ?? BASE_AVAILABILITY, weeksAhead, decay)
          const add = missing * shares[id] * own
          if (add <= 0) continue
          out[id] = (out[id] ?? 0) + add
          gainedBy[id] = (gainedBy[id] ?? 0) + add * weight
          const src = (bumpSources[id] ??= {})
          src[absent] = (src[absent] ?? 0) + add * weight
        }
      }
    }
    for (const id of Object.keys(out)) out[id] = round2(out[id])
  })

  // ---------- Notes for display ----------
  const totalWeight = horizon.reduce((a, w) => a + (w.weight ?? 1), 0) || 1
  const context: Record<string, PlayerContext> = {}
  const ids = new Set<string>([...Object.keys(normal), ...Object.keys(gainedBy)])
  for (const id of ids) {
    const p = players[id]
    if (!p || !SKILL_POSITIONS.includes(p.pos as (typeof SKILL_POSITIONS)[number])) continue
    const raw = horizon.reduce((a, w) => a + (w.pts[id] ?? 0) * (w.weight ?? 1), 0) / totalWeight
    const adj = adjusted.reduce((a, w) => a + (w.pts[id] ?? 0) * (w.weight ?? 1), 0) / totalWeight
    const sched = horizon.map((w) => ({
      week: w.week,
      opp: schedule ? (schedule.opp[p.team ?? '']?.[w.week] ?? null) : null,
      playoff: input.playoffStart != null && w.week >= input.playoffStart,
    }))
    const notes: ContextNote[] = []
    if (statusNote[id]) notes.push(statusNote[id])
    const av = availability[id] ?? null
    if (av && av.games >= 17 && av.played / av.games < 0.8) notes.push({ kind: 'history', played: av.played, games: av.games, rate: av.rate })
    if (gainedBy[id] && gainedBy[id] / totalWeight >= 0.5) {
      // Name only the absences doing the work, not every deep reserve whose
      // sliver of expected missed time rounds into the total.
      const src = bumpSources[id] ?? {}
      const from = Object.keys(src)
        .sort((a, b) => src[b] - src[a])
        .filter((o, i) => i === 0 || src[o] >= 0.25 * gainedBy[id])
        .slice(0, 3)
      notes.push({ kind: 'bump', from, pts: round2(gainedBy[id] / totalWeight) })
    }

    // Absences Sleeper already modelled: when he is due back, and who is
    // covering for him until then.
    const playWeeks = horizon.filter((w) => !schedule || schedule.opp[p.team ?? '']?.[w.week])
    const firstOn = playWeeks.find((w) => (w.pts[id] ?? 0) > 0)
    if (normal[id] && playWeeks.length && (playWeeks[0].pts[id] ?? 0) <= 0) {
      notes.push({ kind: 'returns', week: firstOn ? firstOn.week : null })
    }
    const g = groups.get(`${p.team}:${p.pos}`)
    if (g && normal[id]) {
      const ahead = g.ids.filter((o) => o !== id && (normal[o] ?? 0) > (normal[id] ?? 0))
      const outWeeks = playWeeks.filter((w) => ahead.some((o) => (w.pts[o] ?? 0) <= 0 && (normal[o] ?? 0) > 0))
      const inWeeks = playWeeks.filter((w) => !outWeeks.includes(w))
      if (outWeeks.length && inWeeks.length >= 2) {
        const during = outWeeks.reduce((a, w) => a + (w.pts[id] ?? 0), 0) / outWeeks.length
        const after = inWeeks.reduce((a, w) => a + (w.pts[id] ?? 0), 0) / inWeeks.length
        if (during >= 1.3 * after && during - after >= 2) {
          const behind = ahead.filter((o) => outWeeks.some((w) => (w.pts[o] ?? 0) <= 0))
          notes.push({ kind: 'temporary', weeks: outWeeks.map((w) => w.week), behind, during: round2(during), after: round2(after) })
        }
      }
    }
    const u = usage?.[id]
    // A one-game swing in work, not a two-game average: a benching shows up in a single box score.
    // Only from the latest week: a game weeks ago (he has missed time since) is not this week's news.
    if (u && u.games >= 3 && u.lastWeek === latestUsageWeek && Math.abs(u.lastOpps - u.priorOpps) >= Math.max(ROLE_SWING, u.priorOpps / 3)) {
      notes.push({ kind: 'usage', prior: u.priorOpps, last: u.lastOpps, lastSnaps: u.lastSnaps, carryover: ROLE_CARRYOVER[p.pos] ?? 0.3, injury: p.injury })
    }
    if (input.playoffStart != null && normal[id]) {
      const po = horizon.filter((w) => w.week >= input.playoffStart! && (w.pts[id] ?? 0) > 0)
      if (po.length) {
        const vs = po.reduce((a, w) => a + w.pts[id] / normal[id], 0) / po.length - 1
        if (Math.abs(vs) >= 0.06) notes.push({ kind: 'playoffs', weeks: po.map((w) => w.week), vsNormal: round2(vs) })
      }
    }
    context[id] = {
      play: round2(playWeight[id] ? playSum[id] / playWeight[id] : 1),
      availability: av,
      raw: round2(raw),
      adjusted: round2(adj),
      lost: round2((lostBy[id] ?? 0) / totalWeight),
      gained: round2((gainedBy[id] ?? 0) / totalWeight),
      byes: schedule ? horizon.filter((w) => !schedule.opp[p.team ?? '']?.[w.week]).map((w) => w.week) : [],
      schedule: sched,
      notes,
    }
  }
  return { horizon: adjusted, context }
}
