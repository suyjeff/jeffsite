import { describe, expect, it } from 'vitest'
import { faabCare, readDeal, tidyDeal, type Deal, type DealInput } from '../deal'
import type { Faab } from '../faab'
import { startingSlots } from '../lineup'
import type { PlayerMap } from '../types'

const P = (id: string, pos: string): PlayerMap[string] => ({ id, name: id, pos, fpos: [pos], team: null, status: null, injury: null, age: null, exp: null })
const SLOTS = startingSlots(['QB', 'RB', 'WR', 'BN', 'BN'])
const players: PlayerMap = {
  q1: P('q1', 'QB'),
  q2: P('q2', 'QB'),
  q3: P('q3', 'QB'),
  r1: P('r1', 'RB'),
  r2: P('r2', 'RB'),
  r3: P('r3', 'RB'),
  w1: P('w1', 'WR'),
  w2: P('w2', 'WR'),
  w3: P('w3', 'WR'),
}
const pts = { q1: 20, q2: 15, q3: 12, r1: 18, r2: 10, r3: 8, w1: 16, w2: 9, w3: 11 }
const input: DealInput = {
  slots: SLOTS,
  players,
  horizon: [
    { week: 6, pts },
    { week: 7, pts },
  ],
  floor: {},
  capacity: 5,
  pts,
  market: { q1: 6, q2: 3, q3: 1, r1: 7, r2: 2, r3: 1, w1: 5, w2: 1, w3: 2 },
  rosters: { 1: ['q1', 'r2', 'w2'], 2: ['q2', 'r1', 'w3'], 3: ['q3', 'r3', 'w1'] },
}
const faab: Faab = {
  budget: 100,
  minBid: 0,
  remaining: { 1: 90, 2: 5, 3: 50 },
  bids: [],
  going: { p50: 5, p75: 10, p90: 20, max: 30, n: 0, source: 'none' },
  rate: 10,
  rateN: 0,
  weeksLeft: 8,
  regularWeeks: 14,
}

describe('readDeal', () => {
  it('prices a two-team swap from both sides', () => {
    const deal: Deal = {
      teams: [1, 2],
      moves: [
        { player: 'r2', from: 1, to: 2 },
        { player: 'r1', from: 2, to: 1 },
      ],
      faab: [],
    }
    const [a, b] = readDeal(deal, input).sides
    expect(a.receives).toEqual(['r1'])
    expect(a.lineup).toBeCloseTo(8)
    expect(b.lineup).toBeCloseTo(-8)
    expect(a.weeksBetter).toBe(2)
    expect(a.value).toBeGreaterThan(0)
  })

  it('moves players around three teams, and every side adds up', () => {
    const deal: Deal = {
      teams: [1, 2, 3],
      moves: [
        { player: 'w2', from: 1, to: 2 },
        { player: 'w3', from: 2, to: 3 },
        { player: 'w1', from: 3, to: 1 },
      ],
      faab: [],
    }
    const read = readDeal(deal, input)
    const by = Object.fromEntries(read.sides.map((s) => [s.rosterId, s]))
    expect(by[1].lineup).toBeCloseTo(7)
    expect(by[2].lineup).toBeCloseTo(-2)
    expect(by[3].lineup).toBeCloseTo(-5)
    expect(read.valid).toBe(true)
  })

  it('values FAAB as a range, discounted, and flags money a team does not have', () => {
    const deal: Deal = { teams: [1, 2], moves: [], faab: [{ from: 1, to: 2, dollars: 20 }] }
    const [a, b] = readDeal(deal, { ...input, faab }).sides
    expect(b.faab).toBe(20)
    expect(b.faabValue.low).toBeLessThan(b.faabValue.mid)
    expect(b.faabValue.high).toBeGreaterThan(b.faabValue.mid)
    expect(a.faabValue.mid).toBeLessThan(0)
    const broke = readDeal({ teams: [1, 2], moves: [], faab: [{ from: 2, to: 1, dollars: 50 }] }, { ...input, faab })
    expect(broke.valid).toBe(false)
    expect(broke.sides[1].problems.length).toBe(1)
  })

  it('checks what a team sends against its budget, whatever it also receives', () => {
    const deal: Deal = {
      teams: [1, 2, 3],
      moves: [],
      faab: [
        { from: 2, to: 1, dollars: 50 },
        { from: 3, to: 2, dollars: 50 },
      ],
    }
    const read = readDeal(deal, { ...input, faab })
    expect(read.sides.find((x) => x.rosterId === 2)!.faab).toBe(0)
    expect(read.sides.find((x) => x.rosterId === 2)!.problems.length).toBe(1)
    expect(read.valid).toBe(false)
  })

  it('counts FAAB for more to a team nearly out of it', () => {
    expect(faabCare(faab, 2)).toBeGreaterThan(faabCare(faab, 1))
    expect(faabCare(faab, 1)).toBeGreaterThanOrEqual(0.35)
    expect(faabCare(faab, 2)).toBeLessThanOrEqual(0.85)
  })

  it('drops moves to teams no longer in the deal', () => {
    const deal: Deal = {
      teams: [1, 2],
      moves: [
        { player: 'w1', from: 3, to: 1 },
        { player: 'r2', from: 1, to: 2 },
      ],
      faab: [{ from: 1, to: 1, dollars: 5 }],
    }
    const t = tidyDeal(deal)
    expect(t.moves).toEqual([{ player: 'r2', from: 1, to: 2 }])
    expect(t.faab).toEqual([])
  })
})
