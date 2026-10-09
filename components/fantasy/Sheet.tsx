import React, { useEffect, useRef, type ReactNode } from 'react'
import SwipeSheet, { type SwipeSheetHandle } from './SwipeSheet'
import { cx, usePhone } from './ui'

/**
 * A detail sheet over the page: from the right on wide screens, from the bottom (swipe down to close) on phones.
 * Escape closes it, Tab stays inside, the page behind holds still, and focus returns to where it was. Another
 * sheet opened from inside it stacks on top and keeps its own keys.
 */
const Sheet = ({
  label,
  onClose,
  width = 460,
  children,
}: {
  label: string
  onClose: () => void
  width?: number
  children: (api: { close: () => void; phone: boolean }) => ReactNode
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const phone = usePhone()
  const swipe = useRef<SwipeSheetHandle>(null)
  // Phones slide the sheet away first, then report back.
  const close = useRef(onClose)
  close.current = phone ? () => (swipe.current ? swipe.current.dismiss() : onClose()) : onClose

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    // No scroll on focus: on phones it would cut short the sheet's entrance, which is itself a scroll.
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      // A modal opened over this one (another sheet, the command palette) handles its own keys.
      const t0 = e.target as Element | null
      if (t0 && panel.current && !panel.current.contains(t0) && t0.closest?.('[aria-modal="true"]')) return
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        // In a field, Escape leaves the field; a second press closes.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
          t.blur()
          panel.current?.focus({ preventScroll: true })
        } else close.current()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      )
      if (!focusable.length) return e.preventDefault()
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      } else if (!panel.current.contains(at)) {
        e.preventDefault()
        first.focus()
      }
    }
    // Captured first, so Escape here never also closes a menu or drawer behind.
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      back?.focus?.({ preventScroll: true })
    }
  }, [])

  const dialog = { role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1 } as const
  const body = children({ close: () => close.current(), phone })

  if (phone)
    return (
      <SwipeSheet
        ref={swipe}
        side="bottom"
        className="z-50"
        onDismissed={onClose}
        backdropClassName="bg-black/45"
        panelRef={panel}
        panelProps={dialog}
        panelClassName="flex max-h-[88dvh] w-full flex-col border-t border-ff-line bg-ff-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(0,0,0,0.35)] outline-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 bg-ff-line2" aria-hidden />
        {body}
      </SwipeSheet>
    )

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="ff-fade-in absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={panel}
        {...dialog}
        style={{ width }}
        className="ff-sheet absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-ff-line bg-ff-panel shadow-[-12px_0_40px_rgba(0,0,0,0.3)] outline-none"
      >
        {body}
      </div>
    </div>
  )
}

/** The scrolling body under a sheet's header. On phones it chains its scroll to the sheet, so a swipe down from the top dismisses. */
export const SheetBody = ({ phone, children }: { phone: boolean; children: ReactNode }) => (
  <div className={cx('ff-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]', phone ? 'overscroll-auto' : 'overscroll-contain')}>
    {children}
    <div className="h-4" />
  </div>
)

/** A titled block inside a sheet. */
export const SheetSection = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="border-t border-ff-line px-4 py-3">
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="ff-label">{title}</h3>
      {aside && <span className="font-mono text-[10.5px] text-ff-muted">{aside}</span>}
    </div>
    {children}
  </section>
)

/** The close control at a sheet header's trailing edge. */
export const SheetClose = ({ phone, onClick }: { phone: boolean; onClick: () => void }) => (
  <button onClick={onClick} className="-mr-1 -mt-1 h-8 shrink-0 px-2 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text" aria-label="Close">
    {phone ? 'Close' : 'ESC'}
  </button>
)

export default Sheet
