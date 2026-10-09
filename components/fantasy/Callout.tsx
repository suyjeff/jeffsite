import React, { type ReactNode } from 'react'
import { BulbIcon, InfoIcon } from './icons'
import { cx } from './ui'

/**
 * Two kinds of note, set apart from the data around them: an insight says what is worth doing, an instruction says
 * how to work the screen. The hue (the fourth series colour for insights, the theme's accent for instructions) goes
 * only on the frame, the tint and the icon; the words stay in the normal inks so they keep full contrast on the tint.
 */
const KIND = {
  insight: {
    Icon: BulbIcon,
    sr: 'Insight: ',
    box: 'border-[rgb(var(--ff-c4)/0.45)] bg-[rgb(var(--ff-c4)/0.08)]',
    icon: 'text-[rgb(var(--ff-c4))]',
  },
  instruction: {
    Icon: InfoIcon,
    sr: 'How to: ',
    box: 'border-ff-accent/45 bg-ff-accent/[0.07]',
    icon: 'text-ff-accent',
  },
}

export const Callout = ({
  kind,
  title,
  children,
  action,
  className,
}: {
  kind: keyof typeof KIND
  /** A short lead, on its own line above the text. */
  title?: ReactNode
  children?: ReactNode
  /** A control at the end of the note: a link or a small button that acts on what it says. */
  action?: ReactNode
  className?: string
}) => {
  const k = KIND[kind]
  return (
    // Muted ink drops just under 4.5:1 on a tint over the light page, so inside a note it steps up to the body ink.
    <div
      role="note"
      className={cx('flex items-start gap-2.5 border px-3 py-2 text-[12.5px] leading-[1.45] text-ff-text2 [&_.text-ff-muted]:text-ff-text2', k.box, className)}
    >
      {/* The icon sits on the first line: 18px of line, 14px of icon. */}
      <k.Icon className={cx('mt-0.5', k.icon)} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <span className="sr-only">{k.sr}</span>
          {title && <div className="font-medium text-ff-text">{title}</div>}
          {children}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
