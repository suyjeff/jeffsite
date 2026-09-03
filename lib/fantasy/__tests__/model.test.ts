import { describe, expect, it } from 'vitest'
import { scoreStatLine, statLinePlayed } from '../scoring'
import { optimalLineup, starterDemand, startingSlots } from '../lineup'
import { lineupDelta, normalCdf, playerValues, replacementLevels } from '../war'
import { buildTeamSeasons, buildTeamWeeks, computePower, DEFAULT_POWER_WEIGHTS } from '../power'
import type { PlayerMap, SleeperMatchup } from '../types'

const P = (id: string, pos: string, fpos = [pos]): PlayerMap[string] => ({
  id,
  name: id,
  pos,
  fpos,
  team: null,
  status: null,
  injury: null,
  age: null,
  exp: null,
})

describe('scoring', () => {
  it('dot-products stats with scoring settings', () => {
    const pts = scoreStatLine(
      { pass_yd: 300, pass_td: 2, rec: 5, rec_yd: 50, fum_lost: 1, bonus_rec_te: 5 },
      { pass_yd: 0.04, pass_td: 4, rec: 1, rec_yd: 0.1, fum_lost: -2, rush_td: 6 },
    )
    expect(pts).toBe(12 + 8 + 5 + 5 - 2)
  })
  it('detects played games', () => {
    expect(statLinePlayed({ gp: 1, rec: 0 })).toBe(true)
    expect(statLinePlayed({ gp: 0 })).toBe(false)
    expect(statLinePlayed({ pts_ppr: 0 })).toBe(false)
    expect(statLinePlayed(undefined)).toBe(false)
  })
})

describe('lineup', () => {
  const slots = startingSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'IR'])
  it('derives starter slots and demand', () => {
    expect(slots.map((s) => s.name)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'])
    const d = starterDemand(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'], 10)
    expect(d.RB).toBeCloseTo(24.5)
    expect(d.TE).toBeCloseTo(11)
  })
  it('puts the best eligible players in the flex and leaves empty slots empty', () => {
    const lineup = optimalLineup(slots, [
      { id: 'qb1', fpos: ['QB'], pts: 20 },
      { id: 'rb1', fpos: ['RB'], pts: 15 },
      { id: 'rb2', fpos: ['RB'], pts: 12 },
      { id: 'rb3', fpos: ['RB'], pts: 11 },
      { id: 'wr1', fpos: ['WR'], pts: 14 },
      { id: 'wr2', fpos: ['WR'], pts: 9 },
      { id: 'te1', fpos: ['TE'], pts: 6 },
      { id: 'te2', fpos: ['TE'], pts: 10 },
    ])
    // QB 20 + RB 15+12 + WR 14+9 + TE 10 + FLEX rb3 11 = 91, K and DEF empty
    expect(lineup.total).toBe(91)
    expect(lineup.assignments[6]?.id).toBe('rb3')
    expect(lineup.assignments[7]).toBeNull()
  })
  it('solves overlapping flex eligibility exactly', () => {
    const s = startingSlots(['WRRB_FLEX', 'REC_FLEX'])
    const lineup = optimalLineup(s, [
      { id: 'wr', fpos: ['WR'], pts: 10 },
      { id: 'rb', fpos: ['RB'], pts: 9 },
      { id: 'te', fpos: ['TE'], pts: 8 },
    ])
    // Greedy would put WR in WRRB_FLEX then TE in REC_FLEX = 18; exact is RB + WR = 19.
    expect(lineup.total).toBe(19)
  })
})

