import { describe, expect, it } from 'vitest'
import type { Analysis } from '../analysis'
import { FAAB_TRADE_CAP, faabState, faabSweetener, faabTradeValue, suggestBid } from '../faab'
import type { LeagueData } from '../useLeagueData'

const bid = (player: string, amount: number, rid: number, leg = 2) => ({ type: 'waiver', status: 'complete', roster_ids: [rid], adds: { [player]: rid }, drops: null, picks: 0, created: leg, leg, bid: amount })

const league = (over: Partial<{ waiver_type: number; used: number[]; txs: ReturnType<typeof bid>[]; week: number }> = {}) =>
  ({
    league: { season: '2026', settings: { waiver_type: over.waiver_type ?? 2, waiver_budget: 200, waiver_bid_min: 1, start_week: 1, playoff_week_start: 15 } },
    rosters: (over.used ?? [100, 20, 0]).map((u, i) => ({ roster_id: i + 1, settings: { waiver_budget_used: u } })),
    transactions: over.txs ?? [bid('a', 40, 1), bid('b', 20, 2), bid('c', 10, 1), bid('d', 5, 3), bid('e', 30, 2), bid('f', 2, 3)],
    history: null,
    state: { week: over.week ?? 5 },
  }) as unknown as LeagueData

const analysis = { market: { a: 4, b: 2, c: 1, d: 0.5, e: 3, f: 0.3 } } as unknown as Analysis

describe('FAAB', () => {
  it('is off for leagues without blind bidding', () => {
    expect(faabState(league({ waiver_type: 0 }), analysis)).toBeNull()
  })

  it('reads budgets, the going rate and the exchange rate from the league', () => {
    const f = faabState(league(), analysis)!
    expect(f.remaining).toEqual({ 1: 100, 2: 180, 3: 200 })
    expect(f.going.n).toBe(6)
    expect(f.going.source).toBe('this season')
    expect(f.going.p50).toBe(15)
    // Every bid here bought $10 per pt/wk.
    expect(f.rate).toBeCloseTo(10, 5)
    expect(f.rateN).toBe(6)
    expect(f.weeksLeft).toBe(10)
  })

  it('never bids past what wins: one dollar over the richest rival', () => {
    const f = faabState(league({ used: [0, 190, 195] }), analysis)!
    const b = suggestBid(f, 1, { gain: 6, value: 5, trending: 0, pos: 'RB', rivals: [2, 3] })
    expect(b.bid).toBe(11)
    expect(b.reasons.some((r) => r.text.includes('wins outright'))).toBe(true)
  })

  it('bids the lower of what he is worth to you and what the league pays, never more than you have', () => {
    const f = faabState(league(), analysis)!
    const small = suggestBid(f, 1, { gain: 0.5, value: 3, trending: 0, pos: 'WR', rivals: [2, 3] })
    expect(small.bid).toBe(5)
    const big = suggestBid(f, 1, { gain: 20, value: 20, trending: 0, pos: 'WR', rivals: [2, 3] })
    expect(big.bid).toBe(100)
  })

  it('bids the minimum on kickers and defenses', () => {
    const f = faabState(league(), analysis)!
    expect(suggestBid(f, 1, { gain: 2, value: 1, trending: 0, pos: 'DEF', rivals: [2, 3] }).bid).toBe(1)
  })

  it('counts FAAB in trades at a discount, capped below a starter', () => {
    const f = faabState(league(), analysis)!
    expect(faabTradeValue(f, 10)).toBeCloseTo(0.6, 5)
    expect(faabTradeValue(f, 200)).toBe(FAAB_TRADE_CAP)
  })

  it('offers FAAB to even a small gap, and not a big one', () => {
    const f = faabState(league(), analysis)!
    expect(faabSweetener(f, 2, 0.6)).toBe(10)
    expect(faabSweetener(f, 2, 0.05)).toBeNull()
    expect(faabSweetener(f, 2, 3)).toBeNull()
  })
})
