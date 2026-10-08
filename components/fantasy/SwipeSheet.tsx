import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './ui'

// A phone sheet whose swipe is the browser's own scroll, after React Aria's Sheet
// (react-aria-components, Apache-2.0). The sheet sits in a scroll container two
// screens long with mandatory snapping: one snap rests the sheet on screen, the
// others rest it just off. Dragging is native scrolling, so momentum, flicks and
// rubber-banding behave exactly as the platform does, and content scrolled to its
// edge hands the gesture on to the sheet (scroll chaining). An IntersectionObserver
// reports when the sheet has fully left the screen, and that is the dismissal.

export type SwipeSheetHandle = {
  /** Slide the sheet off screen, then report it dismissed. */
  dismiss: () => void
}

type Side = 'bottom' | 'left'

// iOS Safari paints content behind its toolbar, below what even 100lvh reports, so a
// bottom sheet needs extra travel to leave the screen entirely (React Aria's figure).
const iosSafari = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const SwipeSheet = forwardRef<
  SwipeSheetHandle,
  {
    side: Side
    /** Called once the sheet is off screen, by swipe or by dismiss(). */
    onDismissed: () => void
    /** The overlay's stacking, e.g. "z-50". */
    className?: string
    backdropClassName: string
    panelClassName: string
    panelProps?: React.HTMLAttributes<HTMLDivElement>
    panelRef?: React.Ref<HTMLDivElement>
    children: ReactNode
  }
