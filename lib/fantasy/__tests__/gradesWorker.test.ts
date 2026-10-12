import { describe, expect, it } from 'vitest'
import { cleanGrade, clientKey, clientOf, contribute, priorFor, TARGET, type Contribution, type StoredGrade } from '../../../workers/grades/src/aggregate'

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

  it('names a browser by its key, and does not mistake another league for this one', () => {
    expect(clientKey('123', 'abc-1234')).toBe('c:123:abc-1234')
    expect(clientOf('c:123:abc-1234', '123')).toBe('abc-1234')
    expect(clientOf('c:espn:123:abc-1234', 'espn')).toBeNull()
    expect(clientOf('c:espn:123:abc-1234', 'espn:123')).toBe('abc-1234')
    expect(clientOf('c:124:abc-1234', '123')).toBeNull()
  })

  it('builds a prior from the others, never counting your own grades', () => {
    const mine = contribute([g({ key: 'aaaa1' })])
    const theirs = contribute([g({ key: 'bbbb2', grade: 'yes', x: 0 }), g({ key: 'cccc3', partnerId: 4, why: 'dormant' }), g({ key: 'dddd4', why: 'lopsided', ask: 2, v: 2 })])
    const clients: Record<string, Contribution> = { me: mine, them: theirs }
    // Every browser's total by key, this league's two and another league's one.
    const sums = { 'c:9:me': mine.all, 'c:9:them': theirs.all, 'c:8:other': { sum: 10, n: 5 } }
    const p = priorFor(clients, sums, 'me', '9', 2)
    expect(p.clients).toBe(1)
    expect(p.partners[3].n).toBe(theirs.partners[3].n)
    expect(p.partners[3].sum).toBeCloseTo(theirs.partners[3].sum, 12)
    expect(p.partners[3].askCap).toBe(2)
    expect(p.partners[4].dormant).toBe(1)
    // Other browsers' totals stay, yours is taken out.
    expect(p.global.n).toBe(theirs.all.n + 5)
    expect(p.global.sum).toBeCloseTo(theirs.all.sum + 10, 12)
    // A stranger asking sees everyone.
    expect(priorFor(clients, sums, undefined, '9', 2).clients).toBe(2)
    expect(priorFor(clients, sums, undefined, '9', 2).global.n).toBe(mine.all.n + theirs.all.n + 5)
    // A premium on another price scale is not offered.
    expect(priorFor(clients, sums, 'me', '9', 1).partners[3].askCap).toBeNull()
  })
})