describe('war', () => {
  it('normal cdf is sane', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3)
  })
  it('computes replacement level and PAR-based WAR', () => {
    const players: PlayerMap = {}
    const weekPoints = { 1: {} as Record<string, number>, 2: {} as Record<string, number> }
    for (let i = 1; i <= 10; i++) {
      players[`rb${i}`] = P(`rb${i}`, 'RB')
      weekPoints[1][`rb${i}`] = 30 - i * 2
      weekPoints[2][`rb${i}`] = 30 - i * 2
    }
    // 2 teams x 1 RB slot = demand 2, benchFactor 0.5 -> rank 3 band = rb2..rb4 -> (26+24+22)/3 = 24
    const levels = replacementLevels(weekPoints, [1, 2], players, ['RB', 'BN'], 2, 0.5)
    expect(levels[1].RB).toBe(24)
    const values = playerValues(weekPoints, [1, 2], players, levels, 10, {
      benchFactor: 0.5,
      halfLife: 0,
      riskAversion: 0,
    })
    expect(values.rb1.parPerGame).toBeCloseTo(4)
    expect(values.rb1.war).toBeGreaterThan(0)
    expect(values.rb10.war).toBeLessThan(0)
    expect(values.rb1.games).toBe(2)
    // WAR is bounded: no single week adds more than half a win.
    expect(Math.abs(values.rb1.weekly[0].war)).toBeLessThan(0.5)
  })
  it('lineupDelta measures marginal value to a specific roster', () => {
    const players: PlayerMap = { a: P('a', 'WR'), b: P('b', 'WR'), c: P('c', 'WR'), d: P('d', 'RB') }
    const weekPoints = { 1: { a: 20, b: 18, c: 10, d: 15 } }
    const slots = startingSlots(['WR', 'WR', 'BN'])
    // Team already has two good WRs; a third WR adds nothing, and an RB adds nothing.
    expect(lineupDelta(slots, weekPoints, [1], players, ['a', 'b'], [], ['c']).avg).toBe(0)
    expect(lineupDelta(slots, weekPoints, [1], players, ['a', 'b'], [], ['d']).avg).toBe(0)
    // Swapping b out for c loses 8.
    expect(lineupDelta(slots, weekPoints, [1], players, ['a', 'b'], ['b'], ['c']).avg).toBe(-8)
  })
})

describe('power', () => {
  const players: PlayerMap = { x: P('x', 'QB'), y: P('y', 'QB') }
  const slots = startingSlots(['QB'])
  const mk = (roster_id: number, matchup_id: number, points: number): SleeperMatchup => ({
    roster_id,
    matchup_id,
    points,
    players: ['x', 'y'],
    starters: ['x'],
    players_points: { x: points, y: points + 5 },
  })
  const matchups = {
    1: [mk(1, 1, 100), mk(2, 1, 90), mk(3, 2, 120), mk(4, 2, 80)],
    2: [mk(1, 1, 110), mk(3, 1, 95), mk(2, 2, 70), mk(4, 2, 75)],
    3: [mk(1, 1, 100), mk(4, 1, 105), mk(2, 2, 100), mk(3, 2, 90)],
  }
  it('builds records, all-play and luck', () => {
    const tw = buildTeamWeeks(matchups, [1, 2], slots, players)
    const seasons = buildTeamSeasons([1, 2, 3, 4], tw, [1, 2], { 1: [4], 2: [3] })
    const t1 = seasons.find((t) => t.rosterId === 1)!
    expect(t1.wins).toBe(2)
    expect(t1.pf).toBe(210)
    // Week 1: beat 90,80 lost to 120 -> 2-1. Week 2: beat 95,70,75 -> 3-0. Total 5-1.
    expect(t1.allPlayWins).toBe(5)
    expect(t1.expectedWins).toBeCloseTo((5 / 6) * 2)
    expect(t1.luck).toBeCloseTo(2 - (5 / 6) * 2)
    expect(t1.streak).toBe('W2')
    // Optimal lineup would have started y (5 more points each week).
    expect(t1.efficiency).toBeCloseTo(210 / 220)
    expect(t1.remainingOpponents).toEqual([4])
  })
  it('ranks teams and drops missing components', () => {
    const tw = buildTeamWeeks(matchups, [1, 2], slots, players)
    const seasons = buildTeamSeasons([1, 2, 3, 4], tw, [1, 2], {})
    const rows = computePower(seasons, { 1: 1, 2: 0.5, 3: 0.8, 4: 0.2 }, DEFAULT_POWER_WEIGHTS)
    expect(rows[0].rosterId).toBe(1)
    expect(rows[0].score).toBe(100)
    expect(rows[rows.length - 1].score).toBe(0)
    // Preseason: no games, only roster strength counts.
    const empty = buildTeamSeasons([1, 2], {}, [], {})
    const pre = computePower(empty, { 1: 2, 2: 1 }, DEFAULT_POWER_WEIGHTS)
    expect(pre[0].rosterId).toBe(1)
    expect(pre[0].components.allPlay).toBe(0)
  })
})
