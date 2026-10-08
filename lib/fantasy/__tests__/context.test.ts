import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_PRIOR_GAMES,
  BASE_AVAILABILITY,
  NEXT_MAN_SHARE,
  STATUS_PLAY,
  TRANSFER,
  adjustHorizon,
  availabilityRates,
  buildSchedule,
  playProbability,
  usageFromStats,
  type Availability,
} from '../context'
import { horizonValues, makeHorizonEval, type Horizon } from '../trades'
import { startingSlots } from '../lineup'
import { fantasyPlayoffWeeks } from '../useLeagueData'
import type { PlayerMap, SleeperLeague } from '../types'

const P = (id: string, pos: string, team: string, extra: Partial<PlayerMap[string]> = {}): PlayerMap[string] => ({
  id,
  name: id,
  pos,
  fpos: [pos],
  team,
  status: null,
  injury: null,
  age: null,
  exp: 5,
  depth: null,
  ...extra,
})

/** Everyone fully available, so a test sees only the effect it is about. */
const healthy = (players: PlayerMap): Record<string, Availability> =>
  Object.fromEntries(Object.keys(players).map((id) => [id, { rate: 1, games: 34, played: 34 }]))

describe('buildSchedule', () => {
  const s = buildSchedule([
    { week: 1, home: 'KC', away: 'BAL' },
    { week: 2, home: 'BAL', away: 'CIN' },
    { week: 3, home: 'KC', away: 'CIN' },
  ])
  it('records the opponent from both sides', () => {
    expect(s.opp.KC[1]).toBe('BAL')
    expect(s.opp.BAL[1]).toBe('KC')
    expect(s.opp.CIN[2]).toBe('BAL')
  })
  it('treats a week with no game as a bye', () => {
    expect(s.byes.KC).toEqual([2])
    expect(s.byes.BAL).toEqual([3])
    expect(s.byes.CIN).toEqual([1])
  })
})

describe('availabilityRates', () => {
  const players: PlayerMap = {
    ironman: P('ironman', 'RB', 'KC', { exp: 4 }),
    fragile: P('fragile', 'RB', 'KC', { exp: 4 }),
    lostSeason: P('lostSeason', 'WR', 'KC', { exp: 4 }),
    rookie: P('rookie', 'WR', 'KC', { exp: 0 }),
    kicker: P('kicker', 'K', 'KC'),
  }
  const seasons = [
    { season: 2025, gp: { ironman: 17, fragile: 8 }, teamGames: 17 },
    { season: 2024, gp: { ironman: 17, fragile: 9, lostSeason: 17 }, teamGames: 17 },
  ]
  const rates = availabilityRates(players, seasons, 2026)
  const k = AVAILABILITY_PRIOR_GAMES

  it('shrinks games played toward the league rate', () => {
    expect(rates.ironman.rate).toBeCloseTo((34 + k * BASE_AVAILABILITY) / (34 + k), 2)
    expect(rates.fragile.rate).toBeCloseTo((17 + k * BASE_AVAILABILITY) / (34 + k), 2)
    expect(rates.ironman.rate).toBeGreaterThan(rates.fragile.rate)
  })
  it('counts a season missed entirely when he was in the league', () => {
    expect(rates.lostSeason.games).toBe(34)
    expect(rates.lostSeason.played).toBe(17)
  })
  it('gives a rookie the league rate rather than a missing season', () => {
    expect(rates.rookie.games).toBe(0)
    expect(rates.rookie.rate).toBeCloseTo(BASE_AVAILABILITY, 2)
  })
  it('adds this season against the games his team has actually played', () => {
    const withCurrent = availabilityRates(players, seasons, 2026, { gp: { fragile: 1 }, teamGames: { KC: 4 } })
    expect(withCurrent.fragile.games).toBe(38)
    expect(withCurrent.fragile.played).toBe(18)
  })
  it('skips positions the model does not cover', () => {
    expect(rates.kicker).toBeUndefined()
  })
})

describe('playProbability', () => {
  it('treats a healthy player as near certain for the next game', () => {
    expect(playProbability(0.8, 1)).toBeGreaterThan(0.94)
  })
  it('drifts toward his long-run rate further out', () => {
    expect(playProbability(0.8, 12)).toBeCloseTo(0.8, 1)
    expect(playProbability(0.8, 3)).toBeGreaterThan(playProbability(0.8, 8))
  })
})

describe('usageFromStats', () => {
  it('reads snap share and opportunities, recent against season', () => {
    const players: PlayerMap = { rb: P('rb', 'RB', 'KC') }
    const u = usageFromStats(
      [
        { week: 1, stats: { rb: { gp: 1, off_snp: 20, tm_off_snp: 80, rush_att: 5, rec_tgt: 1 } } },
        { week: 2, stats: { rb: { gp: 1, off_snp: 40, tm_off_snp: 80, rush_att: 10, rec_tgt: 2 } } },
        { week: 3, stats: { rb: { gp: 1, off_snp: 60, tm_off_snp: 80, rush_att: 15, rec_tgt: 3 } } },
      ],
      players,
    ).rb
    expect(u.snaps).toBeCloseTo(0.5)
    expect(u.recentSnaps).toBeCloseTo(0.625, 1)
    expect(u.recentOpps).toBeCloseTo(15)
    // The last game against the ones before it: 18 vs (6 + 12) / 2.
    expect(u.lastOpps).toBe(18)
    expect(u.priorOpps).toBeCloseTo(9)
    expect(u.lastSnaps).toBeCloseTo(0.75)
    expect(u.lastWeek).toBe(3)
    expect(u.games).toBe(3)
  })
})

