// Weekly accuracy check against Sleeper's live API (npm run test:accuracy; .github/workflows/accuracy.yml). Not part of
// the default suite: it needs the network, and its answers move with the season. For each league in leagues.json:
//
//   actuals      our scoring of Sleeper's stat lines equals players_points for every rostered player of the latest week
//                the league has points for (regular season or playoffs), and each team's starters add up to its
//                matchup points, within 0.01
//   projections  no projection line, that week or the coming one, carries a key the league scores in a form we leave
//                unscored (lib/fantasy/scoring unscoredProjectionKeys)
//
// Out of season (no coming week, or no week with points) the checks that need one skip with the reason, so the weekly
// job stays green from the last game to the first and fails only on real drift.
//   half-PPR     Sleeper's default half-PPR settings reproduce its own pts_half_ppr on every offense, kicker and defense
//                projection, to the rounding of the published line
//   sanity       every starter Sleeper projects for a point or more scores above zero in league scoring
import { beforeAll, describe, expect, it } from 'vitest'
import { roundingTolerance, scoreProjectionLine, scoreStatLine, SLEEPER_HALF_PPR, unscoredProjectionKeys } from '../../lib/fantasy/scoring'
import config from './leagues.json'

type Line = Record<string, number>
type Matchup = { roster_id: number; matchup_id: number | null; points: number; starters: string[] | null; players_points: Record<string, number> | null }

