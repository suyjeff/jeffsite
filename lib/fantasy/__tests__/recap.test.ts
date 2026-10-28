import { describe, expect, it } from 'vitest'
import { buildRecap, countdown, dropsLabel, lineupCalls, mergeSims, recapOdds, recapOddsRuns, revealGate, revealStale, revealState, revealWeek, sortPasses, weeksBefore, zonedInstant } from '../recap'
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

describe('reveal timing', () => {
  const games = [
    { week: 5, home: 'A', away: 'B', status: 'complete', date: '2026-10-11' },
    { week: 5, home: 'C', away: 'D', status: 'complete', date: '2026-10-12' },
  ]
  it('opens at 6 AM Eastern the Tuesday after Monday night, wherever the viewer is', () => {
    expect(revealGate(games, 5)!.toISOString()).toBe('2026-10-13T10:00:00.000Z')
    // Standard time: 6 AM EST is 11:00 UTC.
    expect(revealGate([{ week: 10, home: 'A', away: 'B', status: 'complete', date: '2026-11-09' }], 10)!.toISOString()).toBe('2026-11-10T11:00:00.000Z')
    // A Thursday or Sunday finish still waits for Tuesday; a week that runs past Monday opens the morning after.
    expect(revealGate([{ week: 5, home: 'A', away: 'B', status: 'complete', date: '2026-10-11' }], 5)!.toISOString()).toBe('2026-10-13T10:00:00.000Z')
    expect(revealGate([{ week: 5, home: 'A', away: 'B', status: 'complete', date: '2026-10-14' }], 5)!.toISOString()).toBe('2026-10-15T10:00:00.000Z')
    expect(revealGate([], 5)).toBeNull()
  })
  it('reads Eastern wall time across DST changes', () => {
    expect(zonedInstant(2026, 3, 7, 6).toISOString()).toBe('2026-03-07T11:00:00.000Z')
    expect(zonedInstant(2026, 3, 8, 6).toISOString()).toBe('2026-03-08T10:00:00.000Z')
    expect(zonedInstant(2026, 10, 31, 6).toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(zonedInstant(2026, 11, 1, 6).toISOString()).toBe('2026-11-01T11:00:00.000Z')
    expect(zonedInstant(2026, 12, 29, 6).toISOString()).toBe('2026-12-29T11:00:00.000Z')
  })
  it('labels the drop in Eastern time and counts down to it', () => {
    const g = revealGate(games, 5)!
    expect(dropsLabel(g)).toBe('Tue 6 AM ET')
    expect(countdown(g, Date.parse('2026-10-13T02:30:00Z'))).toBe('in 7h 30m')
    expect(countdown(g, Date.parse('2026-10-11T08:00:00Z'))).toBe('in 2d 2h')
    expect(countdown(g, Date.parse('2026-10-13T09:48:30Z'))).toBe('in 12m')
    expect(countdown(g, g.getTime())).toBeNull()
  })
  it('goes stale once the next week has kicked off', () => {
    const next = [...games, { week: 6, home: 'A', away: 'C', status: 'pre_game', date: '2026-10-15' }, { week: 6, home: 'B', away: 'D', status: 'pre_game', date: '2026-10-18' }]
    // Midnight Eastern, whatever the viewer's clock: 4 AM UTC in daylight time, 5 AM in standard time.
    expect(revealStale(next, 5)!.toISOString()).toBe('2026-10-15T04:00:00.000Z')
    expect(revealStale([{ week: 11, home: 'A', away: 'B', status: 'pre_game', date: '2026-11-05' }], 10)!.toISOString()).toBe('2026-11-05T05:00:00.000Z')
    expect(revealStale(games, 5)).toBeNull()
  })
  it('picks a week once every game is final, before it is settled', () => {
    const mbw = { 4: matchupsByWeek[1], 5: matchupsByWeek[2] }
    // Late Monday night Eastern: a Monday game still in play holds the week; a day past, a stuck status no longer does.
    const now = Date.parse('2026-10-13T03:00:00Z')
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games, week: 5, playoffStart: 15, now })).toBe(5)
    const live = games.map((g, i) => (i ? { ...g, status: 'in_game' } : g))
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games: live, week: 5, playoffStart: 15, now })).toBe(4)
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games: live, week: 5, playoffStart: 15, now: Date.parse('2026-10-14T09:00:00Z') })).toBe(5)
    // A postponed game sits at pre_game under its old date: the week never opens on the calendar alone.
    const postponed = games.map((g, i) => (i ? { ...g, status: 'pre_game' } : g))
    expect(revealWeek({ regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games: postponed, week: 5, playoffStart: 15, now: Date.parse('2026-10-20T09:00:00Z') })).toBe(4)
    expect(weeksBefore(mbw, 5, 15)).toEqual([4])
  })
})

