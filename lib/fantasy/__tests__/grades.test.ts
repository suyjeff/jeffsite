import { describe, expect, it } from 'vitest'
import type { AcceptRead } from '../behavior'
import { applyLessons, ideaKey, learn, ruledOutBy, type Grades } from '../grades'
import type { TradeIdea } from '../trades'

const idea = (partnerId: number, give: string[], get: string[]) => ({ partnerId, give, get }) as unknown as TradeIdea
const read = (logit: number, perceivedAsk: number | null = 0): AcceptRead => ({
  index: Math.round(100 / (1 + Math.exp(-logit))),
  band: 'possible',
  perceivedAsk,
  faab: null,
  reasons: [],
  signals: [],
  logit,
})
const pos: Record<string, string> = { a: 'RB', b: 'WR', c: 'RB', d: 'QB', e: 'WR' }
const posOf = (id: string) => pos[id]
const name = (id: string) => id.toUpperCase()

describe('trade grades', () => {
  it('does nothing until you grade', () => {
    const r = read(0)
    expect(applyLessons(r, idea(2, ['a'], ['b']), learn({}, posOf), name, posOf)).toBe(r)
  })

  it('your grade of a deal is the answer for that deal', () => {
    const i = idea(2, ['a'], ['b'])
    const g: Grades = { [ideaKey(i)]: { partnerId: 2, give: ['a'], get: ['b'], grade: 'no', x: 0.5, ask: 0, at: 1 } }
    const out = applyLessons(read(0.5), i, learn(g, posOf), name, posOf)
    expect(out.index).toBe(7)
    expect(out.ruledOut).toBe(true)
    expect(out.graded).toBe('no')
  })

  it('pulls the same manager toward your grades, shrunk until there are several', () => {
    const g: Grades = {}
    for (const [k, get] of [
      ['x', 'b'],
      ['y', 'e'],
    ]) {
      const i = idea(3, [k], [get])
      g[ideaKey(i)] = { partnerId: 3, give: [k], get: [get], grade: 'no', x: 0.5, ask: 0, at: 1 }
    }
    const L = learn(g, posOf)
    // Two "no way" grades against a model that said 62%: about half the residual so far.
    expect(L.partner[3].offset).toBeLessThan(-1)
    expect(L.partner[3].offset).toBeGreaterThan(-2)
    const other = applyLessons(read(0.5), idea(3, ['c'], ['d']), L, name, posOf)
    expect(other.index).toBeLessThan(40)
    // Another manager moves only by the smaller league-wide share.
    const elsewhere = applyLessons(read(0.5), idea(4, ['c'], ['d']), L, name, posOf)
    expect(elsewhere.index).toBeGreaterThan(other.index)
  })

  it('a player they will not move takes every deal for him off the table, from that team only', () => {
    const i = idea(2, ['a'], ['b'])
    const g: Grades = { [ideaKey(i)]: { partnerId: 2, give: ['a'], get: ['b'], grade: 'no', why: 'untouchable', player: 'b', x: 0.5, ask: 0, at: 1 } }
    const L = learn(g, posOf)
    const another = applyLessons(read(1.5), idea(2, ['c', 'd'], ['b']), L, name, posOf)
    expect(another.ruledOut).toBe(true)
    expect(another.index).toBeLessThan(3)
    expect(another.signals[0].text).toContain('B')
    expect(applyLessons(read(1.5), idea(5, ['c'], ['b']), L, name, posOf).ruledOut).toBeFalsy()
  })

  it('a premium they balked at lowers asks as big or bigger', () => {
    const i = idea(2, ['a'], ['b'])
    const g: Grades = { [ideaKey(i)]: { partnerId: 2, give: ['a'], get: ['b'], grade: 'no', why: 'lopsided', x: 0, ask: 2, at: 1 } }
    const L = learn(g, posOf)
    const big = applyLessons(read(0, 2.5), idea(2, ['c'], ['d']), L, name, posOf)
    const small = applyLessons(read(0, 0.5), idea(2, ['c'], ['d']), L, name, posOf)
    expect(big.index).toBeLessThan(small.index)
  })

  it('your own grade of a deal outranks the rule its reason sets', () => {
    const i = idea(2, ['a'], ['b'])
    const g: Grades = { [ideaKey(i)]: { partnerId: 2, give: ['a'], get: ['b'], grade: 'maybe', why: 'untouchable', player: 'b', x: -1, ask: 0, at: 1 } }
    const L = learn(g, posOf)
    expect(applyLessons(read(-1), i, L, name, posOf).ruledOut).toBe(false)
    expect(ruledOutBy(i, L)).toBe(false)
    // Another deal for him, ungraded, is off the table.
    expect(ruledOutBy(idea(2, ['c'], ['b']), L)).toBe(true)
  })

  it("a rule-only grade does not dilute the manager's curve", () => {
    const plain = idea(3, ['a'], ['b'])
    const rules = [idea(3, ['c'], ['d']), idea(3, ['e'], ['b'])]
    const g: Grades = { [ideaKey(plain)]: { partnerId: 3, give: ['a'], get: ['b'], grade: 'no', x: 0.5, ask: 0, at: 1 } }
    const one = learn(g, posOf).partner[3].offset
    for (const r of rules) g[ideaKey(r)] = { partnerId: 3, give: r.give, get: r.get, grade: 'no', why: 'untouchable', player: r.get[0], x: 0.5, ask: 0, at: 1 }
    const L = learn(g, posOf)
    expect(L.partner[3].offset).toBeCloseTo(one, 9)
    expect(L.partner[3].n).toBe(1)
  })
})