describe('adjustHorizon', () => {
  const schedule = buildSchedule([
    { week: 5, home: 'KC', away: 'BAL' },
    { week: 6, home: 'BAL', away: 'KC' },
    { week: 7, home: 'KC', away: 'BAL' },
  ])

  it('discounts a designation the projection ignores, for the next game only', () => {
    const players: PlayerMap = {
      rb1: P('rb1', 'RB', 'KC', { injury: 'Questionable' }),
      rb2: P('rb2', 'RB', 'KC'),
    }
    const horizon: Horizon = [5, 6, 7].map((week) => ({ week, pts: { rb1: 15, rb2: 5 } }))
    const { horizon: adj, context } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    expect(adj[0].pts.rb1).toBeCloseTo(15 * STATUS_PLAY.Questionable)
    expect(adj[1].pts.rb1).toBeCloseTo(15)
    expect(context.rb1.notes.some((n) => n.kind === 'status')).toBe(true)
  })

  it('leaves a designation alone when the projection already priced it in', () => {
    const players: PlayerMap = { wr: P('wr', 'WR', 'KC', { injury: 'Questionable' }) }
    const horizon: Horizon = [
      { week: 5, pts: { wr: 6 } },
      { week: 6, pts: { wr: 14 } },
      { week: 7, pts: { wr: 14 } },
    ]
    const { horizon: adj } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    expect(adj[0].pts.wr).toBeCloseTo(6)
  })

  it('hands the missing work to the next man up at the measured rate', () => {
    const players: PlayerMap = {
      rb1: P('rb1', 'RB', 'KC', { injury: 'Out' }),
      rb2: P('rb2', 'RB', 'KC'),
      rb3: P('rb3', 'RB', 'KC'),
    }
    const horizon: Horizon = [5, 6, 7].map((week) => ({ week, pts: { rb1: 16, rb2: 6, rb3: 2 } }))
    const { horizon: adj } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    const moved = 16 * (1 - STATUS_PLAY.Out) * TRANSFER.RB
    // Everything that moves lands on the two backups, most of it on the next one.
    expect(adj[0].pts.rb2 - 6 + adj[0].pts.rb3 - 2).toBeCloseTo(moved, 1)
    expect(adj[0].pts.rb2 - 6).toBeGreaterThan(moved * NEXT_MAN_SHARE)
    expect(adj[0].pts.rb2 - 6).toBeGreaterThan(adj[0].pts.rb3 - 2)
  })

  it('promotes the third back when the second is the one hurt', () => {
    const players: PlayerMap = {
      rb1: P('rb1', 'RB', 'KC'),
      rb2: P('rb2', 'RB', 'KC', { injury: 'Doubtful' }),
      rb3: P('rb3', 'RB', 'KC'),
    }
    const horizon: Horizon = [5, 6, 7].map((week) => ({ week, pts: { rb1: 16, rb2: 8, rb3: 2 } }))
    const { horizon: adj, context } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    const gainRb3 = adj[0].pts.rb3 - 2
    const gainRb1 = adj[0].pts.rb1 - 16
    expect(gainRb3).toBeGreaterThan(gainRb1)
    expect(context.rb3.gained).toBeGreaterThan(0)
  })

  it('sends a quarterback\'s missing work to the depth-chart backup, even one projected at zero', () => {
    const players: PlayerMap = {
      qb1: P('qb1', 'QB', 'KC', { depth: 1, injury: 'Questionable' }),
      qb2: P('qb2', 'QB', 'KC', { depth: 2 }),
      qb3: P('qb3', 'QB', 'KC', { depth: 3 }),
    }
    const horizon: Horizon = [5, 6, 7].map((week) => ({ week, pts: { qb1: 20 } }))
    const { horizon: adj } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    expect(adj[0].pts.qb2).toBeCloseTo(20 * (1 - STATUS_PLAY.Questionable) * TRANSFER.QB, 1)
    expect(adj[0].pts.qb3 ?? 0).toBe(0)
  })

  it('does not move work out of weeks Sleeper already zeroed', () => {
    // Sleeper has rb1 out in week 5 and has already given rb2 the job.
    const players: PlayerMap = { rb1: P('rb1', 'RB', 'KC'), rb2: P('rb2', 'RB', 'KC') }
    const horizon: Horizon = [
      { week: 5, pts: { rb2: 12 } },
      { week: 6, pts: { rb1: 15, rb2: 4 } },
      { week: 7, pts: { rb1: 15, rb2: 4 } },
    ]
    const { horizon: adj, context } = adjustHorizon({ horizon, players, availability: healthy(players), schedule })
    expect(adj[0].pts.rb2).toBeCloseTo(12)
    expect(context.rb1.notes).toContainEqual({ kind: 'returns', week: 6 })
    expect(context.rb2.notes.some((n) => n.kind === 'temporary')).toBe(true)
  })

  it('charges injury history to the player and credits his handcuff', () => {
    const players: PlayerMap = { rb1: P('rb1', 'RB', 'KC'), rb2: P('rb2', 'RB', 'KC') }
    const availability = { rb1: { rate: 0.6, games: 34, played: 20 }, rb2: { rate: 1, games: 34, played: 34 } }
    const horizon: Horizon = [5, 6, 7].map((week) => ({ week, pts: { rb1: 15, rb2: 3 } }))
    const { horizon: adj, context } = adjustHorizon({ horizon, players, availability, schedule })
    expect(adj[2].pts.rb1).toBeLessThan(15)
    expect(adj[2].pts.rb2).toBeGreaterThan(3)
    // Later weeks carry more risk than the next game does.
    expect(adj[2].pts.rb1).toBeLessThan(adj[0].pts.rb1)
    expect(context.rb1.notes.some((n) => n.kind === 'history')).toBe(true)
  })

  it('moves nothing in a bye week', () => {
    const bye = buildSchedule([{ week: 6, home: 'BAL', away: 'CIN' }])
    const players: PlayerMap = { rb1: P('rb1', 'RB', 'KC', { injury: 'Questionable' }), rb2: P('rb2', 'RB', 'KC') }
    const horizon: Horizon = [{ week: 6, pts: { rb1: 10, rb2: 4 } }]
    const { horizon: adj } = adjustHorizon({ horizon, players, availability: healthy(players), schedule: bye })
    expect(adj[0].pts.rb2).toBeCloseTo(4)
  })

  it('leaves kickers and defenses as projected', () => {
    const players: PlayerMap = { k: P('k', 'K', 'KC', { injury: 'Questionable' }) }
    const horizon: Horizon = [{ week: 5, pts: { k: 8 } }]
    expect(adjustHorizon({ horizon, players, availability: {}, schedule }).horizon[0].pts.k).toBe(8)
  })

  it('keeps week weights and flags a soft or hard playoff schedule', () => {
    const players: PlayerMap = { wr: P('wr', 'WR', 'KC') }
    const weeks = [5, 6, 7, 8, 9, 15, 16, 17]
    const sched = buildSchedule(weeks.map((week) => ({ week, home: 'KC', away: 'BAL' })))
    const horizon: Horizon = weeks.map((week) =>
      week >= 15 ? { week, pts: { wr: 13 }, weight: 2 } : { week, pts: { wr: 10 } },
    )
    const { horizon: adj, context } = adjustHorizon({ horizon, players, availability: healthy(players), schedule: sched, playoffStart: 15 })
    expect(adj.map((w) => w.weight)).toEqual([undefined, undefined, undefined, undefined, undefined, 2, 2, 2])
    // Typical week is 10; the playoff matchups project 30% better.
    expect(context.wr.notes.find((n) => n.kind === 'playoffs')).toMatchObject({ kind: 'playoffs', weeks: [15, 16, 17], vsNormal: 0.3 })
  })
})

