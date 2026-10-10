import { describe, expect, it } from 'vitest'
import { optimalLineup, startingSlots, type LineupPlayer } from '../lineup'
import { pairSwaps } from '../swaps'

const slots = startingSlots(['QB', 'RB', 'WR', 'WR', 'FLEX', 'BN', 'BN'])
const p = (id: string, pos: string, pts: number): LineupPlayer => ({ id, fpos: [pos], pts })
const run = (pool: LineupPlayer[], set: (string | null)[]) => pairSwaps(slots, set, optimalLineup(slots, pool).assignments)

describe('pairing swaps with slots', () => {
  it('matches the lineup as set: no swaps', () => {
    const pool = [p('q', 'QB', 20), p('r1', 'RB', 15), p('w1', 'WR', 14), p('w2', 'WR', 13), p('f', 'RB', 12)]
    const plan = run(pool, ['q', 'r1', 'w1', 'w2', 'f'])
    expect(plan.swaps).toEqual([])
    expect(plan.count).toBe(0)
  })

  it('never offers a RB for a WR slot, even when he is first in the list', () => {
    // Set: the weak WR in WR2 and the weak RB in RB. The best lineup brings in a RB and a WR.
    const pool = [p('q', 'QB', 20), p('r1', 'RB', 5), p('w1', 'WR', 14), p('w2', 'WR', 2), p('f', 'WR', 12), p('rb', 'RB', 16), p('wr', 'WR', 15)]
    const plan = run(pool, ['q', 'r1', 'w1', 'w2', 'f'])
    const bySlot = Object.fromEntries(plan.swaps.map((s) => [s.slot, s]))
    expect(bySlot[1]).toMatchObject({ out: 'r1', in: 'rb' })
    expect(bySlot[3]).toMatchObject({ out: 'w2', in: 'wr' })
    expect(plan.unplaced).toEqual([])
    for (const s of plan.swaps) expect(pool.find((x) => x.id === s.in)!.fpos.some((pos) => slots[s.slot].eligible.includes(pos))).toBe(true)
  })

  it('puts a leftover into an empty slot only if he is eligible for it', () => {
    const pool = [p('q', 'QB', 20), p('r1', 'RB', 15), p('w1', 'WR', 14), p('w2', 'WR', 13), p('f', 'RB', 12)]
    const plan = run(pool, ['q', 'r1', 'w1', null, 'f'])
    expect(plan.swaps).toEqual([{ slot: 3, out: null, in: 'w2' }])
    // A lone QB cannot fill the empty RB slot.
    const qbOnly = run([p('q', 'QB', 20), p('q2', 'QB', 18)], ['q', null, null, null, null])
    expect(qbOnly.swaps.every((s) => s.in !== 'q2' || slots[s.slot].eligible.includes('QB'))).toBe(true)
  })

  it('falls back to eligibility when the optimiser seats the newcomer in another slot', () => {
    // The flex WR is out-scored by a newcomer WR at WR2; the optimiser seats the newcomer at WR2, the set man sits.
    const pool = [p('q', 'QB', 20), p('r1', 'RB', 15), p('w1', 'WR', 14), p('w2', 'WR', 4), p('f', 'WR', 3), p('nw', 'WR', 13), p('nw2', 'WR', 12)]
    const plan = run(pool, ['q', 'r1', 'w1', 'w2', 'f'])
    expect(plan.count).toBe(2)
    expect(plan.swaps.map((s) => [s.out, s.in]).sort()).toEqual([['f', 'nw2'], ['w2', 'nw']])
    expect(plan.unplaced).toEqual([])
  })

  it('surfaces a change it cannot place in a slot, with where the best lineup seats him', () => {
    // r1 sits, a WR comes in, and the best lineup does it by moving the FLEX RB into the RB slot.
    const pool = [p('q', 'QB', 20), p('r1', 'RB', 6), p('w1', 'WR', 14), p('w2', 'WR', 13), p('f', 'RB', 12), p('nw', 'WR', 11)]
    const plan = run(pool, ['q', 'r1', 'w1', 'w2', 'f'])
    expect(plan.count).toBe(1)
    expect(plan.swaps).toEqual([])
    expect(plan.unplaced).toEqual([{ id: 'nw', slot: 4 }])
    expect(plan.stuck).toEqual([{ slot: 1, out: 'r1' }])
  })
})
