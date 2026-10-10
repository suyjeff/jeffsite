import React from 'react'
import { BulbIcon } from './icons'
import { cx } from './ui'

/**
 * What an insight points at. An insight note says what is worth doing; this goes on the item it is about (a player,
 * a deal, a team) so nobody has to hunt for it. The glyph is the note's own bulb, small, in the same hue, so the two
 * read as a pair; a short `label` can say why when the item alone does not.
 *
 * For a whole table row use `rowClass={(r) => (ids.has(r.id) ? INSIGHT_ROW : '')}` (a 2px rule and a faint tint, set
 * in fantasy.css) and put an <InsightMark /> in one of its cells. For a block outside a table use INSIGHT_ITEM.
 * Mark only what the note names; a note about nothing on screen gets no mark.
 */
export const INSIGHT_ROW = 'ff-insight-row'
export const INSIGHT_ITEM = 'ff-insight-item'

export const InsightMark = ({ label, title, className }: { label?: string; title?: string; className?: string }) => (
  <span
    title={title ?? 'The insight on this page is about this'}
    className={cx('inline-flex shrink-0 items-center gap-1 align-middle', label && 'font-mono text-[10.5px] text-ff-text2', className)}
  >
    {/* The hue is for the glyph (about 3.6:1 on the light tint, past the 3:1 a graphic needs); words stay in the body ink. */}
    <BulbIcon size={14} className="text-[rgb(var(--ff-c4))]" />
    <span className={label ? undefined : 'sr-only'}>{label ?? 'Referenced by the insight'}</span>
  </span>
)
