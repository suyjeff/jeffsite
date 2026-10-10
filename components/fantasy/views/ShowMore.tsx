import React, { useRef } from 'react'
import { Button } from '../ui'

/**
 * "Show N more" under a list that grows in batches. It unmounts when the last batch arrives, which would drop
 * focus to the page, so focus moves to the first row it revealed (`rows` picks the list's rows, inside the
 * element just before this button's row).
 */
export const ShowMore = ({ step, left, onMore, rows }: { step: number; left: number; onMore: () => void; rows: string }) => {
  const wrap = useRef<HTMLDivElement>(null)
  const n = Math.min(step, left)
  return (
    <div ref={wrap} className="flex justify-center">
      <Button
        className="max-md:h-11 max-md:w-full"
        onClick={() => {
          const list = wrap.current?.previousElementSibling
          const seen = list?.querySelectorAll(rows).length ?? 0
          onMore()
          requestAnimationFrame(() => {
            const next = list?.querySelectorAll<HTMLElement>(rows)[seen]
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
