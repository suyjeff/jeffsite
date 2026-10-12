import { describe, expect, it } from 'vitest'
import { cleanGrade, contribute, moveGlobal, priorFor, TARGET, type Contribution, type StoredGrade } from '../../../workers/grades/src/aggregate'

const g = (over: Partial<StoredGrade> = {}): StoredGrade => ({ key: 'abcd1234', partnerId: 3, grade: 'no', x: 0.5, ask: null, at: 1, ...over })
const logit = (p: number) => Math.log(p / (1 - p))

describe('grades worker aggregation', () => {
  it('sums residuals per team and overall, leaving out grades that are rules of their own', () => {
    const c = contribute([g({ key: 'aaaa1' }), g({ key: 'bbbb2', grade: 'yes', x: 0 }), g({ key: 'cccc3', why: 'untouchable', player: '4034' }), g({ key: 'dddd4', partnerId: 5, why: 'dormant' })])
    expect(c.partners[3].n).toBe(2)
    expect(c.partners[3].sum).toBeCloseTo(logit(TARGET.no) - 0.5 + logit(TARGET.yes), 9)
    expect(c.partners[3].untouchable).toEqual(['4034'])
    expect(c.partners[5].dormant).toBe(true)
    expect(c.all.n).toBe(3)
  })

  it('keeps the smallest balked premium per price scale', () => {
    const c = contribute([g({ key: 'aaaa1', why: 'lopsided', ask: 3, v: 2 }), g({ key: 'bbbb2', why: 'lopsided', ask: 2, v: 2 }), g({ key: 'cccc3', why: 'lopsided', ask: 1, v: 1 })])
    expect(c.partners[3].ask).toEqual({ 1: 1, 2: 2 })
  })

  it('validates grades and drops anything odd', () => {
    expect(cleanGrade(g())).toMatchObject({ partnerId: 3, grade: 'no' })
    expect(cleanGrade(g({ x: 99 }))).toBeNull()
    expect(cleanGrade(g({ grade: 'great' as never }))).toBeNull()
    expect(cleanGrade(g({ key: 'has space!' }))).toBeNull()
    expect(cleanGrade(g({ partnerId: 1.5 }))).toBeNull()
    expect(cleanGrade({ ...g(), ask: 1e9 })).toBeNull()
    expect(cleanGrade(null)).toBeNull()
    // A player id only rides along with "won't move him", and only if it looks like an id.
    expect(cleanGrade({ ...g(), why: 'lopsided', player: '4034' })?.player).toBeUndefined()
    expect(cleanGrade({ ...g(), why: 'untouchable', player: 'Some Name!' })?.player).toBeUndefined()
    expect(cleanGrade({ ...g(), why: 'untouchable', player: '4034' })?.player).toBe('4034')
  })

  it('keeps a running global total as one browser regrades', () => {
    const one = contribute([g()])
    let total = moveGlobal({ sum: 0, n: 0 }, undefined, one)
    expect(total).toEqual(one.all)
    const regraded = contribute([g({ grade: 'yes' })])
    total = moveGlobal(total, one, regraded)
    expect(total.sum).toBeCloseTo(regraded.all.sum, 12)
    expect(total.n).toBe(1)
    total = moveGlobal(total, regraded, { all: { sum: 0, n: 0 }, partners: {}, at: 0 })
    expect(total).toEqual({ sum: 0, n: 0 })
  })

  it('builds a prior from the others, never counting your own grades', () => {
    const mine = contribute([g({ key: 'aaaa1' })])
    const theirs = contribute([g({ key: 'bbbb2', grade: 'yes', x: 0 }), g({ key: 'cccc3', partnerId: 4, why: 'dormant' }), g({ key: 'dddd4', why: 'lopsided', ask: 2, v: 2 })])
    const clients: Record<string, Contribution> = { me: mine, them: theirs }
    const global = { sum: mine.all.sum + theirs.all.sum + 10, n: mine.all.n + theirs.all.n + 5 }
    const p = priorFor(clients, global, 'me', 2)
    expect(p.clients).toBe(1)
    expect(p.partners[3].n).toBe(theirs.partners[3].n)
    expect(p.partners[3].sum).toBeCloseTo(theirs.partners[3].sum, 12)
    expect(p.partners[3].askCap).toBe(2)
    expect(p.partners[4].dormant).toBe(1)
    // Other leagues' 5 grades stay, ours are taken out of the total.
    expect(p.global.n).toBe(theirs.all.n + 5)
    expect(p.global.sum).toBeCloseTo(theirs.all.sum + 10, 12)
    // A stranger asking sees everyone.
    expect(priorFor(clients, global, undefined, 2).clients).toBe(2)
    // A premium on another price scale is not offered.
    expect(priorFor(clients, global, 'me', 1).partners[3].askCap).toBeNull()
  })
})
