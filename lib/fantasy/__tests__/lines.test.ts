import { describe, expect, it } from 'vitest'
import { blendWeek, devig, gradeSnapshots, impliedMean, invPhi, marketWeek, poissonRate, reduceLines, MEDIAN_TO_MEAN } from '../lines'
import type { PlayerMap } from '../types'

const P = (id: string, pos: string): PlayerMap[string] => ({ id, name: id, pos, fpos: [pos], team: 'DAL', status: null, injury: null, age: null, exp: null })

describe('reading a price', () => {
  it('removes the margin from both sides', () => {
    expect(devig(1.95, 1.64)).toBeCloseTo(0.457, 3)
    expect(devig(1.8, 1.8)).toBeCloseTo(0.5, 9)
  })
  it('inverts the normal', () => {
    expect(invPhi(0.5)).toBeCloseTo(0, 6)
    expect(invPhi(0.975)).toBeCloseTo(1.96, 2)
    expect(invPhi(0.01)).toBeCloseTo(-2.326, 2)
  })
  it('solves a Poisson rate from a half-point line', () => {
    // P(X > 0.5) = 1 − e^−λ
    expect(poissonRate(0.5, 0.6)).toBeCloseTo(-Math.log(0.4), 3)
  })
  it('turns an even yardage line into a mean above the median', () => {
    expect(impliedMean('rec_yd', 60.5, 0.5)).toBeCloseTo(60.5 * MEDIAN_TO_MEAN.rec_yd, 6)
    expect(impliedMean('rec_yd', 60.5, 0.6)).toBeGreaterThan(impliedMean('rec_yd', 60.5, 0.5))
    expect(impliedMean('pass_yd', 240.5, 0.5)).toBeCloseTo(240.5, 6)
  })
})

describe('marketWeek', () => {
  const row = (id: string, stat: string, line: number, over: number, under: number, game = 'g5') => ({
    sport: 'nfl',
    subject_type: 'player',
    subject_id: id,
    game_id: game,
    wager_type: stat,
    game_status: 'pre_game',
    options: [
      { outcome: 'over', outcome_value: line, payout_multiplier: String(over) },
      { outcome: 'under', outcome_value: line, payout_multiplier: String(under) },
    ],
  })
  const raw = [
    row('wr', 'receiving_yards', 70.5, 1.8, 1.8),
    row('wr', 'receptions', 5.5, 1.8, 1.8),
    row('wr', 'anytime_touchdowns', 0.5, 2.5, 1.4),
    row('wr', 'receiving_yards', 99.5, 1.8, 1.8, 'g6'),
    { sport: 'mlb', subject_type: 'player', subject_id: 'x', wager_type: 'hits', options: [] },
  ]
  const rows = reduceLines(raw)
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_td: 6, fum_lost: -2 }
  const m = marketWeek({ rows, gameWeek: { g5: 5, g6: 6 }, week: 5, projections: { wr: { rec: 6, rec_yd: 80, rec_td: 0.5, fum_lost: 0.1 } }, scoring, players: { wr: P('wr', 'WR') } })
  it('keeps only two-sided NFL player props, and only the requested week', () => {
    expect(rows).toHaveLength(4)
    expect(m.byId.wr.props).toHaveLength(3)
  })
  it('scores the market stats with league settings, keeping Sleeper for unpriced categories', () => {
    const p = m.byId.wr
    const td = -Math.log(1 - devig(2.5, 1.4))
    const expected = 5.5 + 70.5 * MEDIAN_TO_MEAN.rec_yd * 0.1 + 6 * td * (1 - 0.05 * 0) - 0.2
    // TD split follows Sleeper (all receiving here), fumbles stay Sleeper's.
    expect(p.stats.rec_td).toBeCloseTo(td, 6)
    expect(p.pts).toBeCloseTo(expected, 1)
    expect(p.sleeper).toBeCloseTo(6 + 8 + 3 - 0.2, 6)
  })
  it('blends only where Sleeper projects the player to play', () => {
    const out = blendWeek({ wr: 10, other: 7 }, { ...m, byId: { wr: { ...m.byId.wr, pts: 20 }, other: { ...m.byId.wr, pts: 9 } } })
    expect(out.wr).toBeCloseTo(15)
    expect(blendWeek({ wr: 0 }, m).wr).toBe(0)
  })
})

describe('gradeSnapshots', () => {
  it('scores each source by mean absolute error over players who played', () => {
    const g = gradeSnapshots({ 5: { a: [10, 14], b: [8, 6], c: [5, 5] } }, { 5: { a: 15, b: 6 } })!
    expect(g.n).toBe(2)
    expect(g.maeSleeper).toBeCloseTo((5 + 2) / 2)
    expect(g.maeMarket).toBeCloseTo((1 + 0) / 2)
    expect(g.weeks).toEqual([5])
  })
})
