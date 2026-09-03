import React from 'react'
import type { TrimmedPlayer } from '../../lib/fantasy/types'
import { PosPill } from './ui'

const injuryTone = (injury: string | null) => {
  if (!injury) return null
  if (/^(IR|Out|PUP|Sus|NA)/i.test(injury)) return 'text-rose-600 dark:text-rose-400'
  return 'text-amber-600 dark:text-amber-400'
}

const PlayerName = ({ player, id, sub }: { player?: TrimmedPlayer; id: string; sub?: React.ReactNode }) => {
  if (!player) return <span className="text-stone-400">{id}</span>
  const tone = injuryTone(player.injury)
  return (
    <span className="flex items-center gap-2 min-w-[180px]">
      <PosPill pos={player.pos} />
      <span className="leading-tight">
        <span className="block tracking-tight">
          {player.name}
          {player.injury && <span className={`ml-1 text-[10px] uppercase ${tone}`}>{player.injury.slice(0, 3)}</span>}
        </span>
        <span className="block text-xs text-stone-400 dark:text-stone-500">
          {player.team ?? 'FA'}
          {sub ? <> · {sub}</> : null}
        </span>
      </span>
    </span>
  )
}

export default PlayerName
