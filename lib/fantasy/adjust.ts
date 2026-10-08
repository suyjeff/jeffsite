// Your own read on the news, applied to the numbers.
//
// The models only know what shows up in projections, prop lines and box
// scores. A coach's press conference, a beat writer's hint, a benching for a
// fumble: if you believe it moves a player, nudge him here. The nudge scales
// his projection, and because it is applied to the league data itself, every
// lineup, trade price, playoff simulation and waiver call downstream uses it.
//
// Measured on 2024–25 before deciding to make this manual: when a running
// back's workload swings in one game, about a third of the swing carries into
// the next, and Sleeper's projection already moves by almost exactly that
// much (0.35 per carry or target of change against 0.34 actual). An automatic
// box-score adjustment would double-count it. What projections cannot see is
// the news itself, which is what this is for.

import type { LeagueData } from './useLeagueData'

export type Adjustment = {
  /** Multiplier minus one: −0.25 takes a quarter off. */
  pct: number
  /** One week only, or every week ahead. */
  scope: 'week' | 'season'
  /** The week it was set for; a one-week nudge lapses once that week is past. */
  week: number
}

export type Adjustments = Record<string, Adjustment>

const KEY = (leagueId: string) => `ff:adj:v1:${leagueId}`

export const loadAdjustments = (leagueId: string): Adjustments => {
  try {
    if (typeof window === 'undefined') return {}
    const raw = JSON.parse(window.localStorage.getItem(KEY(leagueId)) ?? '{}') as Adjustments
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export const saveAdjustments = (leagueId: string, adj: Adjustments) => {
  try {
    if (typeof window === 'undefined') return
    if (Object.keys(adj).length) window.localStorage.setItem(KEY(leagueId), JSON.stringify(adj))
    else window.localStorage.removeItem(KEY(leagueId))
  } catch {
    // Private mode or full storage: the nudge lasts for this visit only.
  }
}

/** Nudges still in force: a one-week nudge for a week the horizon has moved past is dropped. */
export const liveAdjustments = (adj: Adjustments, firstWeek: number | null): Adjustments => {
  const out: Adjustments = {}
  for (const [id, a] of Object.entries(adj)) {
    if (!a || typeof a.pct !== 'number' || !a.pct) continue
    if (a.scope === 'week' && firstWeek != null && a.week < firstWeek) continue
    out[id] = a
  }
  return out
}

/** Does this nudge touch this week? */
export const appliesTo = (a: Adjustment, week: number) => (a.scope === 'season' ? week >= a.week : week === a.week)

/**
 * The league data with every nudge applied to the weeks it covers: the
 * adjusted horizon, the coming week's projections, and the raw horizon too,
 * so the gap between raw and adjusted (the injury drag) stays about injuries.
 */
export const applyAdjustments = (data: LeagueData, adj: Adjustments): LeagueData => {
  const ids = Object.keys(adj)
  if (!ids.length) return data
  const scale = (week: number, pts: Record<string, number>) => {
    let out: Record<string, number> | null = null
    for (const id of ids) {
      const a = adj[id]
      if (!appliesTo(a, week) || !(pts[id] > 0)) continue
      out ??= { ...pts }
      out[id] = Math.max(0, pts[id] * (1 + a.pct))
    }
    return out ?? pts
  }
  return {
    ...data,
    horizon: data.horizon.map((h) => ({ ...h, pts: scale(h.week, h.pts) })),
    rawHorizon: data.rawHorizon.map((h) => ({ ...h, pts: scale(h.week, h.pts) })),
    projections: data.projections && data.projectionWeek != null ? scale(data.projectionWeek, data.projections) : data.projections,
  }
}
