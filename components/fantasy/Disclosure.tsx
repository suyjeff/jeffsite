import React, { type ReactNode } from 'react'
import { cx } from './ui'

/**
 * One closed-by-default disclosure for the working and small print behind a page: the part you read once, not
 * each visit. `from="md"` keeps the content plainly on screen from md up and folds it only on phones, where a
 * screen of explanation under the data pushes the data away. `inset` is for use inside a Panel (a top rule, no
 * frame). `className` styles the content, wherever it renders.
 */
export const Disclosure = ({
  summary,
  children,
  from,
  inset,
  defaultOpen,
  className,
}: {
  summary: ReactNode
  children: ReactNode
  from?: 'md'
  inset?: boolean
  defaultOpen?: boolean
  className?: string
}) => (
  <>
    {from === 'md' && <div className={cx('hidden md:block', className)}>{children}</div>}
    <details
      open={defaultOpen}
      className={cx(
        'group',
        inset ? 'border-t border-ff-line' : 'border border-ff-line bg-ff-panel',
        from === 'md' && 'md:hidden',
        // Open and close by animating the height of the content box, where the browser can (it's skipped elsewhere).
        '[interpolate-size:allow-keywords] [&::details-content]:overflow-hidden [&::details-content]:[block-size:0] [&[open]::details-content]:[block-size:auto]',
        'motion-safe:[&::details-content]:[transition:block-size_200ms_var(--ff-ease-drawer),content-visibility_200ms_allow-discrete]',
      )}
    >
      <summary className="ff-label flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 hover:text-ff-text [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        <span aria-hidden className="shrink-0 text-[11px] motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-ff-out group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className={cx('border-t border-ff-line px-3 py-2.5', className)}>{children}</div>
    </details>
  </>
)
