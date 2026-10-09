import { describe, expect, it } from 'vitest'
import { bestFreeAgent, freeAgentsByPos } from '../moves'
import type { PlayerMap } from '../types'

const players = {
  a: { name: 'A', pos: 'K', fpos: ['K'] },
  b: { name: 'B', pos: 'K', fpos: ['K'] },
  c: { name: 'C', pos: 'RB', fpos: ['RB'] },
  d: { name: 'D', pos: 'WR', fpos: ['WR'] },
} as unknown as PlayerMap
const pts = { a: 8, b: 9, c: 12, d: 11 }

describe('free agents for a slot', () => {
  it('names the best free agent at any eligible position, skipping the rostered and the excluded', () => {
    expect(bestFreeAgent(players, {}, ['K'], pts)).toBe('b')
    expect(bestFreeAgent(players, { b: 1 }, ['K'], pts)).toBe('a')
    expect(bestFreeAgent(players, {}, ['K'], pts, new Set(['b']))).toBe('a')
    expect(bestFreeAgent(players, {}, ['RB', 'WR'], pts)).toBe('c')
    expect(bestFreeAgent(players, {}, ['TE'], pts)).toBeNull()
  })

  it('re-ranks when the rosters change, even on the same week of points', () => {
    const free = {}
    const taken = { c: 2 }
    expect(freeAgentsByPos(players, free, pts).RB).toEqual(['c'])
    expect(freeAgentsByPos(players, taken, pts).RB).toBeUndefined()
  })
})
