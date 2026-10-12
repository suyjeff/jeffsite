import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptRead } from '../behavior'
import { PRICING_VERSION } from '../currency'
import { applyLessons, ideaKey, learn, type Grades } from '../grades'
import { blendGlobal, blendOffset, hashKey, pending, shareGrades, sharingOn, type SharedPrior } from '../sharedGrades'
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
const posOf = (id: string) => ({ a: 'RB', b: 'WR', c: 'RB', d: 'QB' })[id]
const name = (id: string) => id.toUpperCase()
const prior = (partners: SharedPrior['partners'], global = { sum: 0, n: 0 }): SharedPrior => ({ global, partners, clients: 3 })
const grade = (i: TradeIdea, extra: Partial<Grades[string]> = {}): Grades => ({
  [ideaKey(i)]: { partnerId: i.partnerId, give: i.give, get: i.get, grade: 'no', x: 0.5, ask: 0, at: 1, ...extra },
})

describe('blending shared lessons', () => {
  it('is the old formula with no prior', () => {
    expect(blendOffset(-3, 2)).toBeCloseTo(-3 / 4, 12)
    expect(blendGlobal(-3, 2)).toBeCloseTo(-3 / 8, 12)
    expect(blendGlobal(0, 0)).toBe(0)
  })

  it('learn without a prior matches learn with an empty one', () => {
    const g = grade(idea(3, ['a'], ['b']))
    const base = learn(g, posOf)
    const empty = learn(g, posOf, prior({}))
    expect(empty.partner[3].offset).toBeCloseTo(base.partner[3].offset, 12)
    expect(empty.global).toBeCloseTo(base.global, 12)
    expect(base.shared).toBe(false)
  })

  it('local grades dominate: the shared mean moves a graded team less than it moves a stranger', () => {
    const g: Grades = {}
    for (const get of ['b', 'd', 'a', 'c']) Object.assign(g, grade(idea(3, ['e'], [get])))
    const alone = learn(g, posOf).partner[3].offset
    // Others found the team far more generous than the model said.
    const p = prior({ 3: { sum: 20, n: 10, dormant: 0, untouchable: [], askCap: null }, 7: { sum: 20, n: 10, dormant: 0, untouchable: [], askCap: null } })
    const L = learn(g, posOf, p)
    expect(L.partner[3].offset).toBeGreaterThan(alone)
    // Your own no-way still points down: the shared lift does not flip it.
    expect(L.partner[3].offset).toBeLessThan(0)
    // A team you never graded takes the shared offset, shrunk.
    expect(L.partner[7].offset).toBeGreaterThan(0)
    expect(L.partner[7].offset).toBeLessThan(2)
    expect(L.partner[7].n).toBe(0)
    expect(L.partner[7].shared).toBe(10)
  })

  it('shrinks by count: a thin prior counts for less than a thick one, which saturates', () => {
    const at = (n: number) => blendOffset(0, 0, { sum: 2 * n, n })
    expect(at(1)).toBeLessThan(at(4))
    expect(at(4)).toBeLessThan(at(8))
    expect(at(100)).toBeCloseTo(at(8), 12)
    // However many others, a mean of +2 never counts for more than the mean itself.
    expect(at(1000)).toBeLessThan(2)
  })

  it('shows up in the odds before you have graded anything', () => {
    const p = prior({ 7: { sum: -12, n: 8, dormant: 0, untouchable: [], askCap: null } })
    const out = applyLessons(read(0.5), idea(7, ['a'], ['b']), learn({}, posOf, p), name, posOf)
    expect(out.index).toBeLessThan(read(0.5).index)
    expect(out.signals[0].text).toContain('your league')
    // An empty set of lessons with no prior still changes nothing.
    const r = read(0.5)
    expect(applyLessons(r, idea(7, ['a'], ['b']), learn({}, posOf), name, posOf)).toBe(r)
  })

  it('shared rules are softer than yours and never rule a deal out', () => {
    const p = prior({ 2: { sum: 0, n: 0, dormant: 2, untouchable: ['b'], askCap: 1 } })
    const L = learn({}, posOf, p)
    const out = applyLessons(read(1.5, 2), idea(2, ['c'], ['b']), L, name, posOf)
    expect(out.ruledOut).toBeFalsy()
    expect(out.index).toBeLessThan(read(1.5).index)
    expect(out.signals.map((s) => s.text).join('|')).toMatch(/others in your league.*won't move B/)
    // One browser saying "checked out" is not enough.
    expect(learn({}, posOf, prior({ 2: { sum: 0, n: 0, dormant: 1, untouchable: [], askCap: null } })).sharedDormant[2]).toBeUndefined()
  })

  it('your own lesson of a kind replaces the shared one', () => {
    const i = idea(2, ['a'], ['b'])
    const g = grade(i, { why: 'untouchable', player: 'b' })
    const L = learn(g, posOf, prior({ 2: { sum: 0, n: 0, dormant: 0, untouchable: ['b', 'd'], askCap: null } }))
    expect(L.sharedUntouchable[2]).toEqual(['d'])
    const l2 = learn(grade(i, { why: 'lopsided', ask: 3, v: PRICING_VERSION }), posOf, prior({ 2: { sum: 0, n: 0, dormant: 0, untouchable: [], askCap: 1 } }))
    expect(l2.sharedAskCap[2]).toBeUndefined()
    expect(l2.askCap[2]).toBe(3)
  })
})

describe('sending grades', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does nothing at all when no worker is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_GRADES_URL', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(sharingOn()).toBe(false)
    shareGrades('123', grade(idea(2, ['a'], ['b'])))
    await vi.advanceTimersByTimeAsync(5000)
    expect(f).not.toHaveBeenCalled()
  })

  it('pending sends new and changed grades and removals, with no player names or deal contents', () => {
    const i = idea(2, ['a'], ['b'])
    const g = grade(i, { why: 'untouchable', player: 'b' })
    const { send, remove } = pending(g, { gone: 1 })
    expect(remove).toEqual(['gone'])
    expect(send).toHaveLength(1)
    expect(send[0]).toMatchObject({ partnerId: 2, grade: 'no', why: 'untouchable', player: 'b' })
    expect(JSON.stringify(send)).not.toContain('a>b')
    expect(send[0].key).toBe(hashKey(ideaKey(i)))
    // Already sent at this time: nothing to do.
    expect(pending(g, { [hashKey(ideaKey(i))]: 1 })).toEqual({ send: [], remove: [] })
  })

  it('posts after a pause, once, with a stable client id, and remembers what it sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_GRADES_URL', 'https://example.workers.dev/')
    const f = vi.fn(async () => ({ ok: true }) as Response)
    vi.stubGlobal('fetch', f)
    const g = grade(idea(2, ['a'], ['b']))
    shareGrades('123', {})
    shareGrades('123', g)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.workers.dev/grades')
    const body = JSON.parse(init.body as string)
    expect(body.league).toBe('123')
    expect(body.client).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(body.grades).toHaveLength(1)
    // Saving again with nothing new sends nothing.
    shareGrades('123', g)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f).toHaveBeenCalledTimes(1)
    // Un-grading sends a removal under the same client id.
    shareGrades('123', {})
    await vi.advanceTimersByTimeAsync(2000)
    expect(f).toHaveBeenCalledTimes(2)
    const second = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(second.client).toBe(body.client)
    expect(second.remove).toEqual([body.grades[0].key])
  })

  it('keeps unsent grades for next time when the worker is down', async () => {
    vi.stubEnv('NEXT_PUBLIC_FF_GRADES_URL', 'https://example.workers.dev')
    const f = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', f)
    const g = grade(idea(2, ['a'], ['b']))
    shareGrades('123', g)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f).toHaveBeenCalledTimes(1)
    shareGrades('123', g)
    await vi.advanceTimersByTimeAsync(2000)
    expect(f).toHaveBeenCalledTimes(2)
  })
})
