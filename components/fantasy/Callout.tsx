import React, { type ReactNode } from 'react'
import { BulbIcon, InfoIcon } from './icons'
import { cx } from './ui'

/**
 * Two kinds of note, set apart from the data around them: an insight says what is worth doing, an instruction says
 * how to work the screen. The hue (the fourth series colour for insights, the theme's accent for instructions) goes
 * only on the frame, the tint and the icon; the words stay in the normal inks so they keep full contrast on the tint.
 * An insight is the quieter of the two: a hairline frame and a barely-there tint, so it sits calmly beside the
 * instructions rather than shouting over them.
 */
const KIND = {
  insight: {
    Icon: BulbIcon,
    sr: 'Insight: ',
    edge: 'border-[rgb(var(--ff-c4)/0.25)]',
    wash: 'bg-[rgb(var(--ff-c4)/0.04)]',
    icon: 'text-[rgb(var(--ff-c4))]',
  },
  instruction: {
    Icon: InfoIcon,
    sr: 'How to: ',
    edge: 'border-ff-accent/45',
    wash: 'bg-ff-accent/[0.07]',
    icon: 'text-ff-accent',
  },
}

export const Callout = ({
  kind,
  title,
  children,
  action,
  compact,
  className,
}: {
  kind: keyof typeof KIND
  /** A short lead, on its own line above the text. */
  title?: ReactNode
  children?: ReactNode
  /** A control at the end of the note: a link or a small button that acts on what it says. */
  action?: ReactNode
  /** For inside a panel or sheet that already has its frame: no border and no tint, just the icon before the text. */
  compact?: boolean
  className?: string
}) => {
  const k = KIND[kind]
  return (
    // Muted ink drops just under 4.5:1 on a tint over the light page, so inside a note it steps up to the body ink.
    <div
      role="note"
      className={cx(
        'flex items-start gap-2.5 text-[12.5px] leading-[1.45] text-ff-text2 [&_.text-ff-muted]:text-ff-text2',
        compact ? 'px-3 py-2.5 sm:px-4' : cx('border px-3 py-2', k.edge, k.wash),
        className,
      )}
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
