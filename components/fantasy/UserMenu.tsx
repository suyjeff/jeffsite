import React, { useEffect, useId, useRef, useState } from 'react'
import { cx } from './ui'

/** Everything this page has kept in this browser goes: settings, grades, reads, the board, cached data. */
export const startOver = () => {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('ff:')) window.localStorage.removeItem(k)
  } catch {
    // Storage blocked: nothing was kept to begin with.
  }
  window.location.reload()
}

/**
 * Your Sleeper username in the settings rail, as a small menu: switch users, replay the tour, or start over.
 * Remembering you is automatic; this is where you undo it. Starting over asks once more, inline, before it clears.
 */
const UserMenu = ({ username, onSwitch, onTour }: { username: string; onSwitch: () => void; onTour: () => void }) => {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return setConfirm(false)
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const focusOut = (e: FocusEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('focusin', focusOut)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('focusin', focusOut)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  const item = 'flex h-8 w-full items-center px-3 text-left text-[12.5px] text-ff-text2 hover:bg-ff-raised hover:text-ff-text focus-visible:bg-ff-raised'
  const act = (f: () => void) => () => {
    setOpen(false)
    f()
  }

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((x) => !x)}
        className={cx(
          'flex h-7 w-full min-w-0 items-center border bg-ff-panel pl-2 pr-1.5 text-left transition-colors',
          open ? 'border-ff-line2' : 'border-ff-line hover:border-ff-line2',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ff-text" title={`Sleeper user @${username}`}>
          @{username}
        </span>
        <span aria-hidden className={cx('font-mono text-[10px] text-ff-muted motion-safe:transition-transform motion-safe:duration-150', open && 'rotate-180')}>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-menu`}
          role="menu"
          aria-label="Account"
          className="ff-pop absolute bottom-full left-0 z-50 mb-1 w-[232px] border border-ff-line2 bg-ff-panel py-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]"
        >
          {!confirm ? (
            <>
              <button type="button" role="menuitem" className={item} onClick={act(onSwitch)}>
                Switch Sleeper user
              </button>
              <button type="button" role="menuitem" className={item} onClick={act(onTour)}>
                Replay the tour
              </button>
              <div className="my-1 h-px bg-ff-line" role="separator" />
              <button type="button" role="menuitem" className={cx(item, 'text-ff-neg hover:text-ff-neg')} onClick={() => setConfirm(true)}>
                Start over…
              </button>
            </>
          ) : (
            <div className="space-y-2 px-3 py-2" role="group" aria-label="Start over">
              <p className="text-[12px] leading-[1.45] text-ff-text2">Clear everything this browser keeps: your username, settings, trade grades, player reads and dashboard.</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={startOver}
                  className="h-7 flex-1 border border-ff-neg/50 bg-ff-neg/10 px-2 text-[12px] font-medium text-ff-neg hover:bg-ff-neg/15"
                >
                  Clear and restart
                </button>
                <button type="button" role="menuitem" onClick={() => setConfirm(false)} className="h-7 border border-ff-line px-2.5 text-[12px] text-ff-text2 hover:bg-ff-raised">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default UserMenu
