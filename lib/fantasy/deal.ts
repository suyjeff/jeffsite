// A trade of any shape: two teams or several, players moving in every direction, FAAB moving with them. Each team
// is priced the way the two-team scorer prices one (lib/fantasy/trades): its best lineup week by week before and
// after, with the extra bodies cut; trade value as managers price players (lib/fantasy/currency); and FAAB at a
// discounted, uncertain value.
//
// FAAB in a trade. Managers rarely price waiver money like players: it buys optionality, not points. So a dollar
// counts at a fraction of what it buys on the wire (lib/fantasy/faab), lower still for a team flush with budget and
// higher for one nearly out, which might actually need it. The fraction itself is a guess, so FAAB carries a
// range, from half to one and a half times the middle estimate, and the totals carry it through.

import type { Analysis } from './analysis'
import { faabTradeValue, FAAB_TRADE_CAP, type Faab } from './faab'
import { tradeValue } from './currency'
import { applyTrade, makeHorizonEval, wmean, type Horizon, type TradeTeam, type WaiverFloor } from './trades'
import type { Slot } from './lineup'
import type { PlayerMap } from './types'

export type DealMove = { player: string; from: number; to: number }
export type DealFaab = { from: number; to: number; dollars: number }
export type Deal = { teams: number[]; moves: DealMove[]; faab: DealFaab[] }

export const emptyDeal = (teams: number[]): Deal => ({ teams, moves: [], faab: [] })

export type DealSide = {
  rosterId: number
  receives: string[]
  sends: string[]
  /** Net FAAB in, in dollars (negative: paid out). */
  faab: number
  /** Points per week added to the best lineup, averaged over the horizon, and by week. */
  lineup: number
  perWeek: { week: number; delta: number }[]
  weeksBetter: number
  /** Trade value in minus out, as managers price players (their own drafted players dear, streamers cheap). */
  value: number
  /** What the FAAB is worth to this team, pts/wk: low, middle and high. */
  faabValue: { low: number; mid: number; high: number }
  /** Lineup plus FAAB at its middle value: the number to read first. */
  net: { low: number; mid: number; high: number }
  /** Players this team would cut to stay under the roster limit. */
  cuts: string[]
  /** Roster too big even after cuts, or a player who is not on the team sending him. */
  problems: string[]
}

export type DealRead = { sides: DealSide[]; valid: boolean; weeks: number[] }

/** How much a team cares about FAAB, from 0.35 (flush) to 0.85 (nearly out): the share of its waiver value it counts. */
export const faabCare = (f: Faab, rosterId: number) => {
  const left = (f.remaining[rosterId] ?? 0) / Math.max(1, f.budget)
  return Math.min(0.85, Math.max(0.35, 0.85 - 0.5 * left))
}

export type DealInput = {
  slots: Slot[]
  players: PlayerMap
  horizon: Horizon
  floor: WaiverFloor
  capacity: number
  pts: Record<string, number>
  market: Record<string, number>
  rosters: Record<number, string[]>
  currency?: Analysis['currency']
  faab?: Faab | null
}

/** Price every team in a deal. */
export const readDeal = (deal: Deal, input: DealInput): DealRead => {
  const { slots, players, horizon, floor, capacity, pts, market, rosters, currency, faab } = input
  const ev = makeHorizonEval(slots, players, horizon, floor)
  const weeks = horizon.map((h) => h.week)
  const sides = deal.teams.map((rid): DealSide => {
    const roster = rosters[rid] ?? []
    const receives = deal.moves.filter((m) => m.to === rid).map((m) => m.player)
    const sends = deal.moves.filter((m) => m.from === rid).map((m) => m.player)
    const problems: string[] = []
    for (const id of sends) if (!roster.includes(id)) problems.push(`${players[id]?.name ?? id} is not on this roster`)
    const after = applyTrade(roster, sends, receives, capacity, pts)
    const cuts = roster.filter((id) => !sends.includes(id) && !after.includes(id))
    const base = ev.perWeek(roster)
    const next = ev.perWeek(after)
    const perWeek = weeks.map((week, i) => ({ week, delta: Math.round((next[i] - base[i]) * 100) / 100 }))
    const lineup = Math.round(wmean(perWeek.map((w) => w.delta), ev.weights) * 100) / 100
    const dollars = deal.faab.reduce((a, x) => a + (x.to === rid ? x.dollars : 0) - (x.from === rid ? x.dollars : 0), 0)
    if (faab && deal.faab.some((x) => x.from === rid) && -dollars > (faab.remaining[rid] ?? 0)) problems.push(`only $${faab.remaining[rid] ?? 0} of FAAB left`)
    const care = faab ? faabCare(faab, rid) / 0.6 : 0
    const mid = faab && dollars ? Math.sign(dollars) * Math.min(FAAB_TRADE_CAP, faabTradeValue(faab, Math.abs(dollars)) * care) : 0
    const faabValue = { low: mid * (mid >= 0 ? 0.5 : 1.5), mid, high: mid * (mid >= 0 ? 1.5 : 0.5) }
    return {
      rosterId: rid,
      receives,
      sends,
      faab: dollars,
      lineup,
      perWeek,
      weeksBetter: perWeek.filter((w) => w.delta > 0.05).length,
      value: Math.round((tradeValue(receives, market, currency, true) - tradeValue(sends, market, currency, false)) * 100) / 100,
      faabValue,
      net: { low: lineup + faabValue.low, mid: lineup + faabValue.mid, high: lineup + faabValue.high },
      cuts,
      problems,
    }
  })
  const valid = deal.moves.length + deal.faab.length > 0 && sides.every((s) => !s.problems.length)
  return { sides, valid, weeks }
}

/** Every team in the deal gives something or gets something, and nobody trades with themselves. */
export const tidyDeal = (deal: Deal): Deal => ({
  ...deal,
  moves: deal.moves.filter((m) => m.from !== m.to && deal.teams.includes(m.from) && deal.teams.includes(m.to)),
  faab: deal.faab.filter((x) => x.dollars > 0 && x.from !== x.to && deal.teams.includes(x.from) && deal.teams.includes(x.to)),
})

/** Rosters by team, from the analysis. */
export const rostersOf = (analysis: Analysis) => Object.fromEntries(analysis.teams.map((t: TradeTeam) => [t.rosterId, t.players])) as Record<number, string[]>
