import React, { type ReactNode } from 'react'
import { cx } from './ui'

/**
 * Small print and legends: always on screen from md up; behind a one-line disclosure on phones, where a screen
 * of explanation under the data pushes the data away. `inset` is for use inside a Panel (a top rule, no frame).
 */
export const Note = ({ summary = 'How to read this', children, className, inset }: { summary?: string; children: ReactNode; className?: string; inset?: boolean }) => (
  <>
    <div className={cx('hidden md:block', className)}>{children}</div>
    <details className={cx('group md:hidden', inset ? 'border-t border-ff-line' : 'border border-ff-line bg-ff-panel')}>
      <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-3 font-mono text-[10.5px] uppercase tracking-wider text-ff-muted [&::-webkit-details-marker]:hidden">
        {summary}
        <span aria-hidden className="text-[11px] motion-safe:transition-transform motion-safe:duration-150 group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className={cx('border-t border-ff-line px-3 py-2.5', className)}>{children}</div>
    </details>
  </>
)
