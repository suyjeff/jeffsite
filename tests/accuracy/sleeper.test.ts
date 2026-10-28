// Weekly accuracy check against Sleeper's live API (npm run test:accuracy; .github/workflows/accuracy.yml). Not part of
// the default suite: it needs the network, and its answers move with the season. For each league in leagues.json:
//
//   actuals      our scoring of Sleeper's stat lines equals players_points for every rostered player of the latest
//                completed week, and each team's starters add up to its matchup points, within 0.01
//   projections  no projection line, that week or this one, carries a key the league scores in a form we leave
//                unscored (lib/fantasy/scoring unscoredProjectionKeys)
//   half-PPR     Sleeper's default half-PPR settings reproduce its own pts_half_ppr on every offense, kicker and defense
//                projection, to the rounding of the published line
//   sanity       every starter Sleeper projects for a point or more scores above zero in league scoring
import { beforeAll, describe, expect, it } from 'vitest'
import { roundingTolerance, scoreProjectionLine, scoreStatLine, SLEEPER_HALF_PPR, unscoredProjectionKeys } from '../../lib/fantasy/scoring'
import config from './leagues.json'

type Line = Record<string, number>
type Matchup = { roster_id: number; points: number; starters: string[] | null; players_points: Record<string, number> | null }

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

let season = ''
let seasonType = ''
let completed = 0
let current = 0
const stats: Record<number, Record<string, Line>> = {}
const projections: Record<number, Record<string, Line>> = {}
const leagues: Record<string, { name: string; scoring: Record<string, number>; matchups: Record<number, Matchup[]> }> = {}

beforeAll(async () => {
  const state = await get<{ season: string; week: number; season_type: string }>('/v1/state/nfl')
  season = state.season
  seasonType = state.season_type
  current = state.week
  // The latest week whose every game Sleeper calls complete.
  const games = await get<{ week: number; status: string }[]>(`/schedule/nfl/regular/${season}`)
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b)
  completed = Math.max(0, ...weeks.filter((w) => games.filter((g) => g.week === w && g.status !== 'canceled').every((g) => g.status === 'complete')))
  for (const w of new Set([completed, current].filter((x) => x > 0))) {
    projections[w] = await get(`/v1/projections/nfl/regular/${season}/${w}`)
  }
  if (completed) stats[completed] = await get(`/v1/stats/nfl/regular/${season}/${completed}`)
  for (const l of config.leagues) {
    const league = await get<{ name: string; scoring_settings: Record<string, number> }>(`/v1/league/${l.id}`)
    const matchups: Record<number, Matchup[]> = {}
    for (const w of new Set([completed, current].filter((x) => x > 0))) matchups[w] = await get(`/v1/league/${l.id}/matchups/${w}`)
    leagues[l.id] = { name: league.name, scoring: league.scoring_settings, matchups }
  }
}, 120_000)

describe('the week checked', () => {
  it('has a completed week once the regular season is under way, with lines to check', () => {
    if (seasonType === 'regular' && current > 1) {
      expect(completed).toBeGreaterThan(0)
      expect(Object.keys(stats[completed] ?? {}).length).toBeGreaterThan(100)
    }
    expect(Object.keys(projections).length).toBeGreaterThan(0)
  })
})

const offenseKickDef = (line: Line) => line.pts_half_ppr != null && !Object.keys(line).some((k) => k.startsWith('idp_'))

describe.each(config.leagues)('$name', ({ id }) => {
  it('scores every rostered player of the latest completed week as Sleeper does, and every team total', () => {
    if (!completed) return
    const { scoring, matchups } = leagues[id]
    const lines = stats[completed]
    const players: string[] = []
    const teams: string[] = []
    for (const m of matchups[completed] ?? []) {
      for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
        const ours = scoreStatLine(lines[pid], scoring)
        if (Math.abs(ours - pts) > 0.01) players.push(`week ${completed} ${pid}: ours ${ours}, Sleeper ${pts}`)
      }
      const starters = (m.starters ?? []).filter((x) => x && x !== '0')
      const ours = starters.reduce((a, pid) => a + scoreStatLine(lines[pid], scoring), 0)
      if (Math.abs(ours - m.points) > 0.01) teams.push(`week ${completed} roster ${m.roster_id}: ours ${ours.toFixed(2)}, Sleeper ${m.points}`)
    }
    expect(players).toEqual([])
    expect(teams).toEqual([])
    expect((matchups[completed] ?? []).length).toBeGreaterThan(0)
  })

  it('leaves no league-scored key unscored on any projection line', () => {
    const { scoring } = leagues[id]
    const gaps: string[] = []
    for (const [w, byId] of Object.entries(projections))
      for (const [pid, line] of Object.entries(byId)) {
        const u = unscoredProjectionKeys(line, scoring)
        if (u.length) gaps.push(`week ${w} ${pid}: ${u.join(', ')}`)
      }
    expect(gaps).toEqual([])
  })

  it('gives every starter Sleeper projects for a point or more a score above zero', () => {
    const { scoring, matchups } = leagues[id]
    const zero: string[] = []
    const byId = projections[current] ?? {}
    for (const m of matchups[current] ?? [])
      for (const pid of m.starters ?? []) {
        const line = byId[pid]
        if (!line || !((line.pts_half_ppr ?? 0) >= 1)) continue
        if (!(scoreProjectionLine(line, scoring) > 0)) zero.push(`week ${current} ${pid}: Sleeper ${line.pts_half_ppr}, ours ${scoreProjectionLine(line, scoring)}`)
      }
    expect(zero).toEqual([])
  })
})

describe('Sleeper default half-PPR', () => {
  it('reproduces pts_half_ppr on every offense, kicker and defense projection, to the line’s rounding', () => {
    const off: string[] = []
    let n = 0
    for (const [w, byId] of Object.entries(projections))
      for (const [pid, line] of Object.entries(byId)) {
        if (!offenseKickDef(line)) continue
        n++
        const ours = scoreStatLine(line, SLEEPER_HALF_PPR)
        if (Math.abs(ours - line.pts_half_ppr) > roundingTolerance(line, SLEEPER_HALF_PPR)) off.push(`week ${w} ${pid}: ours ${ours}, Sleeper ${line.pts_half_ppr}`)
      }
    expect(n).toBeGreaterThan(0)
    expect(off).toEqual([])
  })
})
