import { describe, expect, it } from 'vitest'
import type { Consensus } from '../consensus'
import { draftShare, draftValues, REPUTATION, starValue, tradeMarket, tradeValue } from '../currency'
import { startingSlots } from '../lineup'
import { draftBoard } from '../sleeper'
import { findTrades, horizonValues, marketValues, projectedReplacement, valueImbalance, DEFAULT_TRADE_CONFIG, type Horizon } from '../trades'
import type { DraftBoard, PlayerMap } from '../types'

const P = (id: string, pos: string): PlayerMap[string] => ({ id, name: id, pos, fpos: [pos], team: null, status: null, injury: null, age: null, exp: null })
const ROSTER_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN']
const SLOTS = startingSlots(ROSTER_POSITIONS)

const consensusOf = (ranks: Record<string, number>): Consensus => ({
  date: null,
  byId: Object.fromEntries(Object.entries(ranks).map(([id, rank]) => [id, { rank, posRank: null, sd: null, best: null, worst: null, weekRank: null }])),
  matched: Object.keys(ranks).length,
  unmatched: 0,
})

describe('starValue', () => {
  it('is worth its points at the scale, and more per point above it', () => {
    expect(starValue(5)).toBeCloseTo(5)
    expect(starValue(10)).toBeGreaterThan(2 * starValue(5))
    expect(starValue(2)).toBeLessThan(2)
  })
  it('has nothing below replacement', () => {
    expect(starValue(0)).toBe(0)
    expect(starValue(-3)).toBe(0)
  })
  it('prices a star above the parts that add up to his points', () => {
    const market = { star: 10, a: 5, b: 5 }
    expect(tradeValue(['star'], market, undefined, false)).toBeGreaterThan(tradeValue(['a', 'b'], market, undefined, false))
  })
})

describe('tradeMarket', () => {
  // Model values fall one point a rank from 10; the consensus puts s (the model's 8th best) first overall.
  const market: Record<string, number> = {}
  for (let i = 0; i < 10; i++) market[`p${i}`] = 10 - i
  market.s = 2
  const consensus = consensusOf({ s: 1, p0: 2, p1: 3 })

  it('is the model alone when nothing else is known', () => {
    const out = tradeMarket({ market })
    expect(out.p0).toBeCloseTo(10)
    expect(out.s).toBeCloseTo(2)
  })
  it('lifts a player the consensus loves above what his projection says', () => {
    const out = tradeMarket({ market, consensus })
    expect(out.s).toBeGreaterThan(market.s + 2)
    // ... but not all the way: the model keeps its share of the say.
    expect(out.s).toBeLessThan(10)
  })
  it('pulls a player the consensus does not rank no lower than the model reads him', () => {
    const out = tradeMarket({ market, consensus })
    expect(out.p9).toBeCloseTo(market.p9)
  })
  it('never prices a player at zero because one source missed him', () => {
    // No model value at all (no projection), but ranked fourth by the experts: he is read at the experts' price,
    // not at the share of it left after averaging in a zero nobody measured.
    const out = tradeMarket({ market, consensus: consensusOf({ hurt: 4 }) })
    expect(out.hurt).toBeCloseTo(7)
  })
  it('does count a model value of zero or less, which is a reading', () => {
    const out = tradeMarket({ market: { ...market, bench: -3 }, consensus: consensusOf({ bench: 1 }) })
    expect(out.bench).toBeCloseTo((REPUTATION.consensus * 10) / (REPUTATION.model + REPUTATION.consensus))
  })
  it('lets the draft slot count, and count less as the season goes on', () => {
    const draft: DraftBoard = { type: 'snake', rank: { s: 1 }, picks: 1 }
    const early = tradeMarket({ market, draft, weeksPlayed: 0 })
    const late = tradeMarket({ market, draft, weeksPlayed: 12 })
    expect(early.s).toBeGreaterThan(market.s)
    expect(late.s).toBeLessThan(early.s)
    expect(draftShare(0)).toBeCloseTo(REPUTATION.draft)
    expect(draftShare(100)).toBeCloseTo(REPUTATION.draft * 0.25)
  })
  it('reads a draft slot against the market curve', () => {
    const v = draftValues({ type: 'snake', rank: { a: 1, b: 3 }, picks: 2 }, market)
    expect(v.a).toBeCloseTo(10)
    expect(v.b).toBeCloseTo(8)
  })
})

