import { describe, expect, it } from 'vitest'
import { buildRecap, estimateWeek, lineupCalls, recapOdds, revealGate, revealStale, revealWeek, sortPasses, weeksBefore } from '../recap'
import type { Forecast } from '../forecast'
import { DEFAULT_POWER_WEIGHTS } from '../power'
import { startingSlots } from '../lineup'
import type { PlayerMap, SleeperMatchup } from '../types'

const P = (id: string, pos: string) => ({ id, name: id, pos, fpos: [pos], team: 'DET', status: null, injury: null, age: null, exp: null })
// Four teams, each a QB and a WR starting with one bench WR.
const players = Object.fromEntries(
  [1, 2, 3, 4].flatMap((t) => [P(`q${t}`, 'QB'), P(`w${t}`, 'WR'), P(`b${t}`, 'WR')]).map((p) => [p.id, p]),
) as unknown as PlayerMap
const slots = startingSlots(['QB', 'WR', 'BN'])
const m = (roster_id: number, matchup_id: number, q: number, w: number, b: number): SleeperMatchup => ({
  roster_id,
  matchup_id,
  points: q + w,
  players: [`q${roster_id}`, `w${roster_id}`, `b${roster_id}`],
  starters: [`q${roster_id}`, `w${roster_id}`],
  players_points: { [`q${roster_id}`]: q, [`w${roster_id}`]: w, [`b${roster_id}`]: b },
})
// Week 1: team 1 strong, team 4 weak. Week 2: team 4 upsets team 1 with a week-high.
const matchupsByWeek: Record<number, SleeperMatchup[]> = {
  1: [m(1, 1, 30, 30, 5), m(2, 1, 20, 20, 5), m(3, 2, 22, 20, 5), m(4, 2, 10, 10, 5)],
  2: [m(1, 1, 20, 15, 30), m(4, 1, 40, 35, 2), m(2, 2, 20, 22, 5), m(3, 2, 21, 20, 5)],
}
const base = {
  week: 2,
  priorWeeks: [1],
  matchupsByWeek,
  slots,
  players,
  rosterIds: [1, 2, 3, 4],
  strength: {},
  weights: DEFAULT_POWER_WEIGHTS,
  sigma: 20,
  proj: { q1: 25, w1: 20, b1: 8, q4: 12, w4: 10, b4: 4, q2: 18, w2: 15, b2: 5, q3: 18, w3: 16, b3: 5 },
}

describe('recap', () => {
  it('ranks before and after the week and explains the moves', () => {
    const r = buildRecap(base)
    expect(r.teams.map((t) => t.rankAfter)).toEqual([1, 2, 3, 4])
    const t4 = r.byId[4]
    expect(t4.rankBefore).toBe(4)
    expect(t4.move).toBeGreaterThan(0)
    expect(t4.result).toBe('W')
    // Projected 22 to 45: an upset, and the week's high.
    const upset = r.awards.upset!
    expect(upset.winner).toBe(4)
    expect(upset.pWinner!).toBeLessThan(0.5)
    expect(t4.reasons[0].parts[0]).toBe('Upset ')
    expect(r.awards.high).toEqual({ rosterId: 4, pts: 75 })
  })

  it('reads lineups: accuracy, bench points, and the call that decided a game', () => {
    const r = buildRecap(base)
    const t1 = r.byId[1]
    // Best lineup: QB 20 + bench WR 30 = 50 against 35 played.
    expect(t1.optimal).toBe(50)
    expect(t1.bench).toBe(15)
    expect(t1.accuracy).toBeCloseTo(0.7)
    expect(t1.miss).toMatchObject({ started: 'w1', sat: 'b1', diff: 15 })
    // Lost by 40: the 15 on the bench did not decide it.
    expect(t1.miss!.decisive).toBeUndefined()
    expect(r.calls.bad?.rosterId).toBe(1)
    expect(r.awards.bench).toEqual({ rosterId: 1, pts: 15 })
  })

  it('finds the best player at each position, started or not', () => {
    const r = buildRecap(base)
    expect(r.stars.find((s) => s.pos === 'QB')).toMatchObject({ id: 'q4', pts: 40, started: true })
    expect(r.stars.find((s) => s.pos === 'WR')).toMatchObject({ id: 'w4', pts: 35 })
  })

  it('counts a good call only when it went against the projections', () => {
    const tw = { week: 2, rosterId: 9, points: 30, opponentId: null, opponentPoints: null, result: null, optimalPoints: 30, starters: ['q1', 'w1'], slotted: ['q1', 'w1'], players: ['q1', 'w1', 'b1'], playersPoints: { q1: 10, w1: 20, b1: 5 } }
    expect(lineupCalls(tw, slots, players, { q1: 10, w1: 8, b1: 12 }).good).toMatchObject({ started: 'w1', sat: 'b1', diff: 15 })
    expect(lineupCalls(tw, slots, players, { q1: 10, w1: 14, b1: 12 }).good).toBeNull()
  })
})

