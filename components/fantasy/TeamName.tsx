import React from 'react'
import { useFantasyMaybe } from './FantasyContext'
import { Avatar, cx } from './ui'

/** The league's top team by power: a small mark beside its name wherever it appears, never louder than the name. */
export const TopMark = ({ className }: { className?: string }) => (
  <span title="No. 1 in power" aria-label="No. 1 in power" role="img" className={cx('inline-flex shrink-0 items-center', className)}>
    <svg aria-hidden width="9" height="9" viewBox="0 0 9 9" className="text-ff-accent">
      <path d="M4.5 0.5 8.5 4.5 4.5 8.5 0.5 4.5Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1" />
    </svg>
  </span>
)

/**
 * A manager, the way the app names one everywhere: avatar, team name, your team in the accent, the No. 1 mark,
 * and a click that opens the team's sheet. `plain` renders it as text, for places already inside a control.
 */
const TeamName = ({
  id,
  size = 18,
  avatar = true,
  sub,
  reverse,
  plain,
  className,
}: {
  id: number
  size?: number
  avatar?: boolean
  sub?: React.ReactNode
  /** Avatar on the trailing side, for the right-hand team of a pairing. */
  reverse?: boolean
  plain?: boolean
  className?: string
}) => {
  const ctx = useFantasyMaybe()
  const t = ctx?.analysis.teamById[id]
  if (!t) return <span className="text-ff-muted">#{id}</span>
  const mine = id === ctx?.analysis.myRosterId
  const top = ctx?.analysis.powerById[id]?.rank === 1
  const name = (
    <span className={cx('flex min-w-0 items-center gap-1', reverse && 'flex-row-reverse')}>
      <span className={cx('truncate', mine ? 'text-ff-accent' : 'text-ff-text')}>{t.name}</span>
      {top && <TopMark />}
    </span>
  )
  const body = (
    <>
      {avatar && <Avatar src={t.avatar} name={t.name} size={size} />}
      <span className={cx('min-w-0 leading-tight', reverse && 'text-right')}>
        {name}
        {sub != null && sub !== '' && <span className="block truncate font-mono text-[10.5px] font-normal text-ff-muted">{sub}</span>}
      </span>
    </>
  )
  const cls = cx('inline-flex min-w-0 max-w-full items-center gap-1.5 text-left', reverse && 'flex-row-reverse', className)
  if (plain || !ctx) return <span className={cls}>{body}</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        ctx.openTeam(id)
      }}
      className={cx(cls, 'ff-tn relative rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ff-accent [&:hover_.truncate]:underline [&:hover_.truncate]:underline-offset-2')}
      title={`${t.name}${t.owner && t.owner !== t.name ? ` · @${t.owner}` : ''}: open summary`}
    >
      {body}
    </button>
  )
}

export default TeamName
