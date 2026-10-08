import React from 'react'
import type { TrimmedPlayer } from '../../lib/fantasy/types'
import { useFantasyMaybe } from './FantasyContext'
import { PlayerAvatar, PosTag, cx, isOut, signedPct } from './ui'

const injuryTone = (injury: string | null) => (!injury ? null : isOut(injury) ? 'text-ff-neg' : 'text-ff-warn')

/** Name cell: portrait, position, name with injury tag, and a muted second line. */
const PlayerName = ({
  player,
  id,
  sub,
  avatar = true,
  size = 26,
  className,
}: {
  player?: TrimmedPlayer
  id: string
  sub?: React.ReactNode
  avatar?: boolean
  size?: number
  className?: string
}) => {
  const ctx = useFantasyMaybe()
  const adj = ctx?.adjust.all[id]
  if (!player) return <span className="text-ff-muted">{id}</span>
  const tone = injuryTone(player.injury)
  return (
    <span className={cx('flex min-w-0 items-center gap-2', className)}>
      {avatar ? <PlayerAvatar id={id} player={player} size={size} /> : <PosTag pos={player.pos} />}
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5">
          {ctx ? (
            <button
              type="button"
              onClick={(e) => {
                // A name inside a clickable row opens the player, not the row.
                e.stopPropagation()
                ctx.openPlayer(id)
              }}
              // Rows act on Enter and Space too; the key belongs to the name.
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.stopPropagation()}
              className="truncate text-left text-[13px] tracking-tight text-ff-text decoration-ff-line2 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
              title={`${player.name}: details and your read`}
            >
              {player.name}
            </button>
          ) : (
            <span className="truncate text-[13px] tracking-tight text-ff-text">{player.name}</span>
          )}
          {player.injury && <span className={cx('shrink-0 font-mono text-[9.5px] font-semibold uppercase', tone)}>{player.injury.slice(0, 3)}</span>}
          {adj && (
            <span
              className="shrink-0 font-mono text-[9.5px] font-semibold text-ff-accent"
              title={`Your read: ${signedPct(adj.pct)} on his projection, ${adj.scope === 'week' ? `week ${adj.week} only` : 'every week ahead'}`}
            >
              {signedPct(adj.pct)}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-1.5 text-[11px] text-ff-muted">
          {avatar && <span className="font-mono text-[10px] font-semibold text-ff-text2">{player.pos}</span>}
          <span className="font-mono text-[10px]">{player.team ?? 'FA'}</span>
          {sub ? <span className="truncate">· {sub}</span> : null}
        </span>
      </span>
    </span>
  )
}

export default PlayerName