describe('sortPasses', () => {
  it('ends on the target order, swapping only neighbours', () => {
    const passes = sortPasses([4, 3, 2, 1], [1, 2, 3, 4])
    expect(passes[passes.length - 1].order).toEqual([1, 2, 3, 4])
    for (const p of passes) for (const i of p.swaps) expect(i).toBeLessThan(3)
  })
  it('has nothing to play when nothing moved', () => {
    expect(sortPasses([1, 2, 3], [1, 2, 3])).toEqual([])
  })
})

describe('estimateWeek', () => {
  it('keeps final points, finishes live games on the projection, and projects the rest', () => {
    const [x] = estimateWeek([{ roster_id: 1, matchup_id: 1, points: 0, players: ['a', 'b', 'c'], starters: ['a', 'b'], players_points: { a: 12, b: 6 } }], { a: 20, b: 10, c: 9 }, (id) =>
      id === 'a' ? { state: 'final' } : id === 'b' ? { state: 'live', elapsed: 0.5 } : { state: 'pre' },
    )
    expect(x.players_points).toEqual({ a: 12, b: 11, c: 9 })
    expect(x.points).toBe(23)
  })
})

describe('reveal timing', () => {
  const games = [
    { week: 5, home: 'A', away: 'B', status: 'complete', date: '2026-10-11' },
    { week: 5, home: 'C', away: 'D', status: 'complete', date: '2026-10-12' },
  ]
  it('opens at 6am the Tuesday after Monday night', () => {
    const g = revealGate(games, 5)!
    expect([g.getFullYear(), g.getMonth() + 1, g.getDate(), g.getHours(), g.getDay()]).toEqual([2026, 10, 13, 6, 2])
  })
  it('goes stale once the next week has kicked off', () => {
    const next = [...games, { week: 6, home: 'A', away: 'C', status: 'pre_game', date: '2026-10-15' }, { week: 6, home: 'B', away: 'D', status: 'pre_game', date: '2026-10-18' }]
    const s = revealStale(next, 5)!
    expect([s.getMonth() + 1, s.getDate(), s.getHours()]).toEqual([10, 15, 0])
    expect(revealStale(games, 5)).toBeNull()
  })
  it('picks a week once every game is final, before it is settled', () => {
    const mbw = { 4: matchupsByWeek[1], 5: matchupsByWeek[2] }
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games, week: 5, playoffStart: 15 })).toBe(5)
    const live = games.map((g, i) => (i ? { ...g, status: 'in_game' } : g))
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games: live, week: 5, playoffStart: 15 })).toBe(4)
    expect(weeksBefore(mbw, 5, 15)).toEqual([4])
  })
})

describe('recapOdds', () => {
  it('moves playoff odds toward the week\'s winners, on the same draws', () => {
    const recap = buildRecap(base)
    const forecast = { mean: () => 100, sigma: 20, tau: 8 } as unknown as Forecast
    const schedule = [3, 4, 5].flatMap((week) => [
      { week, a: 1, b: 2 },
      { week, a: 3, b: 4 },
    ])
    const odds = recapOdds({ ...base, recap, forecast, schedule, playoffWeeks: [6], playoffTeams: 2, weeksLeft: 3, sims: 800 })
    expect(Object.keys(odds)).toHaveLength(4)
    // Team 4 won week 2, team 1 lost it.
    expect(odds[4].after.playoffs).toBeGreaterThan(odds[4].before.playoffs)
    expect(odds[1].after.playoffs).toBeLessThan(odds[1].before.playoffs)
  })
})