const API = 'https://api.sleeper.app'
const get = async <T>(path: string): Promise<T> => {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(API + path, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
      return (await res.json()) as T
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw last
}

// Per league: the latest week its matchups have points for (actuals), and the coming week's lineups (sanity).
type LeagueCheck = {
  name: string
  season: string
  scoring: Record<string, number>
  scored: { week: number; matchups: Matchup[]; stats: Record<string, Line> } | null
  upcoming: Matchup[]
}
let upcomingWeek: number | null = null
// Projection lines by "season:week": each league's scored week, and the coming week when there is one.
const projections: Record<string, Record<string, Line>> = {}
const leagues: Record<string, LeagueCheck> = {}
const statsCache: Record<string, Record<string, Line>> = {}

const hasPoints = (ms: Matchup[] | null | undefined) => !!ms && ms.some((m) => (m.points ?? 0) > 0)

beforeAll(async () => {
  const state = await get<{ season: string; week: number; season_type: string }>('/v1/state/nfl')
  // A week to project only while one is coming: none in the offseason or after the last week.
  upcomingWeek = (state.season_type === 'regular' || state.season_type === 'post') && state.week > 0 ? state.week : null
  if (upcomingWeek != null) {
    const p = await get<Record<string, Line>>(`/v1/projections/nfl/regular/${state.season}/${upcomingWeek}`)
    if (Object.keys(p ?? {}).length) projections[`${state.season}:${upcomingWeek}`] = p
    else upcomingWeek = null
  }
  for (const l of config.leagues) {
    const league = await get<{ name: string; season: string; scoring_settings: Record<string, number>; settings?: { last_scored_leg?: number; playoff_week_start?: number } }>(`/v1/league/${l.id}`)
    // The latest week, regular season or playoffs, whose matchups carry points: Sleeper's last scored week, else the
    // newest week with any.
    const last = Math.min(18, league.settings?.last_scored_leg || 18)
    let scored: LeagueCheck['scored'] = null
    for (let w = last; w >= 1 && !scored; w--) {
      const ms = await get<Matchup[]>(`/v1/league/${l.id}/matchups/${w}`)
      if (!hasPoints(ms)) continue
      const key = `${league.season}:${w}`
      statsCache[key] ??= await get<Record<string, Line>>(`/v1/stats/nfl/regular/${league.season}/${w}`)
      projections[key] ??= await get<Record<string, Line>>(`/v1/projections/nfl/regular/${league.season}/${w}`)
      if (Object.keys(statsCache[key] ?? {}).length) scored = { week: w, matchups: ms, stats: statsCache[key] }
    }
    const upcoming = upcomingWeek != null && league.season === state.season ? await get<Matchup[]>(`/v1/league/${l.id}/matchups/${upcomingWeek}`) : []
    leagues[l.id] = { name: league.name, season: league.season, scoring: league.scoring_settings, scored, upcoming: upcoming ?? [] }
  }
}, 180_000)

const offenseKickDef = (line: Line) => line.pts_half_ppr != null && !Object.keys(line).some((k) => k.startsWith('idp_'))

describe.each(config.leagues)('$name', ({ id }) => {
  it('scores every rostered player of the latest scored week as Sleeper does, and every team total', (ctx) => {
    const { scoring, scored } = leagues[id]
    if (!scored) return ctx.skip('no week of this league has points yet')
    const players: string[] = []
    const teams: string[] = []
    for (const m of scored.matchups) {
      for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
        const ours = scoreStatLine(scored.stats[pid], scoring)
        if (Math.abs(ours - pts) > 0.01) players.push(`week ${scored.week} ${pid}: ours ${ours}, Sleeper ${pts}`)
      }
      // A team on a bye week of the playoffs has no matchup to total.
      if (m.matchup_id == null && !(m.points > 0)) continue
      const starters = (m.starters ?? []).filter((x) => x && x !== '0')
      const ours = starters.reduce((a, pid) => a + scoreStatLine(scored.stats[pid], scoring), 0)
      if (Math.abs(ours - m.points) > 0.01) teams.push(`week ${scored.week} roster ${m.roster_id}: ours ${ours.toFixed(2)}, Sleeper ${m.points}`)
    }
    expect(players).toEqual([])
    expect(teams).toEqual([])
  })

  it('leaves no league-scored key unscored on any projection line', (ctx) => {
    const { scoring } = leagues[id]
    if (!Object.keys(projections).length) return ctx.skip('no projection week to check')
    const gaps: string[] = []
    for (const [w, byId] of Object.entries(projections))
      for (const [pid, line] of Object.entries(byId)) {
        const u = unscoredProjectionKeys(line, scoring)
        if (u.length) gaps.push(`${w} ${pid}: ${u.join(', ')}`)
      }
    expect(gaps).toEqual([])
  })

  it('gives every starter Sleeper projects for a point or more a score above zero', (ctx) => {
    const { scoring, upcoming, season } = leagues[id]
    const byId = upcomingWeek != null ? projections[`${season}:${upcomingWeek}`] : undefined
    if (!byId || !upcoming.some((m) => m.starters?.length)) return ctx.skip('no coming week with lineups set in this league')
    const zero: string[] = []
    for (const m of upcoming)
      for (const pid of m.starters ?? []) {
        const line = byId[pid]
        if (!line || !((line.pts_half_ppr ?? 0) >= 1)) continue
        if (!(scoreProjectionLine(line, scoring) > 0)) zero.push(`week ${upcomingWeek} ${pid}: Sleeper ${line.pts_half_ppr}, ours ${scoreProjectionLine(line, scoring)}`)
      }
    expect(zero).toEqual([])
  })
})

describe('Sleeper default half-PPR', () => {
  it('reproduces pts_half_ppr on every offense, kicker and defense projection, to the line’s rounding', (ctx) => {
    const off: string[] = []
    let n = 0
    for (const [w, byId] of Object.entries(projections))
      for (const [pid, line] of Object.entries(byId)) {
        if (!offenseKickDef(line)) continue
        n++
        const ours = scoreStatLine(line, SLEEPER_HALF_PPR)
        if (Math.abs(ours - line.pts_half_ppr) > roundingTolerance(line, SLEEPER_HALF_PPR)) off.push(`${w} ${pid}: ours ${ours}, Sleeper ${line.pts_half_ppr}`)
      }
    if (!n) return ctx.skip('no projection lines to check')
    expect(off).toEqual([])
  })
})