describe('draftBoard', () => {
  const pick = (player_id: string, pick_no: number, amount?: number) => ({ player_id, pick_no, metadata: amount == null ? null : { amount } })
  it('ranks a snake draft by pick number', () => {
    const b = draftBoard([pick('b', 2), pick('a', 1), pick('c', 3)], 'snake')
    expect(b.rank).toEqual({ a: 1, b: 2, c: 3 })
    expect(b.picks).toBe(3)
  })
  it('ranks an auction by the price paid, not the order of nomination', () => {
    const b = draftBoard([pick('a', 1, 5), pick('b', 2, 60), pick('c', 3, 20)], 'auction')
    expect(b.rank).toEqual({ b: 1, c: 2, a: 3 })
  })
  it('falls back to pick order when an auction has no prices', () => {
    expect(draftBoard([pick('a', 1), pick('b', 2)], 'auction').rank).toEqual({ a: 1, b: 2 })
  })
  it('skips picks nobody made', () => {
    expect(draftBoard([{ player_id: null, pick_no: 1 }, pick('a', 2)], 'snake').rank).toEqual({ a: 1 })
  })
})

describe('valueImbalance', () => {
  const cfg = { maxValueAsk: 4, maxValueGive: 3, minReturn: 0.5 }
  it('is zero inside the band', () => {
    expect(valueImbalance(9, 8, cfg)).toBe(0)
    expect(valueImbalance(8, 9, cfg)).toBe(0)
  })
  it('flags asking for too much, and giving away too much', () => {
    expect(valueImbalance(14, 8, cfg)).toBeGreaterThan(0)
    expect(valueImbalance(5, 10, cfg)).toBeGreaterThan(0)
  })
  it('flags a star for nothing even when the gap is inside the absolute cap', () => {
    // 3.5 is under maxValueAsk, but 3.5 for nothing is not an offer.
    expect(valueImbalance(3.5, 0, cfg)).toBeGreaterThan(0)
    expect(valueImbalance(0, 3.5, cfg)).toBeGreaterThan(0)
  })
  it('lets two bench swaps through whatever their ratio', () => {
    expect(valueImbalance(1.2, 0, cfg)).toBe(0)
    expect(valueImbalance(0, 0, cfg)).toBe(0)
  })
  it('turns the share rule off at zero', () => {
    expect(valueImbalance(3.5, 0, { ...cfg, minReturn: 0 })).toBe(0)
  })
  it('lets a raised premium show lowballs without letting a giveaway through', () => {
    const wide = { ...cfg, maxValueAsk: 8 }
    expect(valueImbalance(3.5, 0, wide)).toBe(0)
    expect(valueImbalance(0, 3.5, wide)).toBeGreaterThan(0)
  })
})

// ---------- "Tee Higgins for nothing" ----------

/**
 * B holds a star the projections have written down (hurt, slumping, buried on the depth chart: 8 points
 * a week, on their bench) but the whole league drafted him in the first round and the experts still rank him
 * near the top. By points alone he is a bench body, so by points alone he costs nothing, and every roster
 * that could use a receiver is "offered" him for a spare running back.
 */
const buildStarLeague = () => {
  const players: PlayerMap = {}
  const pts: Record<string, number> = {}
  const add = (id: string, pos: string, v: number) => {
    players[id] = P(id, pos)
    pts[id] = v
  }
  add('a_qb', 'QB', 18)
  add('a_rb1', 'RB', 16)
  add('a_rb2', 'RB', 14)
  add('a_rb3', 'RB', 13)
  add('a_wr1', 'WR', 8)
  add('a_wr2', 'WR', 6)
  add('a_te', 'TE', 9)
  add('a_spare', 'RB', 5)
  add('b_qb', 'QB', 18)
  add('b_wr1', 'WR', 16)
  add('b_wr2', 'WR', 14)
  add('b_wr3', 'WR', 13)
  add('b_rb1', 'RB', 9)
  add('b_rb2', 'RB', 8)
  add('b_te', 'TE', 9)
  add('star', 'WR', 8)
  add('b_scrub', 'WR', 3)
  const horizon: Horizon = [1, 2, 3, 4].map((week) => ({ week, pts }))
  const A = { rosterId: 1, players: ['a_qb', 'a_rb1', 'a_rb2', 'a_rb3', 'a_wr1', 'a_wr2', 'a_te', 'a_spare'] }
  const B = { rosterId: 2, players: ['b_qb', 'b_wr1', 'b_wr2', 'b_wr3', 'b_rb1', 'b_rb2', 'b_te', 'star', 'b_scrub'] }
  const values = horizonValues(horizon)
  const replacement = projectedReplacement(values.perActive, players, ROSTER_POSITIONS, 2)
  const market = marketValues(values.perActive, players, replacement)
  return { players, pts, horizon, A, B, replacement, market }
}

