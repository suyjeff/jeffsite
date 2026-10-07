// One trade search per analysis and config, shared by every view that wants it.
// The search takes a few hundred milliseconds; the dashboard widget and the
// Trades page asking for the same thing should pay for it once.

import type { Analysis } from './analysis'
import { findTrades, SUGGESTED_TRADE_CONFIG, type TradeConfig, type TradeIdea } from './trades'
import type { LeagueData } from './useLeagueData'

const cache = new WeakMap<Analysis, Map<string, { ideas: TradeIdea[]; ms: number }>>()

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
  const full = { ...SUGGESTED_TRADE_CONFIG, ...config }
  const key = JSON.stringify(full)
  let byConfig = cache.get(analysis)
  if (!byConfig) cache.set(analysis, (byConfig = new Map()))
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
