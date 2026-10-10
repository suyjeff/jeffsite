import React from 'react'
import { BulbIcon } from './icons'
import { cx } from './ui'

/**
 * What an insight points at. An insight note says what is worth doing; this goes beside the name or value it is
 * about (a player, a deal, a team) so nobody has to hunt for it. It is the note's own bulb in the same hue, small and
 * inline like the No. 1 mark on a team name, and never louder than the name it sits by. A short `label` can say why
 * when the item alone does not. Mark only what the note names; a note about nothing on screen gets no mark.
 */
export const InsightMark = ({ label, title, className }: { label?: string; title?: string; className?: string }) => (
  <span
    title={title ?? 'The insight on this page is about this'}
    className={cx('inline-flex shrink-0 items-center gap-1', label && 'font-mono text-[10.5px] text-ff-text2', className)}
  >
    {/* The hue is for the glyph (past the 3:1 a graphic needs on the page in both themes); words stay in the body ink. */}
    <BulbIcon size={12} className="text-[rgb(var(--ff-c4))]" />
    <span className={label ? undefined : 'sr-only'}>{label ?? 'Referenced by the insight'}</span>
  </span>
)