describe('revealState', () => {
  const games = [
    { week: 5, home: 'A', away: 'B', status: 'complete', date: '2026-10-11' },
    { week: 5, home: 'C', away: 'D', status: 'complete', date: '2026-10-12' },
    { week: 6, home: 'A', away: 'C', status: 'pre_game', date: '2026-10-15' },
    { week: 6, home: 'B', away: 'D', status: 'pre_game', date: '2026-10-18' },
  ]
  const mbw = { 4: matchupsByWeek[1], 5: matchupsByWeek[2] }
  const base = { regularWeeks: [1, 2, 3, 4], matchupsByWeek: mbw, games, week: 5, playoffStart: 15, current: true }
  const at = (iso: string) => Date.parse(iso)

  it('holds a finished week back until its gate and keeps the last one on show', () => {
    // Monday night, 11:59 PM Eastern: week 5 is final but locked.
    const before = revealState({ ...base, now: at('2026-10-13T03:59:00Z') })
    expect(before.revealed).toBe(4)
    expect(before.pending?.week).toBe(5)
    expect(before.pending?.gate.toISOString()).toBe('2026-10-13T10:00:00.000Z')
    // A minute before 6 AM Eastern, still locked, even when the week is already settled into the model.
    expect(revealState({ ...base, regularWeeks: [1, 2, 3, 4, 5], now: at('2026-10-13T09:59:00Z') })).toMatchObject({ revealed: 4, pending: { week: 5 } })
  })
  it('unlocks it at 6 AM Eastern', () => {
    expect(revealState({ ...base, now: at('2026-10-13T10:00:00Z') })).toEqual({ revealed: 5, pending: null })
  })
  it('says the week under way is coming once it kicks off, not before', () => {
    const live = games.map((g) => (g.week === 6 && g.date === '2026-10-15' ? { ...g, status: 'complete' } : g))
    // Wednesday: week 6 has not kicked off, so nothing is pending.
    expect(revealState({ ...base, week: 6, now: at('2026-10-14T16:00:00Z') })).toEqual({ revealed: 5, pending: null })
    const s = revealState({ ...base, games: live, week: 6, now: at('2026-10-16T16:00:00Z') })
    expect(s.revealed).toBe(5)
    expect(s.pending?.week).toBe(6)
    expect(s.pending?.gate.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })
  it('names the week still being played when Sleeper has already moved on', () => {
    // Monday night, week 5's last game not final yet and Sleeper already on week 6: week 5 is the one coming.
    const mnf = games.map((g) => (g.week === 5 && g.date === '2026-10-12' ? { ...g, status: 'in_game' } : g))
    const s = revealState({ ...base, games: mnf, week: 6, now: at('2026-10-13T01:00:00Z') })
    expect(s.revealed).toBe(4)
    expect(s.pending?.week).toBe(5)
    expect(s.pending?.gate.toISOString()).toBe('2026-10-13T10:00:00.000Z')
  })
  it('names week 1 while it is played, with nothing revealed yet', () => {
    const wk1 = [
      { week: 1, home: 'A', away: 'B', status: 'complete', date: '2026-09-10' },
      { week: 1, home: 'C', away: 'D', status: 'in_game', date: '2026-09-13' },
    ]
    const s = revealState({ ...base, regularWeeks: [], matchupsByWeek: { 1: matchupsByWeek[1] }, games: wk1, week: 1, now: at('2026-09-13T20:00:00Z') })
    expect(s.revealed).toBeNull()
    expect(s.pending?.week).toBe(1)
    expect(s.pending?.gate.toISOString()).toBe('2026-09-15T10:00:00.000Z')
    // Before kickoff there is nothing to announce.
    expect(revealState({ ...base, regularWeeks: [], matchupsByWeek: {}, games: wk1.map((g) => ({ ...g, status: 'pre_game' })), week: 1, now: at('2026-09-08T20:00:00Z') })).toEqual({ revealed: null, pending: null })
  })
  it('shows a past season whole, with nothing pending', () => {
    expect(revealState({ ...base, current: false, regularWeeks: [1, 2, 3], now: at('2026-10-13T03:00:00Z') })).toEqual({ revealed: 3, pending: null })
  })
  it('has nothing locked when the schedule has no dates', () => {
    expect(revealState({ ...base, games: games.map(({ date: _, ...g }) => g), now: at('2026-10-13T03:00:00Z') })).toEqual({ revealed: 5, pending: null })
  })
})

describe('recapOdds', () => {
  it('moves playoff odds toward the week\'s winners, on the same draws', () => {
    const recap = buildRecap(base)
    const forecast = { simInput: { teams: [1, 2, 3, 4], record: {}, schedule: [], mean: () => 100, sigma: 20, tau: 8, playoffWeeks: [6], playoffTeams: 2, sims: 800 }, sims: 800 } as unknown as Forecast
    const schedule = [3, 4, 5].flatMap((week) => [
      { week, a: 1, b: 2 },
      { week, a: 3, b: 4 },
    ])
    const odds = recapOdds({ ...base, recap, forecast, schedule, weeksLeft: 3 })
    expect(Object.keys(odds)).toHaveLength(4)
    // Team 4 won week 2, team 1 lost it.
    expect(odds[4].after.playoffs).toBeGreaterThan(odds[4].before.playoffs)
    expect(odds[1].after.playoffs).toBeLessThan(odds[1].before.playoffs)
  })
})

describe('mergeSims', () => {
  it('adds slices into exactly the whole run', () => {
    const recap = buildRecap(base)
    const forecast = { simInput: { teams: [1, 2, 3, 4], record: {}, schedule: [], mean: () => 100, sigma: 20, tau: 8, playoffWeeks: [5], playoffTeams: 2, sims: 400 }, sims: 400 } as unknown as Forecast
    const schedule = [3, 4].flatMap((week) => [
      { week, a: 1, b: 2 },
      { week, a: 3, b: 4 },
    ])
    const runs = recapOddsRuns({ ...base, recap, forecast, schedule, weeksLeft: 2 })
    const merged = mergeSims([runs.after(0, 200), runs.after(1, 200)])
    expect(merged).toEqual(mergeSims([runs.after(0, 400)]))
    const p = Object.values(merged).reduce((a, t) => a + t.playoffs, 0)
    // Two of four teams make it in every season, so the odds sum to two.
    expect(p).toBeCloseTo(2, 6)
    expect(merged[1].seeds.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6)
  })
})

describe('recap weights', () => {
  it('shows the weights the composite used, dropping roster when no team has any strength', () => {
    const r = buildRecap(base)
    expect(r.weights.roster).toBe(0)
    const sum = Object.values(r.weights).reduce((a, x) => a + x, 0)
    expect(sum).toBeCloseTo(1, 9)
    // Each team's power margin is the weighted sum of its parts, so the working shown adds up.
    const withRoster = buildRecap({ ...base, strength: { 1: 3, 2: 1, 3: 0, 4: -2 } })
    expect(withRoster.weights.roster).toBeGreaterThan(0)
    expect(Object.values(withRoster.weights).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9)
  })
})
