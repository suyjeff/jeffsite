import React from 'react'
import { bestFreeAgent as bestFreeAgentIn } from '../../lib/fantasy/moves'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'

/** The best free agent eligible for a slot in a week: who a "waiver fill" actually is. */
export const bestFreeAgent = (data: LeagueData, rosteredBy: Record<string, number>, eligible: string[], week?: number | null) => {
  const h = (week != null ? data.horizon.find((x) => x.week === week) : null) ?? data.horizon[0]
  return h ? bestFreeAgentIn(data.players, rosteredBy, eligible, h.pts) : null
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
