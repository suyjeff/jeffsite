import React, { useRef } from 'react'
import { Button } from '../ui'

/**
 * "Show N more" under a list that grows in batches. It unmounts when the last batch arrives, which would drop
 * focus to the page, so focus moves to the first row it revealed (`rows` picks the list's rows, inside the
 * element just before this button's row). A sorted list adds rows anywhere, not just at the end, so the new row
 * is the first one that was not on the page before the click, not the one at the old length.
 */
export const ShowMore = ({ step, left, onMore, rows, className }: { step: number; left: number; onMore: () => void; rows: string; className?: string }) => {
  const wrap = useRef<HTMLDivElement>(null)
  const n = Math.min(step, left)
  return (
    <div ref={wrap} className={`flex justify-center${className ? ` ${className}` : ''}`}>
      <Button
        className="max-md:h-11 max-md:w-full"
        onClick={() => {
          const list = wrap.current?.previousElementSibling
          // Keyed rows keep their elements when they move, so identity tells old rows from new ones.
          const before = new Set(list?.querySelectorAll(rows))
          onMore()
          requestAnimationFrame(() => {
            const next = Array.from(list?.querySelectorAll<HTMLElement>(rows) ?? []).find((el) => !before.has(el))
            if (!next) return
            if (!next.hasAttribute('tabindex')) next.tabIndex = -1
            next.focus({ preventScroll: true })
          })
        }}
      >
        Show {n} more {left > n && <span className="num text-ff-muted">of {left}</span>}
      </Button>
    </div>
  )
}
