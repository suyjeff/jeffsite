import React, { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { genieRows, PERSPECTIVE, quadMatrix, Rect, STRIPS, Tilt } from './genie'
import { resumeArt, resumeLines, resumePdf, resumeSize } from './resumeText'

// How long the page takes to come out of the link, and to go back in. Closing is the quicker of the two.
const OPEN_MS = 560
const CLOSE_MS = 430
const FADE_MS = 180
const SETTLE_FROM = 0.35
const SETTLE_EPS = 0.04
// The opening's duration in units of its full-speed time: the linear stretch plus the exponential settle.
const OPEN_SHAPE = 1 - SETTLE_FROM + SETTLE_FROM * Math.log((SETTLE_FROM + SETTLE_EPS) / SETTLE_EPS)
const MAX_TILT = 2.8
// A resting pointer lets the page settle flat, where its text is sharpest to read.
const SETTLE_MS = 1400
// How grey the edge leaning furthest away goes (styles/resume.css draws the same gradients).
const LEAN_ALPHA = 0.05

type Phase = 'closed' | 'opening' | 'open' | 'closing'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let artReady: Promise<void> | null = null
/** Fetch and decode the page art once, so the first frame of the opening already has the resumé on it. */
function loadArt() {
  if (!artReady) {
    const img = new Image()
    img.src = resumeArt
    artReady = img.decode().catch(() => undefined)
  }
  return artReady
}

/** Nudge the page onto whole device pixels; a page sitting on a half pixel is resampled and its type goes soft. */
function snapToPixels(frame: HTMLElement) {
  frame.style.translate = ''
  const r = frame.getBoundingClientRect()
  const d = window.devicePixelRatio || 1
  const dx = Math.round(r.left * d) / d - r.left
  const dy = Math.round(r.top * d) / d - r.top
  if (dx || dy) frame.style.translate = `${dx}px ${dy}px`
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * The footer's Resumé link. A plain click lifts the resumé out of the link onto the page as a sheet of paper;
 * clicking the shade, the close button or Escape sends it back in. Modified clicks (new tab, download) and
 * no-JS visits still get the PDF.
 */
export default function ResumeLink({ className, children }: { className?: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('closed')
  const linkRef = useRef<HTMLAnchorElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const shadeRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const genieRef = useRef<HTMLDivElement>(null)
  const shadeXRef = useRef<HTMLDivElement>(null)
  const shadeYRef = useRef<HTMLDivElement>(null)

  // Animation state lives outside React: the loops write styles straight to the elements.
  const anim = useRef({ t: 1, dir: 0 as -1 | 0 | 1, raf: 0, last: 0, page: null as Rect | null, link: null as Rect | null, tilt: { rx: 0, ry: 0 } as Tilt })
  const tilt = useRef({ rx: 0, ry: 0, trx: 0, try: 0, raf: 0, last: 0, held: false, lag: 110, idle: 0 })
  const downOutside = useRef(false)
  const closedByKey = useRef(false)
  const phaseRef = useRef<Phase>('closed')
  phaseRef.current = phase

  const applyTilt = useCallback((rx: number, ry: number) => {
    const paper = paperRef.current
    if (!paper) return
    paper.style.transform = rx || ry ? `rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)` : ''
    // Light falls from the viewer: whichever edge leans away goes a touch grey.
    if (shadeXRef.current) {
      shadeXRef.current.style.opacity = String(Math.abs(ry) / MAX_TILT)
      shadeXRef.current.dataset.side = ry > 0 ? 'right' : 'left'
    }
    if (shadeYRef.current) {
      shadeYRef.current.style.opacity = String(Math.abs(rx) / MAX_TILT)
      shadeYRef.current.dataset.side = rx < 0 ? 'bottom' : 'top'
    }
  }, [])

  // ---- Genie: one loop drives the strips, the shade and the buttons from a single progress value.

  const buildStrips = useCallback((page: Rect, lean: Tilt) => {
    const host = genieRef.current
    if (!host) return
    host.replaceChildren()
    const h = page.h / STRIPS
    // The strips carry the tilted page's edge shading too, so nothing lightens the moment it starts to close.
    const shade = (to: string, deg: number) =>
      `linear-gradient(to ${to}, rgb(0 0 0 / ${((LEAN_ALPHA * Math.abs(deg)) / MAX_TILT).toFixed(4)}), transparent 75%)`
    const layers = [shade(lean.ry > 0 ? 'left' : 'right', lean.ry), shade(lean.rx < 0 ? 'top' : 'bottom', lean.rx), 'var(--rs-art)']
    for (let i = 0; i < STRIPS; i++) {
      const s = document.createElement('div')
      s.className = 'rs-strip'
      // One spare pixel of page under each strip covers the hairline seam where two strips meet.
      s.style.width = `${page.w}px`
      s.style.height = `${i === STRIPS - 1 ? h : h + 1}px`
      s.style.backgroundImage = layers.join(',')
      s.style.backgroundSize = `${page.w}px ${page.h}px`
      s.style.backgroundPosition = `0 ${-i * h}px`
      host.appendChild(s)
    }
  }, [])

  const render = useCallback((t: number) => {
    const a = anim.current
    const shade = shadeRef.current
    const bar = barRef.current
    const host = genieRef.current
    if (!a.page || !a.link || !host) return
    if (shade) shade.style.opacity = String(1 - Math.min(1, t / 0.8) ** 1.4)
    if (bar) bar.style.opacity = String(Math.max(0, 1 - t * 3))
    // With reduced motion the page stays put and only fades.
    const still = reducedMotion()
    host.style.opacity = String(still ? 1 - t : 1 - Math.max(0, (t - 0.9) / 0.1))
    const rows = genieRows(still ? 0 : t, a.page, a.link, still ? { rx: 0, ry: 0 } : a.tilt)
    const h = a.page.h / STRIPS
    const strips = host.children
    for (let i = 0; i < strips.length; i++) {
      const [tl, tr] = rows[i]
      const [bl, br] = rows[i + 1]
      ;(strips[i] as HTMLElement).style.transform = quadMatrix(a.page.w, h, tl, tr, br, bl)
    }
  }, [])

  const finish = useCallback(
    (opened: boolean) => {
      const a = anim.current
      a.dir = 0
      a.raf = 0
      if (opened) {
        // Hand over from the strips to the real page in the same frame.
        if (paperRef.current) paperRef.current.style.visibility = ''
        if (genieRef.current) genieRef.current.style.display = 'none'
        setPhase('open')
      } else {
        setPhase('closed')
        const link = linkRef.current
        if (link && !reducedMotion()) {
          // The link takes the page in like a dock icon: a small give, then back.
          link.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.35 }, { transform: 'scale(1)' }],
            { duration: 320, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
          )
        }
      }
    },
    [],
  )

  const step = useCallback(
    (now: number) => {
      const a = anim.current
      const dt = Math.min(now - a.last, 50)
      a.last = now
      let rate: number
      if (reducedMotion()) rate = 1 / FADE_MS
      else if (a.dir > 0) rate = 1 / CLOSE_MS
      // Opening runs the close backwards but lands softly: full speed out of the link, then an exponential
      // settle over the last stretch, so the page eases into place instead of stopping dead.
      else rate = (Math.min(1, (a.t + SETTLE_EPS) / SETTLE_FROM) * OPEN_SHAPE) / OPEN_MS
      a.t = Math.min(1, Math.max(0, a.t + a.dir * dt * rate))
      render(a.t)
      if ((a.dir < 0 && a.t <= 0) || (a.dir > 0 && a.t >= 1)) finish(a.dir < 0)
      else a.raf = requestAnimationFrame(step)
    },
    [render, finish],
  )

  const run = useCallback(
    (dir: -1 | 1) => {
      const a = anim.current
      a.dir = dir
      if (paperRef.current) paperRef.current.style.visibility = 'hidden'
      if (genieRef.current) genieRef.current.style.display = ''
      if (!a.raf) {
        a.last = performance.now()
        a.raf = requestAnimationFrame(step)
      }
    },
    [step],
  )

  // ---- Opening and closing.

  const open = useCallback(() => {
    const p = phaseRef.current
    if (p === 'open' || p === 'opening') return
    if (p === 'closing') {
      // Caught on its way back in: turn round from wherever it is.
      setPhase('opening')
      run(-1)
      return
    }
    anim.current.t = 1
    setPhase('opening')
  }, [run])

  const close = useCallback(() => {
    const p = phaseRef.current
    if (p === 'closed' || p === 'closing') return
    const a = anim.current
    if (p === 'open' && frameRef.current && linkRef.current) {
      a.page = rectOf(frameRef.current)
      a.link = rectOf(linkRef.current)
      a.tilt = { rx: tilt.current.rx, ry: tilt.current.ry }
      buildStrips(a.page, a.tilt)
      render(a.t)
    }
    cancelAnimationFrame(tilt.current.raf)
    clearTimeout(tilt.current.idle)
    tilt.current.raf = 0
    setPhase('closing')
    run(1)
  }, [buildStrips, render, run])

  // From the first frame to the last, the page behind stays still. A layout effect, and ahead of the one below,
  // so the scrollbar is gone before the page's resting place is measured.
  const mounted = phase !== 'closed'
  useLayoutEffect(() => {
    if (!mounted) return
    // The site keeps a stable scrollbar gutter (globals.css), which would leave an unshaded strip down the right
    // edge and centre the page off the screen's middle. Swap the gutter for the same width of padding instead.
    const html = document.documentElement
    const gap = window.innerWidth - html.clientWidth
    const prev = { overflow: html.style.overflow, pad: html.style.paddingRight, gutter: html.style.scrollbarGutter }
    html.style.overflow = 'hidden'
    html.style.scrollbarGutter = 'auto'
    if (gap > 0) html.style.paddingRight = `${gap}px`
    const onResize = () => frameRef.current && snapToPixels(frameRef.current)
    window.addEventListener('resize', onResize)
    return () => {
      html.style.overflow = prev.overflow
      html.style.paddingRight = prev.pad
      html.style.scrollbarGutter = prev.gutter
      window.removeEventListener('resize', onResize)
    }
  }, [mounted])

  // While it's up (not on its way back in, when the link must stay clickable to catch it): keep focus inside,
  // and listen for Escape.
  const shown = phase === 'opening' || phase === 'open'
  useEffect(() => {
    if (!shown) return
    const app = document.getElementById('__next')
    app?.setAttribute('inert', '')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closedByKey.current = true
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      app?.removeAttribute('inert')
      document.removeEventListener('keydown', onKey)
    }
  }, [shown, close])

  // The overlay has just mounted for an opening: measure where the page will rest, then play.
  useLayoutEffect(() => {
    if (phase !== 'opening' || anim.current.dir !== 0 || anim.current.t < 1) return
    const frame = frameRef.current
    const link = linkRef.current
    if (!frame || !link) return
    const a = anim.current
    snapToPixels(frame)
    a.page = rectOf(frame)
    a.link = rectOf(link)
    a.tilt = { rx: 0, ry: 0 }
    tilt.current.rx = tilt.current.ry = 0
    applyTilt(0, 0)
    buildStrips(a.page, a.tilt)
    render(1)
    if (paperRef.current) paperRef.current.style.visibility = 'hidden'
    let cancelled = false
    // Wait for the art (it's usually already here from the hover), but never long.
    Promise.race([loadArt(), new Promise((r) => setTimeout(r, 400))]).then(() => {
      if (!cancelled && phaseRef.current === 'opening') run(-1)
    })
    return () => {
      cancelled = true
    }
  }, [phase, applyTilt, buildStrips, render, run])

  // Focus moves into the dialog as it opens and back to the link once it has closed.
  useEffect(() => {
    if (phase === 'opening') rootRef.current?.focus({ preventScroll: true })
    const link = linkRef.current
    if (phase === 'closed' && link && document.activeElement === document.body) {
      link.focus({ preventScroll: true })
      // Focus goes back to the link either way, but its ring is for someone who closed from the keyboard.
      // Browsers guess differently about programmatic focus, so hide the ring explicitly until a key is pressed.
      if (!closedByKey.current) {
        link.dataset.quietFocus = ''
        const clear = () => {
          delete link.dataset.quietFocus
          link.removeEventListener('blur', clear)
          document.removeEventListener('keydown', clear)
        }
        link.addEventListener('blur', clear)
        document.addEventListener('keydown', clear)
      }
    }
  }, [phase])

  useEffect(
    () => () => {
      cancelAnimationFrame(anim.current.raf)
      cancelAnimationFrame(tilt.current.raf)
      clearTimeout(tilt.current.idle)
    },
    [],
  )

  // ---- Tilt: the page turns a few degrees to face the pointer, on a soft spring.

  const tiltStep = useCallback(
    (now: number) => {
      const s = tilt.current
      const dt = Math.min(now - s.last, 50)
      s.last = now
      const k = 1 - Math.exp(-dt / s.lag)
      s.rx += (s.trx - s.rx) * k
      s.ry += (s.try - s.ry) * k
      const settled = Math.abs(s.trx - s.rx) < 0.005 && Math.abs(s.try - s.ry) < 0.005
      if (settled) {
        s.rx = s.trx
        s.ry = s.try
      }
      applyTilt(s.rx, s.ry)
      s.raf = settled ? 0 : requestAnimationFrame(tiltStep)
    },
    [applyTilt],
  )

  const aimTilt = useCallback(
    (trx: number, tryy: number, lag = 110) => {
      const s = tilt.current
      s.lag = lag
      s.trx = trx
      s.try = tryy
      if (!s.raf && phaseRef.current === 'open') {
        s.last = performance.now()
        s.raf = requestAnimationFrame(tiltStep)
      }
    },
    [tiltStep],
  )

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || tilt.current.held || reducedMotion() || !frameRef.current) return
    const r = frameRef.current.getBoundingClientRect()
    const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2 + 120)))
    const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2 + 120)))
    aimTilt(-ny * MAX_TILT, nx * MAX_TILT)
    clearTimeout(tilt.current.idle)
    tilt.current.idle = window.setTimeout(() => aimTilt(0, 0, 420), SETTLE_MS)
  }

  // Once open, pick the tilt up from wherever the pointer already is.
  useEffect(() => {
    if (phase === 'open' && (tilt.current.trx || tilt.current.try)) aimTilt(tilt.current.trx, tilt.current.try)
  }, [phase, aimTilt])

  // ---- Clicks.

  const onLinkClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    loadArt()
    open()
  }

  const isOutside = (target: EventTarget) =>
    !frameRef.current?.contains(target as Node) && !barRef.current?.contains(target as Node)

  const onPointerDown = (e: React.PointerEvent) => {
    downOutside.current = isOutside(e.target)
    // Hold the page still while text is being selected on it.
    tilt.current.held = !downOutside.current
  }
  const onPointerUp = () => {
    tilt.current.held = false
  }
  const onClick = (e: React.MouseEvent) => {
    // Only a click that both starts and ends on the shade closes; a selection dragged off the page does not.
    if (downOutside.current && isOutside(e.target)) {
      closedByKey.current = false
      close()
    }
  }

  const overlay =
    phase === 'closed' ? null : (
      <div
        ref={rootRef}
        className="rs-root"
        role="dialog"
        aria-modal="true"
        aria-label="Resumé"
        tabIndex={-1}
        data-phase={phase}
        onPointerMove={onPointerMove}
        onPointerLeave={() => aimTilt(0, 0)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onClick}
      >
        <div ref={shadeRef} className="rs-shade" style={{ opacity: 0 }} />
        <div className="rs-scroll">
          <div className="rs-stage">
            <div ref={frameRef} className="rs-frame" style={{ perspective: `${PERSPECTIVE}px` }}>
              <div ref={paperRef} className="rs-paper" style={{ visibility: 'hidden' }}>
                <img src={resumeArt} alt="" draggable={false} className="rs-art" />
                <div ref={shadeXRef} className="rs-lean rs-lean-x" style={{ opacity: 0 }} />
                <div ref={shadeYRef} className="rs-lean rs-lean-y" style={{ opacity: 0 }} />
                <svg
                  className="rs-text"
                  viewBox={`0 0 ${resumeSize.width} ${resumeSize.height}`}
                  preserveAspectRatio="none"
                >
                  {resumeLines.map((l, i) => {
                    const text = (
                      <text
                        key={i}
                        x={l.x}
                        y={l.y}
                        fontSize={l.size}
                        textLength={l.w}
                        lengthAdjust="spacingAndGlyphs"
                      >
                        {l.text}
                      </text>
                    )
                    return l.href ? (
                      <a key={i} href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
                        <rect x={l.x - 3} y={l.y - l.size * 1.02} width={l.w + 6} height={l.size * 1.42} rx={3} />
                        {text}
                      </a>
                    ) : (
                      text
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div ref={barRef} className="rs-bar" style={{ opacity: 0 }}>
          <a href={resumePdf} download className="rs-btn">
            Download PDF
          </a>
          <button
            type="button"
            className="rs-btn"
            onClick={(e) => {
              // A keyboard press on a button arrives as a click with no pointer position.
              closedByKey.current = e.detail === 0
              close()
            }}
          >
            Close
          </button>
        </div>
        <div ref={genieRef} className="rs-genie" aria-hidden="true" style={{ ['--rs-art' as string]: `url(${resumeArt})` }} />
      </div>
    )

  return (
    <>
      <a
        ref={linkRef}
        href={resumePdf}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onLinkClick}
        onPointerEnter={loadArt}
        onFocus={loadArt}
        onTouchStart={loadArt}
        aria-haspopup="dialog"
        style={{ display: 'inline-block' }}
      >
        {children}
      </a>
      {overlay && createPortal(overlay, document.body)}
    </>
  )
}
