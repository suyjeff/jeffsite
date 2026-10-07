import React from 'react'
import type { TrimmedPlayer } from '../../lib/fantasy/types'
import { PlayerAvatar, PosTag, cx } from './ui'

const injuryTone = (injury: string | null) => {
  if (!injury) return null
  if (/^(IR|Out|PUP|Sus|NA)/i.test(injury)) return 'text-ff-neg'
  return 'text-ff-warn'
}

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
  if (!player) return <span className="text-ff-muted">{id}</span>
  const tone = injuryTone(player.injury)
  return (
    // Capped on phones so a long name truncates instead of pushing a table's last column off screen.
    <span className={cx('flex min-w-0 max-w-[150px] items-center gap-2 sm:max-w-[260px]', className)}>
      {avatar ? <PlayerAvatar id={id} player={player} size={size} /> : <PosTag pos={player.pos} />}
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] tracking-tight text-ff-text">{player.name}</span>
          {player.injury && <span className={cx('shrink-0 font-mono text-[9.5px] font-semibold uppercase', tone)}>{player.injury.slice(0, 3)}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-ff-muted">
          {avatar && <span className="font-mono text-[10px] font-semibold text-ff-text2">{player.pos}</span>}
          <span className="font-mono text-[10px]">{player.team ?? 'FA'}</span>
          {sub ? <span className="truncate">· {sub}</span> : null}
        </span>
      </span>
    </span>
  )
}

export default PlayerName