describe('a star the model has written down', () => {
  const { players, pts, horizon, A, B, market, replacement } = buildStarLeague()
  const base = { slots: SLOTS, players, horizon, pts, me: A, others: [B], capacity: 9, floor: replacement }
  const config = { minTheirGain: 0 }
  // The experts rank him fourth overall; the draft took him first.
  const consensus = consensusOf({ b_wr1: 1, b_wr2: 2, a_rb1: 3, star: 4 })
  const draft: DraftBoard = { type: 'snake', rank: { star: 1 }, picks: 1 }
  const priced = tradeMarket({ market, consensus, draft })

  const forStar = (ideas: ReturnType<typeof findTrades>) => ideas.filter((i) => i.get.includes('star'))

  it('is the model alone, with only a cap on asking too much, that sells him for a spare body', () => {
    // The baseline, as the search used to run: the bug this guards against. If this stops holding, the tests below prove nothing.
    const old = { ...config, minReturn: 0, maxValueGive: 99, minWeeksBetter: 0 }
    const cheap = forStar(findTrades({ ...base, tradeMarket: market, config: old })).filter((i) => !i.give.some((id) => ['a_rb1', 'a_rb2', 'a_rb3'].includes(id)))
    expect(cheap.length).toBeGreaterThan(0)
  })

  it('prices him as the room does', () => {
    expect(priced.star).toBeGreaterThan(market.star + 3)
    expect(tradeValue(['star'], priced, undefined, false)).toBeGreaterThan(tradeValue(['a_spare', 'a_wr2'], priced, undefined, false) * 2)
  })

  it('does not suggest paying for him with a spare body', () => {
    for (const idea of forStar(findTrades({ ...base, tradeMarket: priced, config }))) {
      expect(idea.give.every((id) => id === 'a_spare' || id === 'a_wr2' || id === 'a_wr1')).toBe(false)
      expect(idea.valueAsk).toBeLessThanOrEqual(DEFAULT_TRADE_CONFIG.maxValueAsk)
    }
  })

  it('keeps every suggestion inside the fair band, both ways', () => {
    for (const idea of findTrades({ ...base, tradeMarket: priced, config: { ...config, minTheirGain: -50, perPartner: 40 } })) {
      const get = tradeValue(idea.get, priced, undefined, true)
      const give = tradeValue(idea.give, priced, undefined, false)
      expect(valueImbalance(get, give, DEFAULT_TRADE_CONFIG)).toBe(0)
    }
  })

  it('does not suggest giving a star away for a body either', () => {
    // Mirror image: A holds the reputation, B holds a body. Nothing should have A's star leaving for nothing.
    const mirrored = tradeMarket({ market, consensus: consensusOf({ a_rb1: 1, a_rb2: 2 }) })
    for (const idea of findTrades({ ...base, tradeMarket: mirrored, config: { ...config, minTheirGain: -50, perPartner: 40 } })) {
      const give = tradeValue(idea.give, mirrored, undefined, false)
      const get = tradeValue(idea.get, mirrored, undefined, true)
      expect(give - get).toBeLessThanOrEqual(DEFAULT_TRADE_CONFIG.maxValueGive + 1e-9)
    }
  })

  it('drops one-week patches once there are weeks enough to judge by', () => {
    const all = findTrades({ ...base, tradeMarket: priced, config })
    expect(all.length).toBeGreaterThan(0)
    expect(findTrades({ ...base, tradeMarket: priced, config: { ...config, minWeeksBetter: 99 } })).toEqual([])
  })
})
