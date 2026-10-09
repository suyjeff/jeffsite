import { describe, expect, it } from 'vitest'
import { buildSlate, DEFAULT_CV, positionCV } from '../slate'
import type { PlayerMap, SleeperMatchup } from '../types'

const P = (id: string, pos: string, team: string) => ({ id, name: id, pos, fpos: [pos], team, status: null, injury: null, age: null, exp: null })
const players = {
  a1: P('a1', 'QB', 'DET'),
  a2: P('a2', 'WR', 'ARI'),
  b1: P('b1', 'QB', 'BAL'),
  b2: P('b2', 'RB', 'DET'),
} as unknown as PlayerMap
const games = [
  { week: 5, home: 'ARI', away: 'DET', status: 'pre_game', date: '2026-10-11' },
  { week: 5, home: 'ATL', away: 'BAL', status: 'pre_game', date: '2026-10-11' },
]
const m = (roster_id: number, starters: string[], pts: Record<string, number> = {}): SleeperMatchup => ({
  roster_id,
  matchup_id: 1,
  points: 0,
  players: starters,
  starters,
  players_points: pts,
})
const base = {
  week: 5,
  games,
  players,
  lineups: {},
  proj: { a1: 20, a2: 12, b1: 18, b2: 10 },
  cv: DEFAULT_CV,
  sigma: 20,
  totals: {},
  stakes: { 1: { win: { playoffs: 0.6, title: 0.1 }, loss: { playoffs: 0.4, title: 0.05 } }, 2: { win: { playoffs: 0.5, title: 0.1 }, loss: { playoffs: 0.3, title: 0.05 } } },
}

describe('slate', () => {
  it('prices a matchup and the games that decide it', () => {
    const s = buildSlate({ ...base, matchups: [m(1, ['a1', 'a2']), m(2, ['b1', 'b2'])] })
    expect(s.matchups).toHaveLength(1)
    const mu = s.matchups[0]
    expect(mu.a.mu).toBe(32)
    expect(mu.b.mu).toBe(28)
    // Each lineup carries the league's σ, so the gap of 4 is a modest edge.
    expect(mu.a.sd).toBeCloseTo(20, 5)
    expect(mu.pA).toBeGreaterThan(0.5)
    expect(mu.pA).toBeLessThan(0.65)
    // DET @ ARI holds three of the four starters: it decides more than BAL @ ATL.
    expect(s.games.find((g) => g.home === 'ARI')!.swing).toBeGreaterThan(s.games.find((g) => g.home === 'ATL')!.swing)
    expect(s.managers[1].games[0].key).toBe('5:DET@ARI')
    expect(s.managers[1].games[0].mine.sort()).toEqual(['a1', 'a2'])
    expect(s.managers[1].games[0].theirs).toEqual(['b2'])
    // A game is one bet: never more than all of the odds, never less than its biggest player alone.
    const det = s.managers[1].games[0]
    expect(det.swing).toBeLessThanOrEqual(1)
    expect(det.swing).toBeGreaterThanOrEqual(Math.max(s.byId.a1.swing, s.byId.a2.swing, s.byId.b2.swing))
    expect(s.managers[2].games[0].swing).toBeCloseTo(det.swing, 9)
    // Standing: swing times what a win is worth (20 points of playoff odds).
    const a1 = s.byId.a1
    expect(a1.standing).toBeCloseTo(a1.swing * 0.2, 6)
    expect(a1.low).toBeLessThan(20)
    expect(a1.high).toBeGreaterThan(20)
  })

  it('a final game is fact: no spread, and the result shows as what it did to the odds', () => {
    const done = games.map((g) => (g.home === 'ARI' ? { ...g, status: 'complete' } : g))
    const s = buildSlate({ ...base, games: done, matchups: [m(1, ['a1', 'a2'], { a1: 35, a2: 2 }), m(2, ['b1', 'b2'], { b2: 4 })] })
    const a1 = s.byId.a1
    expect(a1.actual).toBe(35)
    expect(a1.swing).toBe(0)
    expect(a1.realized!).toBeGreaterThan(0)
    expect(s.byId.a2.realized!).toBeLessThan(0)
    expect(s.matchups[0].a.banked).toBe(37)
    expect(s.matchups[0].a.left).toBe(0)
    expect(s.matchups[0].b.left).toBe(1)
  })

  it('measures position spread on this season, shrunk toward the long-run figure', () => {
    const wp = { 1: { q: 30, r: 5 }, 2: { q: 10, r: 25 }, 3: { q: 20, r: 15 } }
    const cv = positionCV(wp, [1, 2, 3], { q: P('q', 'QB', 'X'), r: P('r', 'RB', 'Y') } as unknown as PlayerMap)
    // One very swingy QB moves the QB figure up a little, not to his own 0.5.
    expect(cv.QB).toBeGreaterThan(DEFAULT_CV.QB)
    expect(cv.QB).toBeLessThan(0.5)
  })
})
