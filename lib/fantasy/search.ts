// One trade search per analysis and config, shared by every view that wants it.
// The search takes a few hundred milliseconds; the dashboard widget and the
// Trades page asking for the same thing should pay for it once.

import type { Analysis } from './analysis'
import { DEFAULT_TRADE_CONFIG, findTargets, findTrades, SUGGESTED_TRADE_CONFIG, type TradeConfig, type TradeIdea, type TradeTarget } from './trades'
import type { LeagueData } from './useLeagueData'

// Keyed on the market-value table, which keeps its identity across composite
// weight changes (see withWeights) but is rebuilt whenever prices can move.
const cache = new WeakMap<Record<string, number>, Map<string, { ideas: TradeIdea[]; ms: number }>>()

export const tradeBase = (data: LeagueData, analysis: Analysis) => {
  const me = analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  if (!me) return null
  return {
    slots: analysis.slots,
    players: data.players,
    horizon: data.horizon,
    pts: analysis.horizon.perWeek,
    me: { rosterId: me.rosterId, players: me.players },
    capacity: analysis.capacity,
    market: analysis.market,
    floor: analysis.horizonReplacement,
  }
}

export const searchTrades = (data: LeagueData, analysis: Analysis, config: Partial<TradeConfig> = {}) => {
  // The full effective config, so callers that spell out a default share the entry.
  const full: TradeConfig = { ...DEFAULT_TRADE_CONFIG, ...SUGGESTED_TRADE_CONFIG, ...config }
  const key = JSON.stringify(full)
  let byConfig = cache.get(analysis.market)
  if (!byConfig) cache.set(analysis.market, (byConfig = new Map()))
  const hit = byConfig.get(key)
  if (hit) return hit
  const base = tradeBase(data, analysis)
  if (!base) return { ideas: [] as TradeIdea[], ms: 0 }
  const others = analysis.teams.filter((t) => t.rosterId !== analysis.myRosterId).map((t) => ({ rosterId: t.rosterId, players: t.players }))
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const ideas = findTrades({ ...base, others, config: full })
  const out = { ideas, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 }
  byConfig.set(key, out)
  return out
}

/**
 * Free agents who would start for you, best first, with the cut the add
 * forces already priced in. Only the top of the pool by expected points is
 * solved, which is where every useful add lives.
 */
export const waiverTargets = (data: LeagueData, analysis: Analysis, opts: { pool?: number; limit?: number } = {}): TradeTarget[] => {
  if (analysis.myRosterId == null || !data.horizon.length) return []
  const perWeek = analysis.horizon.perWeek
  const fa = Object.keys(perWeek)
    .filter((id) => data.players[id] && analysis.rosteredBy[id] == null)
    .sort((a, b) => perWeek[b] - perWeek[a])
    .slice(0, opts.pool ?? 150)
  const base = tradeBase(data, analysis)
  return base ? findTargets({ ...base, others: [], rosteredBy: analysis.rosteredBy, freeAgents: fa, limit: opts.limit ?? 40 }) : []
}