describe('weighted horizons', () => {
  const players: PlayerMap = { qb: P('qb', 'QB', 'KC') }
  const horizon: Horizon = [
    { week: 14, pts: { qb: 10 } },
    { week: 15, pts: { qb: 20 }, weight: 3 },
  ]
  it('weights the per-week mean', () => {
    expect(horizonValues(horizon).perWeek.qb).toBeCloseTo((10 + 60) / 4)
  })
  it('weights the lineup average', () => {
    const ev = makeHorizonEval(startingSlots(['QB']), players, horizon)
    expect(ev.total(['qb'])).toBeCloseTo(17.5)
  })
})

describe('fantasyPlayoffWeeks', () => {
  const league = (settings: Record<string, number>) => ({ settings } as unknown as SleeperLeague)
  it('counts one week per round', () => {
    expect(fantasyPlayoffWeeks(league({ playoff_week_start: 15, playoff_teams: 6 }))).toEqual([15, 16, 17])
    expect(fantasyPlayoffWeeks(league({ playoff_week_start: 15, playoff_teams: 4 }))).toEqual([15, 16])
  })
  it('adds a week for a two-week final, and doubles for two-week rounds', () => {
    expect(fantasyPlayoffWeeks(league({ playoff_week_start: 15, playoff_teams: 4, playoff_round_type: 1 }))).toEqual([15, 16, 17])
    expect(fantasyPlayoffWeeks(league({ playoff_week_start: 14, playoff_teams: 4, playoff_round_type: 2 }))).toEqual([14, 15, 16, 17])
  })
  it('returns nothing when the league has no playoffs', () => {
    expect(fantasyPlayoffWeeks(league({}))).toEqual([])
  })
})
