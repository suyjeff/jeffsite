// FAAB: what a waiver dollar buys in this league, and what to bid.
//
// Everything is read from the league itself. The going rate is the spread of
// winning bids (this season, or last season's while this one has too few to
// say anything). The exchange rate is dollars paid per point a week of
// rest-of-season value, from the players this season's bids actually bought,
// taking the median so one panic bid does not set the price.
//
// FAAB is a tiebreaker, not a currency to build around: a budget buys free
// agents, and the best free agent is rarely a starter for long. So in trades it
// counts for little and is capped (no amount of it is worth a lineup regular),
// and a bid never exceeds what winning requires: one dollar over the richest
// other team.

import type { Analysis } from './analysis'
import type { LeagueData } from './useLeagueData'

export type FaabBid = { player: string; bid: number; rosterId: number; week: number; season: string }

export type Faab = {
  budget: number
  minBid: number
  /** Dollars left, by roster. */
  remaining: Record<number, number>
  /** Winning bids, this season first. */
  bids: FaabBid[]
  /** Winning-bid spread, in dollars. */
  going: { p50: number; p75: number; p90: number; max: number; n: number; source: 'this season' | 'last season' | 'none' }
  /** Dollars paid per pt/wk of rest-of-season value; `rateN` is 0 when it is the fallback. */
  rate: number
  rateN: number
  /** Regular-season weeks left, and in all. */
  weeksLeft: number
  regularWeeks: number
}

/** Fewest winning bids this season before they speak for the league. */
const MIN_BIDS = 6
/** The most a trade's FAAB can be worth, in pts/wk to the side receiving it. */
export const FAAB_TRADE_CAP = 1.5
/** A FAAB dollar in a trade is optionality, not a player: it counts at this share of what it buys on waivers. */
const FAAB_TRADE_SHARE = 0.6

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo)
}

/** The league's FAAB picture, or null when the league does not use FAAB. */
export const faabState = (data: LeagueData, analysis: Analysis): Faab | null => {
  const s = data.league.settings
  if (s?.waiver_type !== 2 || !s.waiver_budget) return null
  const budget = s.waiver_budget
  const remaining: Record<number, number> = {}
  for (const r of data.rosters) remaining[r.roster_id] = Math.max(0, budget - (r.settings?.waiver_budget_used ?? 0))

  const won = (txs: LeagueData['transactions'], season: string, map?: Record<number, number>): FaabBid[] =>
    txs
      .filter((t) => t.type === 'waiver' && t.status === 'complete' && typeof t.bid === 'number' && t.adds)
      .flatMap((t) => Object.entries(t.adds!).map(([player, rid]) => ({ player, bid: t.bid as number, rosterId: map?.[rid] ?? rid, week: t.leg, season })))
  const now = won(data.transactions, data.league.season)
  const last = data.history ? won(data.history.transactions, data.history.season, data.history.rosterMap) : []
  const sample = now.length >= MIN_BIDS ? now : last.length >= MIN_BIDS ? last : now
  const amounts = sample.map((b) => b.bid).filter((b) => b > 0)
  const going = {
    p50: Math.round(quantile(amounts, 0.5)),
    p75: Math.round(quantile(amounts, 0.75)),
    p90: Math.round(quantile(amounts, 0.9)),
    max: amounts.length ? Math.max(...amounts) : 0,
    n: amounts.length,
    source: (!amounts.length ? 'none' : sample === now ? 'this season' : 'last season') as Faab['going']['source'],
  }

  // Dollars per pt/wk, from what this season's money bought and what those players are worth now.
  const ratios = now
    .map((b) => ({ b: b.bid, v: analysis.market[b.player] }))
    .filter((x) => x.b > 0 && x.v != null && x.v > 0.25)
    .map((x) => x.b / x.v!)
  const fallback = budget / 10
  const rate = ratios.length >= 4 ? Math.min(budget / 4, Math.max(budget / 40, quantile(ratios, 0.5))) : fallback

  const start = s.start_week ?? 1
  const playoffs = s.playoff_week_start ?? 15
  const regularWeeks = Math.max(1, playoffs - start)
  const weeksLeft = Math.max(0, playoffs - (data.state.week ?? start))
  return { budget, minBid: s.waiver_bid_min ?? 0, remaining, bids: [...now, ...last], going, rate, rateN: ratios.length >= 4 ? ratios.length : 0, weeksLeft, regularWeeks }
}

/** What dollars of FAAB are worth in a trade, in pts/wk to the side receiving them: discounted and capped. */
export const faabTradeValue = (f: Faab, dollars: number) => Math.min(FAAB_TRADE_CAP, (FAAB_TRADE_SHARE * dollars) / f.rate)