>(({ side, onDismissed, className, backdropClassName, panelClassName, panelProps, panelRef, children }, ref) => {
  const scroller = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const dismissedRef = useRef(onDismissed)
  dismissedRef.current = onDismissed
  const [pad] = useState(() => (side === 'bottom' && iosSafari() ? 'calc(100lvh - 100svh + 58px)' : '0px'))
  const y = side === 'bottom'
  // The sheet's size along the swipe, kept by a ResizeObserver so scrolling never reads layout.
  const size = useRef(1)
  const fallback = useRef<number>()

  const finish = () => {
    if (done.current) return
    done.current = true
    dismissedRef.current()
  }
  // The two resting positions, in px: on screen, and the far end of travel off it.
  const positions = () => {
    const el = scroller.current!
    const max = y ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    return y ? { open: max, gone: 0 } : { open: 0, gone: max }
  }
  // How much of the sheet is on screen, 0–1, from the scroll position alone.
  const shown = () => {
    const el = scroller.current
    if (!el) return 0
    const at = y ? el.scrollTop - (positions().open - size.current) : size.current - el.scrollLeft
    return Math.max(0, Math.min(1, at / size.current))
  }
  const scrollTo = (to: number, smooth: boolean) => scroller.current?.scrollTo({ [y ? 'top' : 'left']: to, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })

  const dismiss = () => {
    if (done.current || !scroller.current) return
    if (reducedMotion()) return finish()
    scrollTo(positions().gone, true)
    // The observer closes it as it leaves. This covers a browser that never lets it get there, unless
    // the sheet has been grabbed and pulled back meanwhile.
    window.clearTimeout(fallback.current)
    fallback.current = window.setTimeout(() => shown() < 0.05 && finish(), 700)
  }
  useImperativeHandle(ref, () => ({ dismiss }))

  // Mount off screen, then scroll in, so the entrance is the same motion as a swipe.
  useLayoutEffect(() => {
    if (!scroller.current) return
    scrollTo(positions().gone, false)
    const raf = requestAnimationFrame(() => scrollTo(positions().open, true))
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Backdrop follows how much of the sheet shows; a dismissal is the sheet (all but a sliver) gone.
  useEffect(() => {
    const el = scroller.current
    const sheet = panel.current
    if (!el || !sheet) return
    const shade = () => {
      if (backdrop.current) backdrop.current.style.opacity = String(shown())
    }
    const ro = new ResizeObserver(() => {
      size.current = (y ? sheet.offsetHeight : sheet.offsetWidth) || 1
      shade()
    })
    ro.observe(sheet)
    el.addEventListener('scroll', shade, { passive: true })
    let entered = false
    const io = new IntersectionObserver(
      ([entry]) => {
        // Entered once at least 1% has shown, so the first sliver of the entrance never reads as a dismissal.
        entered ||= entry.intersectionRatio >= 0.01
        // Under 1% left on screen counts as gone: a snap can land a fraction of a pixel short of the edge.
        if (entered && entry.intersectionRatio < 0.01) finish()
      },
      // Count the strip behind the iOS toolbar as on screen, so the sheet closes only once truly gone.
      { threshold: [0, 0.01, 1], rootMargin: `0px 0px ${y ? toPx(pad) : 0}px 0px` },
    )
    io.observe(sheet)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', shade)
      io.disconnect()
      window.clearTimeout(fallback.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setPanel = (node: HTMLDivElement | null) => {
    panel.current = node
    if (typeof panelRef === 'function') panelRef(node)
    else if (panelRef) (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }
  const tapOutside = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) dismiss()
  }
  const P = pad
  const marker = (style: React.CSSProperties) => <div aria-hidden style={{ position: 'absolute', pointerEvents: 'none', ...style }} />

  return (
    <div className={cx('fixed inset-0', className)}>
      <div ref={backdrop} className={cx('absolute inset-0', backdropClassName)} style={{ opacity: 0 }} />
      <div
        ref={scroller}
        className="absolute inset-0"
        style={{
          overflowX: y ? 'hidden' : 'auto',
          overflowY: y ? 'auto' : 'hidden',
          scrollSnapType: `${y ? 'y' : 'x'} mandatory`,
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
        }}
      >
        {y ? (
          <div style={{ position: 'relative', height: `calc(200dvh + ${P})` }}>
            {/* Gone: the top of travel. */}
            {marker({ top: 0, left: 0, width: 1, height: '100dvh', scrollSnapAlign: 'start' })}
            <div
              onClick={tapOutside}
              style={{
                position: 'absolute',
                top: `calc(100dvh + ${P})`,
                left: 0,
                width: '100%',
                height: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
              }}
            >
              <div ref={setPanel} {...panelProps} className={cx('relative', panelClassName)}>
                {/* Just gone: the sheet's top at the bottom of the screen, so half the sheet's height decides a slow drag. */}
                {marker({ top: 0, left: 0, width: 1, height: 1, scrollSnapAlign: 'start', scrollMarginTop: `calc(100dvh + ${P})` })}
                {children}
              </div>
            </div>
            {/* Open: the stage fills the screen. */}
            {marker({ top: `calc(100dvh + ${P})`, left: 0, width: 1, height: '100dvh', scrollSnapAlign: 'end' })}
          </div>
        ) : (
          <div style={{ position: 'relative', width: '200vw', height: '100%' }}>
            {/* Open: the stage fills the screen. */}
            {marker({ top: 0, left: 0, width: '100vw', height: 1, scrollSnapAlign: 'start' })}
            <div onClick={tapOutside} style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100%', display: 'flex' }}>
              <div ref={setPanel} {...panelProps} className={cx('relative', panelClassName)}>
                {/* Just gone: the sheet's right edge at the left of the screen. */}
                {marker({ top: 0, right: 0, width: 1, height: 1, scrollSnapAlign: 'end', scrollMarginRight: '100vw' })}
                {children}
              </div>
            </div>
            {/* Gone: the far end of travel. */}
            {marker({ top: 0, left: '100vw', width: '100vw', height: 1, scrollSnapAlign: 'end' })}
          </div>
        )}
      </div>
    </div>
  )
})
SwipeSheet.displayName = 'SwipeSheet'

/** Resolve a CSS length (calc with viewport units) to px by measuring it. */
const toPx = (length: string) => {
  if (length === '0px') return 0
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;top:0;left:0;visibility:hidden;contain:strict;height:${length}`
  document.body.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return px
}

export default SwipeSheet
