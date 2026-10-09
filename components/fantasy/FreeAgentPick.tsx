import React from 'react'
import type { PlayerMap } from '../../lib/fantasy/types'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'

// Free agents by position, best first, for one week's projections. One sort per week's numbers, shared by every
// slot that asks.
const byWeek = new WeakMap<Record<string, number>, Record<string, string[]>>()
const ranked = (players: PlayerMap, rosteredBy: Record<string, number>, pts: Record<string, number>) => {
  let out = byWeek.get(pts)
  if (!out) {
    out = {}
    for (const [id, v] of Object.entries(pts)) {
      const p = players[id]
      if (!p || rosteredBy[id] != null || !(v > 0)) continue
      for (const pos of p.fpos ?? [p.pos]) (out[pos] ??= []).push(id)
    }
    for (const ids of Object.values(out)) ids.sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0))
    byWeek.set(pts, out)
  }
  return out
}

/** The best free agent eligible for a slot in a week: who a "waiver fill" actually is. */
export const bestFreeAgent = (data: LeagueData, rosteredBy: Record<string, number>, eligible: string[], week?: number | null) => {
  const h = (week != null ? data.horizon.find((x) => x.week === week) : null) ?? data.horizon[0]
  if (!h) return null
  const lists = ranked(data.players, rosteredBy, h.pts)
  let best: string | null = null
  for (const pos of eligible) {
    const top = lists[pos]?.[0]
    if (top && (best == null || (h.pts[top] ?? 0) > (h.pts[best] ?? 0))) best = top
  }
  return best
}

export const useFreeAgent = (eligible: string[], week?: number | null) => {
  const { data, analysis } = useFantasy()
  return bestFreeAgent(data, analysis.rosteredBy, eligible, week)
}

/**
 * A lineup slot the model fills from the waiver wire, shown as the player you would pick up: the best free agent
 * eligible for it that week, marked FA. Falls back to plain words when nobody qualifies.
 */
const FreeAgentPick = ({ eligible, week, size = 22, avatar = true }: { eligible: string[]; week?: number | null; size?: number; avatar?: boolean }) => {
  const { data } = useFantasy()
  const id = useFreeAgent(eligible, week)
  if (!id) return <span className="text-ff-muted">waiver pickup</span>
  return <PlayerName player={data.players[id]} id={id} size={size} avatar={avatar} sub={<span className="font-mono text-[10px] text-ff-pos">FA · pick up</span>} />
}

export default FreeAgentPick

/** Just the name, for a tight row: "Surname FA". */
export const FreeAgentName = ({ eligible, week }: { eligible: string[]; week?: number | null }) => {
  const { data } = useFantasy()
  const id = useFreeAgent(eligible, week)
  if (!id) return <>waiver pickup</>
  return (
    <>
      {data.players[id]?.name} <span className="font-mono text-[10px] text-ff-pos">FA</span>
    </>
  )
}