/**
 * FAAB to add to a trade so it reads as fair to them, or null when FAAB is the
 * wrong tool: the gap is too big for money to close, or it would cost more of
 * your budget than a good free agent does.
 */
export const faabSweetener = (f: Faab, me: number, gap: number) => {
  if (!(gap > 0.15) || gap > FAAB_TRADE_CAP) return null
  const dollars = Math.max(f.minBid || 1, Math.ceil((gap * f.rate) / FAAB_TRADE_SHARE))
  const ceiling = Math.min((f.remaining[me] ?? 0) * 0.3, Math.max(f.going.p75, f.budget * 0.1))
  return dollars <= ceiling ? dollars : null
}

export type BidTier = 'priority' | 'solid' | 'depth' | 'stream'
export type BidAdvice = {
  bid: number
  /** What the league tends to pay for this much value. */
  low: number
  high: number
  tier: BidTier
  /** The case for the number, strongest first, each with its tone. */
  reasons: { text: string; tone: 'pos' | 'neg' | 'warn' | 'neutral' }[]
}

/**
 * A bid for one free agent. Two prices bound it: what the player is worth to
 * you (his gain to your lineup at the league's exchange rate), and what it
 * takes to win him (the league's price for his value, nudged up when Sleeper
 * shows a rush on him). Bid the lower, never more than one dollar over the
 * richest other team (any of them can claim him), and never more than you have.
 */
export const suggestBid = (f: Faab, me: number, input: { gain: number; value: number; trending: number; pos: string }): BidAdvice => {
  const reasons: BidAdvice['reasons'] = []
  const mine = f.remaining[me] ?? 0
  const rich = Math.max(0, ...Object.entries(f.remaining).map(([r, left]) => (Number(r) === me ? 0 : left)))
  const minBid = f.minBid || 0
  const streamer = input.pos === 'K' || input.pos === 'DEF'

  // What the league would pay for this value, with a premium when the whole site is adding him.
  const rush = input.trending >= 20000 ? 1.3 : input.trending >= 5000 ? 1.15 : 1
  const market = Math.max(minBid, input.value * f.rate * rush)
  // What he is worth to you. Late in the season money left over is worth nothing, so it stretches further.
  const late = f.weeksLeft <= 3 ? 1.5 : f.weeksLeft <= 6 ? 1.2 : 1
  const worth = Math.max(0, input.gain) * f.rate * late
  let bid = Math.round(Math.min(worth, market * 1.1))
  if (streamer) bid = minBid
  // The league minimum is a floor only while you can afford it.
  bid = Math.min(mine, Math.max(minBid, Math.min(bid, rich + 1)))
  const broke = mine < Math.max(minBid, 1)

  const tier: BidTier = streamer ? 'stream' : input.gain >= 2 ? 'priority' : input.gain >= 0.75 ? 'solid' : 'depth'
  const low = Math.max(minBid, Math.round(market * 0.8))
  const high = Math.max(low, Math.round(market * 1.25))

  if (broke)
    reasons.push({ text: minBid ? `You have $${mine} left, under the league's $${minBid} minimum bid` : 'You have no FAAB left, so only a $0 bid is possible', tone: 'neg' })
  if (streamer) {
    reasons.push({ text: 'Kickers and defenses change hands weekly: bid the minimum', tone: 'neutral' })
    return { bid, low: Math.min(mine, minBid), high: Math.max(Math.min(mine, minBid), bid), tier, reasons }
  }
  if (f.going.n) reasons.push({ text: `League pays $${low}–${high} for ${signed(input.value)}/wk of value (${f.going.n} winning bids, ${f.going.source})`, tone: 'neutral' })
  reasons.push({ text: `Worth about $${Math.round(worth)} to you: ${signed(input.gain)} pts/wk`, tone: input.gain >= 0.75 ? 'pos' : 'neutral' })
  if (rush > 1) reasons.push({ text: `${input.trending.toLocaleString()} Sleeper adds in the last day: expect competition`, tone: 'warn' })
  if (rich + 1 < Math.min(worth, market * 1.1) && rich + 1 <= mine) reasons.push({ text: `No other team has more than $${rich}, so $${rich + 1} wins outright`, tone: 'pos' })
  if (f.weeksLeft <= 3) reasons.push({ text: `${f.weeksLeft} regular-season weeks left: spend it now`, tone: 'warn' })
  if (bid >= mine && mine > 0 && !broke) reasons.push({ text: `Uses all of your $${mine}`, tone: 'neg' })
  return { bid, low, high, tier, reasons }
}
