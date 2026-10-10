import React, { Children, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TrimmedPlayer } from '../../lib/fantasy/types'
import { ShowMore } from './views/ShowMore'

// ---------- Formatting ----------

export const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(digits))

export const fmtSigned = (n: number | null | undefined, digits = 1) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '–'
  // Anything that rounds to zero at the shown precision is zero: no "-0.0".
  if (Math.abs(n) < 0.5 * 10 ** -digits) return (0).toFixed(digits)
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`
}

export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : `${(n * 100).toFixed(digits)}%`)

/**
 * One of a simulated team's odds, settled by its clinch status: playoffs read
 * it directly; bye, final and title are only ever settled at zero, by elimination.
 */
export const simOdds = (s: { playoffs: number; bye: number; final: number; title: number; clinch: 'in' | 'out' | null } | null | undefined, key: 'playoffs' | 'bye' | 'final' | 'title', digits = 0) =>
  s ? odds(s[key], digits, key === 'playoffs' ? s.clinch : s.clinch === 'out' ? 'out' : null) : '–'

/** A read on a player as a signed percent: −25%, +10%. */
export const signedPct = (p: number) => `${fmtSigned(p * 100, 0)}%`

/**
 * A simulated probability. It never rounds to a certainty the arithmetic has
 * not settled: 99.7% reads ">99%", and 100% or 0% appear only when `settled`
 * says the outcome is decided.
 */
export const odds = (p: number | null | undefined, digits = 0, settled?: 'in' | 'out' | null) => {
  if (p === null || p === undefined || Number.isNaN(p)) return '–'
  if (settled === 'in') return '100%'
  if (settled === 'out') return '0%'
  const unit = 10 ** -digits
  if (p * 100 >= 100 - unit / 2) return `>${(100 - unit).toFixed(digits)}%`
  if (p * 100 < unit / 2) return `<${unit.toFixed(digits)}%`
  return `${(p * 100).toFixed(digits)}%`
}

/** How long ago a timestamp (ms) was, compactly: "40m", "5h", "3d". */
export const ago = (ms: number, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  return m < 60 ? `${m}m` : m < 60 * 24 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

/** 128255 -> 128k, for counts where only the order of magnitude matters. */
export const compact = (n: number) => (n >= 9950 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

// ---------- Text ----------

export const Muted = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('text-ff-muted', className)}>{children}</span>

/** A number set in the mono face, optionally signed and colored by direction. */
export const Num = ({
  value,
  digits = 1,
  signed = false,
  tone,
  suffix,
  className,
}: {
  value: number | null | undefined
  digits?: number
  signed?: boolean
  /** auto: green up, red down. none: ink. */
  tone?: 'auto' | 'none'
  suffix?: ReactNode
  className?: string
}) => {
  const shown = value == null || Number.isNaN(value) ? null : Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value
  const color = (tone ?? (signed ? 'auto' : 'none')) === 'auto' && shown ? (shown > 0 ? 'text-ff-pos' : 'text-ff-neg') : shown === 0 && signed ? 'text-ff-muted' : ''
  return (
    <span className={cx('num', color, className)}>
      {signed ? fmtSigned(value, digits) : fmt(value, digits)}
      {suffix != null && shown != null && <span className="text-ff-muted">{suffix}</span>}
    </span>
  )
}

export const Label = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('ff-label', className)}>{children}</span>

// ---------- Containers ----------

/**
 * The unit of every page: a hairline box with an instrument label. `index`
 * prints a two-digit register number before the title, the way a terminal
 * numbers its panes.
 */
export const Panel = ({
  title,
  actions,
  children,
  className,
  bodyClassName,
  pad = true,
  id,
  index,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  pad?: boolean
  id?: string
  index?: number
}) => (
  <section id={id} className={cx('min-w-0 border border-ff-line bg-ff-panel', className)}>
    {(title || actions) && (
      <header className="flex h-8 items-center justify-between gap-3 border-b border-ff-line px-3">
        <span className="flex min-w-0 items-baseline gap-2">
          {index != null && <span className="num text-[10px] text-ff-muted">{String(index).padStart(2, '0')}</span>}
          {title ? <Label className="truncate text-ff-text2">{title}</Label> : null}
        </span>
        {actions && <div className="ff-panel-actions flex min-w-0 shrink-0 items-center gap-2 font-mono text-[10.5px] text-ff-muted">{actions}</div>}
      </header>
    )}
    <div className={cx(pad && 'p-3', bodyClassName)}>{children}</div>
  </section>
)

/** What a page asks the phone top bar to show in place of its section name, e.g. a team's name on its own page. */
export type PhoneBarSlot = { title: ReactNode; sub?: ReactNode } | null
/** Provided by the shell; `PageHeader` uses it so a page can name itself in the top bar. */
export const PhoneBarContext = createContext<(slot: PhoneBarSlot) => void>(() => {})

/**
 * Page title row plus the page's tabs. Sticks under the mobile top bar.
 *
 * On desktop the title row is the same 44px as the sidebar's wordmark row and
 * shares its bottom rule, so the two read as one header line across the
 * screen.
 *
 * On phones the tab strip is always the first thing under the top bar. The top
 * bar already names the section, so nothing else sits above the tabs:
 * - `mobileTitle` puts the page's own name (and `meta`) in the top bar instead;
 * - otherwise `meta` and `actions` sit in one slim row just below the tabs,
 *   which scrolls away with the page. With no tabs that row is the pinned one.
 * A page whose only action is a link elsewhere should put it in its content.
 */
export const PageHeader = ({
  title,
  meta,
  actions,
  tabs,
  mobileTitle,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  /** On phones, name this page in the top bar (with `meta` beneath), where it otherwise only names the section. */
  mobileTitle?: boolean
}) => {
  const phone = usePhone()
  const setBar = useContext(PhoneBarContext)
  useEffect(() => {
    if (!phone || !mobileTitle) return
    setBar({ title, sub: meta })
    return () => setBar(null)
  })

  const glass = 'bg-ff-bg/90 backdrop-blur supports-[backdrop-filter]:bg-ff-bg/80'
  if (phone) {
    const inBar = !!mobileTitle
    const row = !!actions || (!!meta && !inBar)
    return (
      <>
        {tabs && <div className={cx('ff-pagehead ff-pagetabs ff-bleed ff-gutter sticky top-[var(--ff-top)] z-20', glass)}>{tabs}</div>}
        {row && (
          <div className={cx('ff-pagehead ff-bleed ff-gutter flex min-h-10 items-center justify-between gap-3 py-1', !tabs && cx('sticky top-[var(--ff-top)] z-20', glass))}>
            {meta && !inBar ? <span className="min-w-0 flex-1 font-mono text-[10.5px] text-ff-muted">{meta}</span> : <span />}
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
        )}
      </>
    )
  }
  return (
    <>
      <div className={cx('ff-pagehead ff-bleed z-20 md:sticky md:top-0', glass, !tabs && 'sticky top-[var(--ff-top)]', actions || meta || mobileTitle ? '' : 'hidden md:block')}>
        <div
          className={cx(
            'ff-gutter items-center justify-between gap-3 md:flex md:h-11 md:border-b md:border-ff-line md:group-data-[sidebar=closed]/shell:pl-12 motion-safe:md:transition-[padding] motion-safe:md:duration-[170ms] motion-safe:md:ease-ff-drawer',
            actions || meta || mobileTitle ? 'flex py-2 md:py-0' : 'hidden',
          )}
        >
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="hidden min-w-0 truncate text-[15px] font-medium leading-tight tracking-[-0.01em] text-ff-text md:block">{title}</h1>
            {meta && <span className="min-w-0 truncate font-mono text-[10.5px] text-ff-muted">{meta}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
      {tabs && <div className={cx('ff-pagehead ff-pagetabs ff-bleed ff-gutter sticky top-[var(--ff-top)] z-20 md:top-11', glass)}>{tabs}</div>}
    </>
  )
}

/** Picks a page; `replace` swaps the history entry instead of adding one. */
export type PageChange<K extends string = string> = (k: K, opts?: { replace?: boolean }) => void

export type TabItem<K extends string> = { key: K; label: string; count?: number | null; /** A small mono tag after the label, e.g. "tune". */ mark?: string }

const tabLabel = (t: TabItem<string>) => (
  <>
    {t.label}
    {t.count != null && <span className="num ml-1.5 text-[10.5px] text-ff-muted">{t.count}</span>}
    {t.mark && <span className="ml-1.5 bg-ff-accent/10 px-1 py-px align-[1px] font-mono text-[9.5px] text-ff-accent">{t.mark}</span>}
  </>
)

/** Where each page was scrolled to when it was left, by its place in the URL, so Back lands where the reader was. */
const pageScroll = new Map<string, number>()
/** The route a page belongs to (`trades`, `teams/3`): the hash without the page itself, so each team keeps its own. */
const routeOf = (page: string) => {
  const h = window.location.hash.replace(/^#/, '')
  return h.endsWith(`/${page}`) ? h.slice(0, -page.length - 1) : h
}

/**
 * A page's sub-views, as a strip of tabs. On phones (`stacked`) each tab is a page of its own: a fresh pick starts
 * at the top, Back returns to where the last page was left, and a page the URL asks for that does not exist falls
 * back to the first. The strip scrolls sideways when it is longer than the screen, with the picked tab kept in view.
 */
export const Tabs = <K extends string>({ items, value, onChange, stacked, requested }: { items: TabItem<K>[]; value: K; onChange: PageChange<K>; stacked?: boolean; requested?: string | null }) => {
  const keys = items.map((t) => t.key).join()
  const latest = useRef({ onChange, items })
  latest.current = { onChange, items }

  // If the URL asks for a page that is not in the list (a stale link, or a page that only exists with data, like your
  // lineup), it is rewritten to the first page in place, not as a step to go Back to.
  useEffect(() => {
    if (!stacked) return
    const { items, onChange } = latest.current
    const known = (k: string) => items.some((t) => t.key === k)
    const first = items[0]?.key
    if (first != null && ((requested != null && !known(requested)) || !known(value))) onChange(first, { replace: true })
  }, [stacked, requested, value, keys])

  // A page is a screen of its own: a fresh pick starts at its top, with no scroll animation. Back and Forward
  // (popstate comes just ahead of the hashchange that moves the page) return to where that page was left.
  const shown = useRef(value)
  const at = useRef(0)
  const popped = useRef(0)
  useEffect(() => {
    if (!stacked) return
    const onScroll = () => (at.current = window.scrollY)
    const onPop = () => (popped.current = Date.now())
    at.current = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('popstate', onPop)
    }
  }, [stacked])
  useIsoLayoutEffect(() => {
    if (shown.current === value) return
    const left = shown.current
    shown.current = value
    if (!stacked) return
    // The scroll offset the leaving page had, read from the listener: by now the new page has already shortened or lengthened the document.
    const route = routeOf(value)
    pageScroll.set(`${route}/${left}`, at.current)
    const back = Date.now() - popped.current < 600
    const top = back ? (pageScroll.get(`${route}/${value}`) ?? 0) : 0
    at.current = top
    window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the picked tab in view in a strip that scrolls: centred when it can be, and with no travel on the first paint.
  const activeTab = useRef<HTMLButtonElement | null>(null)
  const painted = useRef(false)
  useIsoLayoutEffect(() => {
    const tab = activeTab.current
    const strip = tab?.parentElement
    if (!stacked || !tab || !strip || strip.scrollWidth <= strip.clientWidth) return
    const calm = !painted.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    painted.current = true
    // Measured against the strip itself, so the page gutter around it never shifts the target.
    const from = strip.scrollLeft + tab.getBoundingClientRect().left - strip.getBoundingClientRect().left
    strip.scrollTo({ left: from - (strip.clientWidth - tab.offsetWidth) / 2, behavior: calm ? 'instant' : 'smooth' } as ScrollToOptions)
  }, [stacked, value, keys])

  return (
    <FadeStrip role="tablist" className="no-scrollbar -mb-px flex overflow-x-auto border-b border-ff-line">
      {items.map((t) => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            ref={active ? activeTab : undefined}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            // A thumb needs 44px; the strip sits under the top bar, so the taller row costs a little page.
            className={cx('relative h-9 shrink-0 px-3 text-[13px] transition-colors first:pl-0.5 max-md:h-11', active ? 'text-ff-text' : 'text-ff-muted hover:text-ff-text')}
          >
            {tabLabel(t)}
            {active && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-ff-text" />}
          </button>
        )
      })}
    </FadeStrip>
  )
}

/**
 * One tab's content: only the picked tab renders, on phones as on wide screens.
 */
export const TabSection = ({
  id,
  active,
  children,
}: {
  id: string
  active: boolean
  children: ReactNode
}) => {
  const phone = usePhone()
  if (!active) return null
  // A phone page replaces the last at once, so it fades up (120ms, opacity only; reduced motion skips it in CSS).
  // Keyed by the tab so each pick plays it. The wrapper takes over the page's `space-y-3`, which no longer reaches
  // the panels inside it; wide screens keep the bare content, so nothing changes there.
  return phone ? (
    <div key={id} className="ff-page-in space-y-3">
      {children}
    </div>
  ) : (
    <>{children}</>
  )
}

export type SegOption<K extends string> = {
  key: K
  label: ReactNode
  title?: string
  /** Replaces the default selected look (bg-ff-text text-ff-panel), for options that carry a tone. */
  activeClassName?: string
}

/** A horizontally scrolling strip that fades its right edge on phones while more sits beyond it. */
export const FadeStrip = ({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setMore(el.scrollWidth - el.scrollLeft - el.clientWidth > 2)
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [])
  return (
    <div ref={ref} {...rest} className={cx(className, more && 'max-md:[mask-image:linear-gradient(to_right,black_88%,transparent)]')}>
      {children}
    </div>
  )
}

/** Same data, a different cut of it. */
export const Segmented = <K extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  block,
  manual,
}: {
  options: SegOption<NoInfer<K>>[]
  value: K
  onChange: (k: NoInfer<K>) => void
  size?: 'sm' | 'md'
  label?: string
  /** Fill the row, splitting it evenly between the options. */
  block?: boolean
  /** Arrows move focus only; Enter or Space picks. For choices that save something (a grade), not a view switch. */
  manual?: boolean
}) => (
  <FadeStrip role="radiogroup" aria-label={label} className={cx('no-scrollbar max-w-full shrink-0 overflow-x-auto border border-ff-line bg-ff-panel', block ? 'flex w-full [&>button]:flex-1' : 'inline-flex')}>
    {options.map((o, i) => {
      const active = o.key === value
      return (
        <button
          key={o.key}
          role="radio"
          aria-checked={active}
          tabIndex={active || (i === 0 && !options.some((x) => x.key === value)) ? 0 : -1}
          title={o.title}
          onClick={() => onChange(o.key)}
          onKeyDown={(e) => {
            // Radio-group keys: arrows move the choice along and take focus with it.
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
            if (!step) return
            e.preventDefault()
            // From the focused option (with nothing picked, the first or last for the direction).
            const at = manual ? i : options.findIndex((x) => x.key === value)
            const next = at < 0 ? (step > 0 ? 0 : options.length - 1) : (at + step + options.length) % options.length
            if (!manual) onChange(options[next].key)
            ;(e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
          }}
          className={cx(
            'min-w-6 shrink-0 whitespace-nowrap border-r border-ff-line transition-colors last:border-r-0',
            size === 'sm' ? 'h-6 px-2 text-[11px] max-md:h-10' : 'h-7 px-2.5 text-[12px] max-md:h-10',
            active ? (o.activeClassName ?? 'bg-ff-text text-ff-panel') : 'text-ff-text2 hover:bg-ff-raised hover:text-ff-text',
          )}
        >
          {o.label}
        </button>
      )
    })}
  </FadeStrip>
)

/** The command palette's shortcut as this platform writes it. */
export const shortcutLabel = () => (typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K')

/** Whether the viewport is phone-width (below md), kept live across rotation and resizing. */
export const usePhone = () => {
  const query = '(max-width: 767px)'
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

// Server render has no layout; the effect only matters in the browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Content that changes with a picker. The new content fades in over 120ms and
 * the box eases from the old height to the new one over 160ms, so switching
 * views never snaps the page around. Reduced motion skips both.
 */
export const Swap = ({ k, children, className }: { k: string; children: ReactNode; className?: string }) => {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const height = useRef<number | null>(null)
  const prev = useRef(k)
  const timer = useRef<number>()
  useEffect(() => {
    const el = box.current
    if (!el) return
    height.current = el.offsetHeight
    // Track the settled height; while a transition holds an inline height, it is not the content's.
    const ro = new ResizeObserver(() => {
      if (!el.style.height) height.current = el.offsetHeight
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(timer.current)
    }
  }, [])
  useIsoLayoutEffect(() => {
    const el = box.current
    if (!el || prev.current === k) return
    prev.current = k
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Children stay mounted (their sort and paging survive); the fade is replayed on the same node.
    inner.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
    // Mid-transition from a quick earlier switch: start from where the box is now, and measure the content free of the pin.
    const from = el.style.height ? el.getBoundingClientRect().height : height.current
    window.clearTimeout(timer.current)
    el.style.transition = ''
    el.style.height = ''
    el.style.overflow = ''
    const to = el.offsetHeight
    if (from == null || Math.abs(from - to) < 2) return
    el.style.height = `${from}px`
    el.style.overflow = 'hidden'
    void el.offsetHeight
    el.style.transition = 'height 160ms var(--ff-ease-out)'
    el.style.height = `${to}px`
    timer.current = window.setTimeout(() => {
      el.style.height = ''
      el.style.overflow = ''
      el.style.transition = ''
      height.current = el.offsetHeight
    }, 200)
  }, [k])
  return (
    <div ref={box} className={className}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

export type DropdownOption = { value: string; label: ReactNode; sub?: ReactNode; disabled?: boolean; /** A heading shown above the first option of each group. */ group?: string; /** Plain text for type-ahead when the label is not a string. */ text?: string; /** A shorter face for the closed button. */ face?: ReactNode }

/**
 * A listbox in the app's own skin: square, hairline, mono caret, a check on
 * the current choice. Keyboard as a native select: arrows move, Enter or Space
 * picks, Escape and Tab close, a letter jumps. Opens upward when there is no
 * room below.
 */
export const Dropdown = ({
  value,
  options,
  onChange,
  label,
  className,
  buttonClassName,
  renderButton,
  menuClassName,
}: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  label: string
  className?: string
  buttonClassName?: string
  /** Custom face for the trigger; gets the current option and whether the list is open. */
  renderButton?: (current: DropdownOption | undefined, open: boolean) => ReactNode
  menuClassName?: string
}) => {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [active, setActive] = useState(0)
  // Whether the active row was last moved by the keyboard. Then it is always lit; a pointer-set one is lit only where hover exists.
  const [kbd, setKbd] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  // Keep the highlighted option in view as the arrows move it.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = (byKey = false) => {
    setKbd(byKey)
    const r = root.current?.getBoundingClientRect()
    if (r) setUp(window.innerHeight - r.bottom < 260 && r.top > window.innerHeight - r.bottom)
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    setOpen(false)
    // A tap on an option would otherwise leave focus on a node that is about to unmount (and so on the page).
    trigger.current?.focus({ preventScroll: true })
    if (o.value !== value) onChange(o.value)
  }
  const step = (d: number) => {
    let i = active
    for (let n = 0; n < options.length; n++) {
      i = (i + d + options.length) % options.length
      if (!options[i].disabled) break
    }
    setKbd(true)
    setActive(i)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        show(true)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      step(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setKbd(true)
      setActive(e.key === 'Home' ? 0 : options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      const text = (o: DropdownOption) => (o.text ?? (typeof o.label === 'string' ? o.label : o.value)).toLowerCase()
      const from = options.findIndex((o, i) => i > active && text(o).startsWith(k))
      const i = from >= 0 ? from : options.findIndex((o) => text(o).startsWith(k))
      if (i >= 0) {
        setKbd(true)
        setActive(i)
      }
    }
  }

  return (
    <div ref={root} className={cx('relative min-w-0', className)}>
      <button
        ref={trigger}
        type="button"
        // A select-only combobox (APG): focus stays here while the arrows move through the list.
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={cx(
          'w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ff-accent/40',
          renderButton ? null : 'flex h-8 items-center border border-ff-line bg-ff-panel text-[12.5px] text-ff-text hover:border-ff-line2',
          buttonClassName,
        )}
      >
        {renderButton ? (
          renderButton(current, open)
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate pl-2.5 pr-2">{current?.face ?? current?.label ?? '—'}</span>
            <span aria-hidden className="flex h-full w-7 shrink-0 items-center justify-center border-l border-ff-line font-mono text-[10px] text-ff-muted">
              {open ? '▴' : '▾'}
            </span>
          </>
        )}
      </button>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={cx(
            'ff-pop ff-scroll absolute left-0 z-50 max-h-[260px] min-w-full overflow-y-auto overscroll-contain border border-ff-line2 bg-ff-panel py-1 shadow-[0_10px_28px_rgba(0,0,0,0.22)]',
            up ? 'ff-pop-up bottom-full mb-1' : 'top-full mt-1',
            menuClassName,
          )}
        >
          {options.map((o, i) => {
            const selected = o.value === value
            const heading = o.group && o.group !== options[i - 1]?.group ? o.group : null
            return (
              <React.Fragment key={o.value}>
              {heading && (
                <div role="presentation" className="ff-label px-3 pb-1 pt-2 first:pt-1">
                  {heading}
                </div>
              )}
              <div
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                // Touch has no hover: a finger resting on a row would light it up, and the tick already marks the current page.
                onPointerEnter={() => {
                  setKbd(false)
                  if (window.matchMedia('(hover: hover)').matches) setActive(i)
                }}
                onClick={() => pick(i)}
                className={cx(
                  'flex min-h-8 cursor-pointer items-center gap-2 py-1 pl-2 pr-3 text-[12.5px]',
                  i === active && (kbd ? 'bg-ff-raised' : '[@media(hover:hover)]:bg-ff-raised'),
                  o.disabled ? 'cursor-default text-ff-muted' : selected ? 'text-ff-text' : 'text-ff-text2',
                )}
              >
                <span aria-hidden className={cx('w-3 shrink-0 font-mono text-[11px] text-ff-accent', !selected && 'invisible')}>
                  ✓
                </span>
                <span className="min-w-0 leading-tight">
                  <span className={cx('block whitespace-nowrap', selected && 'font-medium')}>{o.label}</span>
                  {o.sub && <span className="block whitespace-nowrap font-mono text-[10.5px] text-ff-muted">{o.sub}</span>}
                </span>
              </div>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The app's dropdown, fed with <option> children like a native select. */
export const Select = ({
  value,
  onChange,
  children,
  className,
  label,
}: {
  value: string | number
  onChange: (v: string) => void
  children: ReactNode
  className?: string
  label: string
}) => {
  const options: DropdownOption[] = Children.toArray(children)
    .filter(isValidElement)
    .map((el) => {
      const p = el.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
      return { value: String(p.value ?? ''), label: p.children, disabled: p.disabled }
    })
  return <Dropdown value={String(value)} options={options} onChange={onChange} label={label} className={cx('inline-block', className)} />
}

export const Button = ({
  children,
  onClick,
  variant = 'outline',
  size = 'md',
  className,
  title,
  type = 'button',
  disabled,
  ...rest
}: {
  children: ReactNode
  onClick?: () => void
  /** aqua: the one action a view exists for (build a trade); primary: a confirming action. */
  variant?: 'outline' | 'ghost' | 'primary' | 'aqua'
  size?: 'sm' | 'md'
  className?: string
  title?: string
  type?: 'button' | 'submit'
  disabled?: boolean
} & React.AriaAttributes & { [K in `data-${string}`]?: string | number | boolean | undefined }) => (
  <button
    {...rest}
    type={type}
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={cx(
      'ff-press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ff-accent/40',
      // Phone targets are 40px; the desktop sizes are for a pointer.
      size === 'sm' ? 'h-7 px-2 text-[11.5px] max-md:h-10' : 'h-8 px-3 text-[12.5px] max-md:h-10',
      variant === 'primary' && 'bg-ff-text text-ff-panel hover:bg-ff-text/85',
      variant === 'aqua' && 'ff-aqua',
      variant === 'outline' && 'border border-ff-line bg-ff-panel text-ff-text hover:border-ff-line2 hover:bg-ff-raised',
      variant === 'ghost' && 'text-ff-muted hover:bg-ff-raised hover:text-ff-text',
      className,
    )}
  >
    {children}
  </button>
)

/**
 * Fills the last row of a hairline grid (cells on a `gap-px` line-coloured background, two columns
 * from `sm`, three from `wide`), so the rules never end in a block of line colour.
 */
export const GridFill = ({ n, wide }: { n: number; wide: 'xl' | '2xl' }) => (
  <>
    {n % 2 === 1 && <div aria-hidden className={cx('hidden bg-ff-panel sm:block', wide === 'xl' ? 'xl:hidden' : '2xl:hidden')} />}
    {n % 3 !== 0 && (
      <div aria-hidden className={cx('hidden bg-ff-panel', wide === 'xl' ? 'xl:block' : '2xl:block', n % 3 === 1 && (wide === 'xl' ? 'xl:col-span-2' : '2xl:col-span-2'))} />
    )}
  </>
)

/**
 * A floating action button for phones, above the tab bar: the one action a page exists for, kept in
 * reach without taking a row of the page. `hidden` fades it out (when its target is already on screen).
 */
export const Fab = ({ children, onClick, hidden, label }: { children: ReactNode; onClick: () => void; hidden?: boolean; label?: string }) => (
  <div
    className={cx(
      'pointer-events-none fixed right-[max(12px,env(safe-area-inset-right))] z-30 md:hidden',
      'bottom-[calc(48px+env(safe-area-inset-bottom)+14px)]',
      // In over 200ms, out over 120ms: the state being entered sets the duration.
      'motion-safe:transition-[opacity,transform] motion-safe:ease-ff-out',
      hidden ? 'translate-y-2 opacity-0 motion-safe:duration-[120ms]' : 'translate-y-0 opacity-100 motion-safe:duration-200',
    )}
  >
    <button type="button" onClick={onClick} aria-label={label} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined} className={cx('ff-aqua ff-aqua-fab', !hidden && 'pointer-events-auto')}>
      {children}
    </button>
  </div>
)

export type PtsKind = 'proj' | 'live' | 'final'

/**
 * A fantasy score, marked by what it is, the same way everywhere: a final score in solid ink; a live one with a
 * small square that pulses; a projection lighter, with a dotted underline (an estimate, not a result). Screen
 * readers hear the kind as a word.
 */
export const Pts = ({ value, kind, digits = 1, className }: { value: number | null | undefined; kind: PtsKind; digits?: number; className?: string }) => (
  <span className={cx('num whitespace-nowrap', kind === 'proj' ? 'ff-proj' : 'text-ff-text', className)} title={kind === 'proj' ? 'Projected' : kind === 'live' ? 'Live: game under way' : 'Final'}>
    {kind === 'live' && <span aria-hidden className="ff-live-dot" />}
    {fmt(value, digits)}
    <span className="sr-only">{kind === 'proj' ? ' projected' : kind === 'live' ? ' so far' : ''}</span>
  </span>
)

/** The key to Pts, for a page that mixes the three. */
export const PtsKey = ({ className }: { className?: string }) => (
  <span className={cx('inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ff-muted', className)}>
    <span className="text-ff-text">12.4 final</span>
    <span className="text-ff-text">
      <span aria-hidden className="ff-live-dot" />
      8.0 live
    </span>
    <span className="ff-proj">14.1 projected</span>
  </span>
)

// ---------- Figures ----------

/** A signed change as a small tinted chip: green up, red down, grey at zero. */
export const DeltaChip = ({ value, digits = 1, suffix, title }: { value: number; digits?: number; suffix?: ReactNode; title?: string }) => {
  const zero = Math.abs(value) < 0.5 * 10 ** -digits
  const tone: Tone = zero ? 'neutral' : value > 0 ? 'pos' : 'neg'
  return (
    <span title={title} className={cx('num inline-flex items-center border px-1 py-px text-[11px] leading-none', TONE_CHIP[tone])}>
      {fmtSigned(value, digits)}
      {suffix}
    </span>
  )
}

/**
 * A headline figure. The value is the thing; a change rides beside it as a
 * tinted chip, a status (in the playoffs, one spot out) sits under it as a
 * badge, and a probability can carry a hairline meter. The sub line is for
 * context only, in muted text.
 */
export const Stat = ({
  label,
  value,
  delta,
  sub,
  badge,
  meter,
  tone,
  inset,
  className,
}: {
  label: ReactNode
  value: ReactNode
  delta?: ReactNode
  sub?: ReactNode
  badge?: { text: ReactNode; tone: Tone; title?: string }
  /** 0–1: a thin bar under the value, for odds and shares. */
  meter?: number
  tone?: Tone
  /** In a sheet's hairline grid: borderless, on the sheet's 16px inset. */
  inset?: 'sheet'
  className?: string
}) => (
  <div className={cx('min-w-0 bg-ff-panel py-2 sm:py-2.5', inset === 'sheet' ? 'px-4' : 'border border-ff-line px-2.5 sm:px-3', className)}>
    <div className="ff-label sm:truncate">{label}</div>
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cx('num truncate text-[18px] font-medium leading-none tracking-[-0.02em] sm:text-[21px]', tone && tone !== 'neutral' ? TONE_TEXT[tone] : 'text-ff-text')}>{value}</span>
      {delta}
    </div>
    {meter != null && (
      <span className="mt-2 block h-[3px] w-full max-w-[120px] bg-ff-line">
        <span className="block h-full bg-ff-accent" style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }} />
      </span>
    )}
    {badge && (
      <div className="mt-1.5">
        <Chip tone={badge.tone} title={badge.title} className="text-[10.5px] leading-4">
          {badge.text}
        </Chip>
      </div>
    )}
    {sub && <div className="mt-1 text-[10.5px] leading-snug text-ff-muted sm:truncate sm:text-[11px]">{sub}</div>}
  </div>
)

/**
 * KPI row: two across on phones so labels wrap rather than cut off, and a
 * column count that divides the tiles at every width, so the hairline grid
 * never shows an empty cell. An odd tile out on phones spans the row.
 */
export const StatGrid = ({ children, className }: { children: ReactNode; className?: string }) => {
  const n = Children.toArray(children).filter(Boolean).length
  const cols = n % 3 === 0 ? (n >= 6 ? 'sm:grid-cols-3 xl:grid-cols-6' : 'sm:grid-cols-3') : n === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : n === 5 ? 'sm:grid-cols-3 xl:grid-cols-5' : 'sm:grid-cols-3'
  // No empty cells: a short last row's final tile stretches to the edge.
  const fill = n === 5 ? 'sm:max-xl:[&>*:last-child]:col-span-2' : n % 3 === 2 && n !== 2 ? 'sm:[&>*:last-child]:col-span-2' : n % 3 === 1 && n !== 4 ? 'sm:[&>*:last-child]:col-span-3' : null
  return <div className={cx('grid grid-cols-2 gap-px border border-ff-line bg-ff-line [&>*]:border-0', n % 2 === 1 && 'max-sm:[&>*:last-child]:col-span-2', cols, fill, className)}>{children}</div>
}

type Tone = 'neutral' | 'pos' | 'neg' | 'warn' | 'accent'
/** Text colour per tone, for figures; a chip adds a hairline and a wash of the same colour. */
const TONE_TEXT: Record<Tone | 'muted', string> = {
  neutral: 'text-ff-text',
  pos: 'text-ff-pos',
  neg: 'text-ff-neg',
  warn: 'text-ff-warn',
  accent: 'text-ff-accent',
  muted: 'text-ff-muted',
}
const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-ff-line bg-ff-sunken text-ff-text2',
  pos: 'border-ff-pos/25 bg-ff-pos/[0.08] text-ff-pos',
  neg: 'border-ff-neg/25 bg-ff-neg/[0.08] text-ff-neg',
  warn: 'border-ff-warn/30 bg-ff-warn/10 text-ff-warn',
  accent: 'border-ff-accent/25 bg-ff-accent/[0.08] text-ff-accent',
}

const TONE: Record<Tone, string> = {
  neutral: 'bg-ff-sunken text-ff-text2',
  pos: 'bg-ff-pos/10 text-ff-pos',
  neg: 'bg-ff-neg/10 text-ff-neg',
  warn: 'bg-ff-warn/15 text-ff-warn',
  accent: 'bg-ff-accent/10 text-ff-accent',
}

/**
 * A number that matters, sized by how much. Three steps, used sparingly:
 *   hero  the one figure a card or view is about (one per view, ideally)
 *   lg    the figures that decide something
 *   md    supporting figures
 * Everything else is plain body text, not a Figure. The unit sits small and
 * muted beside the value so the eye lands on the number.
 */
export const Figure = ({
  label,
  value,
  unit,
  sub,
  size = 'md',
  tone,
  title,
  className,
}: {
  label?: ReactNode
  value: ReactNode
  unit?: ReactNode
  sub?: ReactNode
  size?: 'hero' | 'lg' | 'md'
  tone?: 'pos' | 'neg' | 'warn' | 'accent' | 'muted'
  title?: string
  className?: string
}) => (
  <div className={cx('min-w-0', title && 'cursor-help', className)} title={title}>
    {label && <div className="ff-label truncate">{label}</div>}
    <div className={cx('flex items-baseline gap-1', label && (size === 'hero' ? 'mt-1' : 'mt-0.5'))}>
      <span
        className={cx(
          'num leading-none',
          size === 'hero' ? 'text-[26px] font-medium tracking-[-0.03em]' : size === 'lg' ? 'text-[18px] font-medium tracking-[-0.02em]' : 'text-[14px]',
          tone ? TONE_TEXT[tone] : 'text-ff-text',
        )}
      >
        {value}
      </span>
      {unit && <span className="font-mono text-[10px] text-ff-muted">{unit}</span>}
    </div>
    {sub && <div className="mt-1 truncate text-[11px] leading-snug text-ff-muted">{sub}</div>}
  </div>
)

/** A short tagged fact: a reason for or against, a status, a small count. Tone carries the meaning; text stays readable. */
export const Chip = ({ children, tone = 'neutral', title, className }: { children: ReactNode; tone?: Tone; title?: string; className?: string }) => (
  <span
    title={title}
    className={cx('inline-flex max-w-full items-center gap-1 whitespace-nowrap border px-1.5 py-[1px] text-[11.5px] leading-[18px]', TONE_CHIP[tone], title && 'cursor-help', className)}
  >
    <span className="truncate">{children}</span>
  </span>
)

export const Badge = ({ children, tone = 'neutral', title, className }: { children: ReactNode; tone?: Tone; title?: string; className?: string }) => (
  <span title={title} className={cx('inline-flex items-center whitespace-nowrap px-1.5 font-mono text-[10.5px] leading-[18px]', TONE[tone], title && 'cursor-help', className)}>
    {children}
  </span>
)

/** Legacy name kept for the context chips. */
export const Pill = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) => (
  <Badge tone={tone === 'good' ? 'pos' : tone === 'bad' ? 'neg' : tone}>{children}</Badge>
)

/** Position identity. The tint carries the hue; the text stays in ink. */
const POS_TINT: Record<string, string> = {
  QB: 'bg-ff-s5/20 ring-ff-s5/40',
  RB: 'bg-ff-s3/20 ring-ff-s3/40',
  WR: 'bg-ff-s1/20 ring-ff-s1/40',
  TE: 'bg-ff-s2/20 ring-ff-s2/40',
  DEF: 'bg-ff-s4/20 ring-ff-s4/40',
}
/** A number or formula set in prose: mono, on a faint chip, so it reads as data rather than words. */
export const N = ({ children, tone }: { children: ReactNode; tone?: 'pos' | 'neg' | 'accent' }) => (
  <span className={cx('num whitespace-nowrap bg-ff-sunken px-1 py-px text-[0.92em]', tone === 'pos' ? 'text-ff-pos' : tone === 'neg' ? 'text-ff-neg' : tone === 'accent' ? 'text-ff-accent' : 'text-ff-text')}>{children}</span>
)

/** Injury statuses that mean he does not play: IR, Out, PUP, suspended, not active. */
export const isOut = (injury?: string | null) => !!injury && /^(IR|Out|PUP|Sus|NA)/i.test(injury)

/** Who holds a player, for a detail card: "Free agent", "Your roster", or the team's name. */
export const ownerLabel = (a: { rosteredBy: Record<string, number>; myRosterId: number | null; teamById: Record<number, { name: string } | undefined> }, id: string) => {
  const owner = a.rosteredBy[id]
  return owner === undefined ? 'Free agent' : owner === a.myRosterId ? 'Your roster' : (a.teamById[owner]?.name ?? '—')
}

export const PosTag = ({ pos, className }: { pos: string; className?: string }) => (
  <span
    className={cx(
      'inline-flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded-[1px] font-mono text-[10px] font-semibold text-ff-text ring-1 ring-inset',
      POS_TINT[pos] ?? 'bg-ff-sunken ring-ff-line',
      className,
    )}
  >
    {pos}
  </span>
)
/** Kept for older call sites. */
export const PosPill = PosTag

// ---------- Images ----------

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

const Img = ({ src, alt, size, className, fallback }: { src: string | null; alt: string; size: number; className?: string; fallback: string }) => {
  // Remember which src failed, so a slot reused for another image tries again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === src
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-ff-sunken text-ff-muted ring-1 ring-ff-line', className)} style={{ width: size, height: size }}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} className="h-full w-full object-cover object-top" />
      ) : (
        <span className="font-mono font-medium" style={{ fontSize: Math.max(9, size * 0.36) }}>
          {fallback}
        </span>
      )}
    </span>
  )
}

export const Avatar = ({ src, name, size = 24 }: { src: string | null; name: string; size?: number }) => (
  <Img src={src} alt="" size={size} className="rounded-[2px]" fallback={initials(name).slice(0, 1)} />
)

export const playerImage = (id: string, player?: TrimmedPlayer) =>
  player?.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`

/** Headshot, or the team logo for a defense. */
export const PlayerAvatar = ({ id, player, size = 28, className }: { id: string; player?: TrimmedPlayer; size?: number; className?: string }) => (
  <Img src={playerImage(id, player)} alt="" size={size} className={cx('rounded-[2px]', player?.pos === 'DEF' && 'bg-transparent', className)} fallback={initials(player?.name ?? id)} />
)

// ---------- Small charts ----------

/** Horizontal meter. The track is a lighter step of the fill's own hue. */
export const Meter = ({
  value,
  max,
  width = 64,
  tone = 'accent',
  thin,
  className,
}: {
  value: number
  max: number
  width?: number
  tone?: 'accent' | 'neg' | 'pos'
  /** 4px instead of 6px, for a bar inside a table cell. */
  thin?: boolean
  className?: string
}) => (
  <span
    aria-hidden
    className={cx('inline-block shrink-0 overflow-hidden align-middle', thin ? 'h-1' : 'h-1.5', tone === 'accent' ? 'bg-ff-accent/15' : tone === 'neg' ? 'bg-ff-neg/15' : 'bg-ff-pos/15', className)}
    style={{ width }}
  >
    {/* Scaled, not resized, so a change animates without reflowing the row. */}
    <span
      className={cx('block h-full origin-left transition-transform duration-[240ms] ease-ff-out', tone === 'accent' ? 'bg-ff-accent' : tone === 'neg' ? 'bg-ff-neg' : 'bg-ff-pos')}
      style={{ transform: `scaleX(${Math.max(0, Math.min(1, max ? value / max : 0))})` }}
    />
  </span>
)

/** Two sides' chances as one bar: the first side's share in the first series colour, the rest in the second. */
export const WinBar = ({ p, height = 'h-1.5', className }: { p: number; height?: string; className?: string }) => (
  <span className={cx('flex flex-1 gap-px', height, className)} role="img" aria-label={`Win odds ${pct(p)} to ${pct(1 - p)}`}>
    <span className="h-full bg-ff-s1" style={{ flexBasis: `${p * 100}%` }} />
    <span className="h-full flex-1 bg-ff-s2" />
  </span>
)

/** The shade of a probability cell, as in the seed tables: faint at a few percent, near-solid accent at a certainty. */
export const probShade = (p: number) => (p > 0.004 ? `rgb(var(--ff-accent) / ${Math.min(0.95, 0.1 + p * 1.6).toFixed(2)})` : undefined)

/**
 * A full-size button behind a row or card's content, so the whole row is one click target while names on it stay
 * their own buttons (they sit above it). Content meant to be clickable needs `relative`.
 */
export const RowCover = ({ label, onClick, pressed }: { label: string; onClick: () => void; pressed?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    onClick={onClick}
    className="absolute inset-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ff-accent"
  />
)

/** A bar that grows either way from a centre tick: for values with a natural middle, like 50%. */
export const CenterMeter = ({ value, width = 64 }: { value: number; width?: number }) => {
  const v = Math.max(-1, Math.min(1, value))
  return (
    <span className="relative inline-block h-1.5 shrink-0 bg-ff-accent/15 align-middle" style={{ width }}>
      <span className={cx('absolute top-0 h-1.5', v >= 0 ? 'left-1/2 bg-ff-accent' : 'right-1/2 bg-ff-neg/80')} style={{ width: `${Math.abs(v) * 50}%` }} />
      <span className="absolute -top-0.5 left-1/2 h-2.5 w-px -translate-x-1/2 bg-ff-muted/70" />
    </span>
  )
}

/**
 * Weekly sparkline with a hover readout, an optional baseline, and an optional
 * faded projection line underneath (same weeks, null where there was none), so
 * a week read against what was expected is one glance.
 */
export const Sparkline = ({
  points,
  projected,
  baseline,
  width = 96,
  height = 24,
  labels,
}: {
  points: number[]
  projected?: (number | null | undefined)[]
  baseline?: number
  width?: number
  height?: number
  labels?: string[]
}) => {
  const [hover, setHover] = useState<number | null>(null)
  if (!points.length) return <span className="text-ff-muted">–</span>
  const proj = projected?.some((v) => v != null) ? projected : undefined
  const all = [...points, ...(baseline !== undefined ? [baseline] : []), ...(proj ?? []).filter((v): v is number => v != null)]
  const min = Math.min(...all, 0)
  const max = Math.max(...all, 1)
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 6) + 3)
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const pd = proj ? linePath(proj, x, y) : ''
  const ph = hover !== null ? proj?.[hover] : null
  return (
    <span className="relative inline-block align-middle" onMouseLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        className="block text-ff-accent"
        role="img"
        aria-label={`Weekly points: ${points.map((p, i) => p.toFixed(1) + (proj?.[i] != null ? ` (proj ${proj[i]!.toFixed(1)})` : '')).join(', ')}`}
      >
        {baseline !== undefined && <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} className="stroke-ff-line2" strokeWidth={1} />}
        {pd && <path d={pd} fill="none" className="stroke-ff-muted" strokeOpacity={0.55} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={2.5} fill="currentColor" />
        {points.map((_, i) => (
          <rect key={i} x={x(i) - width / points.length / 2} y={0} width={width / points.length} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && ph != null && <circle cx={x(hover)} cy={y(ph)} r={2.5} className="fill-ff-muted" />}
        {hover !== null && <circle cx={x(hover)} cy={y(points[hover])} r={4} fill="currentColor" className="stroke-ff-panel" strokeWidth={2} />}
      </svg>
      {hover !== null && (
        <span className="pointer-events-none absolute -top-6 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel">
          {labels?.[hover] ?? `Wk ${hover + 1}`} · {points[hover].toFixed(1)}
          {ph != null && <span className="opacity-70"> / proj {ph.toFixed(1)}</span>}
        </span>
      )}
    </span>
  )
}

/** SVG path through the non-null points, breaking the line at each gap. */
export const linePath = (vals: (number | null | undefined)[], x: (i: number) => number, y: (v: number) => number) => {
  let d = ''
  let pen = false
  vals.forEach((v, i) => {
    if (v == null) return void (pen = false)
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

/**
 * Per-week change as diverging columns from a zero line: up in the gain color,
 * down in the loss color, a 2px gap between weeks, and a readout on hover.
 */
export const WeekBars = ({
  weeks,
  height = 34,
  barWidth = 9,
  highlight,
}: {
  weeks: { week: number; value: number }[]
  height?: number
  barWidth?: number
  /** Weeks to mark beneath the axis — the fantasy playoffs, say. */
  highlight?: number[]
}) => {
  const [hover, setHover] = useState<number | null>(null)
  if (!weeks.length) return null
  const maxAbs = Math.max(0.5, ...weeks.map((w) => Math.abs(w.value)))
  const step = barWidth + 2
  const width = weeks.length * step
  const mid = height / 2
  const scale = (mid - 2) / maxAbs
  return (
    <span className="relative inline-block align-middle" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height + 4} role="img" aria-label={weeks.map((w) => `week ${w.week} ${w.value.toFixed(1)}`).join(', ')} className="block">
        <line x1={0} x2={width} y1={mid} y2={mid} className="stroke-ff-line2" strokeWidth={1} />
        {weeks.map((w, i) => {
          const h = Math.max(1, Math.abs(w.value) * scale)
          const up = w.value >= 0
          return (
            <g key={w.week} onMouseEnter={() => setHover(i)}>
              <rect x={i * step} y={0} width={step} height={height + 4} fill="transparent" />
              <rect
                x={i * step + 1}
                y={up ? mid - h : mid}
                width={barWidth}
                height={h}
                rx={1.5}
                className={Math.abs(w.value) < 0.05 ? 'fill-ff-line2' : up ? 'fill-ff-pos' : 'fill-ff-neg'}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {highlight?.includes(w.week) && <rect x={i * step + 1} y={height + 2} width={barWidth} height={2} rx={1} className="fill-ff-accent" />}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <span
          className="pointer-events-none absolute -top-6 z-30 whitespace-nowrap rounded-sm bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel"
          style={{ left: Math.min(hover * step, width - 70) }}
        >
          Wk {weeks[hover].week} · {fmtSigned(weeks[hover].value, 1)}
        </span>
      )}
    </span>
  )
}

// ---------- Inputs ----------

export const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
  defaultValue,
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: ReactNode
  defaultValue?: number
}) => {
  const changed = defaultValue !== undefined && Math.abs(value - defaultValue) > step / 2
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] text-ff-text">{label}</label>
        <span className="flex items-baseline gap-2">
          {changed && (
            <button
              onClick={() => onChange(defaultValue!)}
              className="font-mono text-[10.5px] uppercase tracking-wider text-ff-muted hover:text-ff-accent"
              title={`Reset to ${format ? format(defaultValue!) : defaultValue}`}
            >
              reset
            </button>
          )}
          <span className={cx('num text-[13px]', changed ? 'text-ff-accent' : 'text-ff-text')}>{format ? format(value) : value}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ff-range mt-1 w-full"
        style={{ ['--fill' as string]: `${((value - min) / (max - min || 1)) * 100}%` }}
      />
      {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-ff-muted">{hint}</p>}
    </div>
  )
}

// ---------- Tables ----------

export type Column<T> = {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  sort?: (row: T) => number | string
  render: (row: T) => ReactNode
  title?: string
  className?: string
  /** Keep this column pinned while the table scrolls sideways (first column on phones). */
  sticky?: boolean
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

const HIDE: Record<string, string> = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

/** How many rows of a long table show, and how to ask for more. Made by `usePhoneCap`; `Table` reads it. */
export type RowCap = { limit: number; step: number; more: () => void }

/**
 * A phone gets the top of a long table and asks for more; wider screens get every row. `resetKey` is whatever
 * decides which list this is (a filter, a position): when it changes the list starts over at the first batch.
 * Pass the cap to `Table`, which sorts all the rows before it cuts, so a header sort still finds the true top.
 */
export const usePhoneCap = (step: number, resetKey?: string): RowCap => {
  const phone = usePhone()
  const [extra, setExtra] = useState(0)
  const [key, setKey] = useState(resetKey)
  // Adjusting state during render (not in an effect) so the new list never paints at the old length.
  if (key !== resetKey) {
    setKey(resetKey)
    setExtra(0)
  }
  return { limit: phone ? step + extra : Infinity, step, more: () => setExtra((e) => e + step) }
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  defaultDesc = true,
  rowClass,
  onRowClick,
  empty = 'Nothing here yet.',
  maxHeight,
  dense = false,
  expand,
  canExpand,
  defaultOpen,
  cap,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  /** Show only the first `cap.limit` rows after sorting, with a "Show more" button under the table. */
  cap?: RowCap
  /**
   * The case behind a row, shown beneath it on demand: a toggle opens a full-width band under the
   * row instead of truncating the reasons into a cell. Return null for rows with nothing to add.
   */
  expand?: (row: T) => ReactNode | null
  /**
   * Whether a row has details, answered cheaply. With it, `expand` runs only for open rows; without
   * it, every row's details are built up front to find the ones that are empty.
   */
  canExpand?: (row: T) => boolean
  /** Rows to show open from the start (a prominent note). Each row is opened once; closing it sticks. */
  defaultOpen?: (row: T) => boolean
  defaultSort?: string
  defaultDesc?: boolean
  rowClass?: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  maxHeight?: number
  dense?: boolean
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSort)
  const [desc, setDesc] = useState(defaultDesc)
  // While columns hide past the right edge, a fade says so; it clears once scrolled to the end.
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<Set<string | number>>(() => new Set())
  const offered = useRef(new Set<string | number>())
  useEffect(() => {
    if (!defaultOpen || !expand) return
    const add: (string | number)[] = []
    for (const r of rows) {
      const k = rowKey(r)
      // Marked once it has been opened for you, so a row whose note turns prominent later still gets its turn.
      if (offered.current.has(k) || !defaultOpen(r) || (canExpand && !canExpand(r))) continue
      offered.current.add(k)
      add.push(k)
    }
    if (add.length) setOpen((o) => new Set([...o, ...add]))
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  // The band under an open row spans the visible width, not the table's, so it reads without scrolling sideways.
  const [viewW, setViewW] = useState<number | null>(null)
  // A table wider (or taller) than its box must scroll from the keyboard too, so it joins the tab order (2.1.1).
  const [scrolls, setScrolls] = useState(false)
  const id = useId()
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const check = () => {
      setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
      setViewW(el.clientWidth)
      setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // The table can widen without the scroller resizing (new numbers, late fonts); watch it too.
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', check, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', check)
    }
  }, [rows.length, columns.length])
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sort) return rows
    const s = col.sort
    return [...rows].sort((a, b) => {
      const va = s(a)
      const vb = s(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return desc ? -cmp : cmp
    })
  }, [rows, columns, sortKey, desc])
  const toggle = (c: Column<T>) => {
    if (!c.sort) return
    if (sortKey === c.key) setDesc((d) => !d)
    else {
      setSortKey(c.key)
      setDesc(true)
    }
  }
  const align = (c: Column<T>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')
  // Cut after sorting: sorting a header reorders the whole list, not just the rows that happen to be showing.
  const visible = cap && sorted.length > cap.limit ? sorted.slice(0, cap.limit) : sorted
  const left = sorted.length - visible.length
  const details = !!expand
  const expandable = expand ? visible.filter((r) => (canExpand ? canExpand(r) : expand(r) != null)).map(rowKey) : []
  const hasDetail = new Set(expandable)
  const allOpen = expandable.length > 0 && expandable.every((k) => open.has(k))
  const flip = (k: string | number) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  // With a toggle column first, pinned columns sit just right of it.
  // The expand column is 28px, widened to 40px on phones so the arrow is a thumb's target.
  const pin = details ? 'left-7 max-md:left-10' : 'left-0'
  const span = columns.length + (details ? 1 : 0)
  return (
    <div className="relative">
      {more && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 bg-gradient-to-l from-ff-panel to-transparent" />}
      <div
        ref={scroller}
        tabIndex={scrolls ? 0 : undefined}
        className="ff-scroll overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ff-accent"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              {details && (
                <th className="sticky left-0 z-20 h-8 w-7 border-b max-md:w-10 border-ff-line bg-ff-panel p-0">
                  {expandable.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpen(allOpen ? new Set() : new Set(expandable))}
                      aria-label={allOpen ? 'Collapse all rows' : 'Expand all rows'}
                      title={allOpen ? 'Collapse all' : 'Expand all'}
                      className="flex h-8 w-7 items-center justify-center font-mono text-[10px] text-ff-muted hover:text-ff-text max-md:w-10"
                    >
                      <span className={cx('inline-block motion-safe:transition-transform motion-safe:duration-150', allOpen && 'rotate-90')}>›</span>
                    </button>
                  )}
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  onClick={() => toggle(c)}
                  aria-sort={sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined}
                  className={cx(
                    'ff-label h-8 whitespace-nowrap border-b border-ff-line bg-ff-panel px-1.5 font-normal first:pl-2.5 last:pr-2.5 sm:px-2 sm:first:pl-3 sm:last:pr-3',
                    align(c),
                    c.sort && 'cursor-pointer select-none hover:text-ff-text',
                    c.sticky && cx('sticky z-20', pin),
                    c.hideBelow && HIDE[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-0.5 text-ff-text">{desc ? '▾' : '▴'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={span} className="px-3 py-10 text-center text-[13px] text-ff-muted">
                  {empty}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const k = rowKey(row)
              const isOpen = hasDetail.has(k) && open.has(k)
              const detail = isOpen && expand ? expand(row) : null
              return (
              <React.Fragment key={k}>
              <tr
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                className={cx(
                  'group border-b border-ff-line/60 last:border-0',
                  onRowClick && 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ff-accent',
                  'hover:bg-ff-raised',
                  isOpen && 'border-b-0 bg-ff-raised',
                  rowClass?.(row),
                )}
              >
                {details && (
                  <td className={cx('sticky left-0 z-[1] w-7 p-0 align-middle max-md:w-10 group-hover:bg-ff-raised', isOpen ? 'bg-ff-raised' : 'bg-ff-panel')}>
                    {hasDetail.has(k) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          flip(k)
                        }}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.stopPropagation()}
                        aria-expanded={isOpen}
                        aria-controls={`${id}-${k}`}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        className="flex h-[38px] w-7 items-center justify-center font-mono text-[11px] text-ff-muted hover:text-ff-text max-md:h-11 max-md:w-10"
                      >
                        <span className={cx('inline-block motion-safe:transition-transform motion-safe:duration-150', isOpen && 'rotate-90 text-ff-accent')}>›</span>
                      </button>
                    )}
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      dense ? 'h-8' : 'h-[38px]',
                      // Padding only shows when a cell wraps (stacked badges), so it never touches the rules.
                      'whitespace-nowrap px-1.5 py-1 align-middle first:pl-2.5 last:pr-2.5 sm:px-2 sm:first:pl-3 sm:last:pr-3',
                      align(c),
                      c.align === 'right' && 'num',
                      c.sticky && cx('sticky z-[1] max-w-[170px] overflow-hidden group-hover:bg-ff-raised sm:max-w-[300px]', isOpen ? 'bg-ff-raised' : 'bg-ff-panel', pin),
                        c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
              {isOpen && (
                <tr id={`${id}-${k}`} className="border-b border-ff-line/60 bg-ff-raised">
                  <td colSpan={span} className="p-0">
                    <div className="sticky left-0 px-3 pb-3 pt-0.5 sm:pl-9" style={viewW ? { width: viewW } : undefined}>
                      {detail}
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {cap && left > 0 && (
        <ShowMore className="border-t border-ff-line/60 p-2" step={cap.step} left={left} onMore={cap.more} rows="tbody > tr:not([id])" />
      )}
    </div>
  )
}

export type Reason = {
  text: ReactNode
  tone?: 'pos' | 'neg' | 'warn' | 'neutral' | 'accent'
  /** A short claim shown on its own line above the text, which then reads as the explanation. */
  label?: ReactNode
}

const REASON_MARK: Record<NonNullable<Reason['tone']>, { glyph: string; sr: string; cls: string }> = {
  pos: { glyph: '+', sr: 'Helps: ', cls: 'bg-ff-pos/15 text-ff-pos' },
  neg: { glyph: '−', sr: 'Hurts: ', cls: 'bg-ff-neg/12 text-ff-neg' },
  warn: { glyph: '!', sr: 'Caution: ', cls: 'bg-ff-warn/15 text-ff-warn' },
  accent: { glyph: '›', sr: '', cls: 'bg-ff-accent/12 text-ff-accent' },
  neutral: { glyph: 'i', sr: '', cls: 'bg-ff-sunken text-ff-muted' },
}

/**
 * The case for something, one line per reason, each led by a square in its tone: green helps,
 * red hurts, amber is a caution. Sits in a table's expanded row or anywhere a justification goes.
 */
export const Reasons = ({ items, title, columns = 2 }: { items: Reason[]; title?: ReactNode; columns?: 1 | 2 }) => (
  <div className="bg-ff-sunken/40">
    {title && <div className="ff-label px-3 pt-2.5">{title}</div>}
    <ul className={cx('grid text-[12.5px] leading-[1.45]', columns === 2 && 'md:grid-cols-2')}>
      {items.map((r, i) => {
        const m = REASON_MARK[r.tone ?? 'neutral']
        return (
          // In two columns the first row has no rule above either item and the two halves of each later rule meet; an
          // odd last item spans both columns so its rule still reaches across.
          <li
            key={i}
            className={cx(
              'flex min-w-0 items-start gap-2.5 px-3 py-2',
              i > 0 && 'border-t border-ff-line',
              columns === 2 && i === 1 && 'md:border-t-0',
              columns === 2 && i === items.length - 1 && i % 2 === 0 && 'md:col-span-2',
            )}
          >
            {/* A square per tone, in its colour, with a glyph so the shape carries it too, not colour alone (1.4.1). */}
            <span className={cx('mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center font-mono text-[12px] font-semibold leading-none', m.cls)}>
              <span aria-hidden>{m.glyph}</span>
              {m.sr && <span className="sr-only">{m.sr}</span>}
            </span>
            <span className="min-w-0">
              {r.label != null ? (
                <>
                  <span className="block font-medium text-ff-text">{r.label}</span>
                  <span className="mt-0.5 block text-[12px] text-ff-text2">{r.text}</span>
                </>
              ) : (
                <span className="text-ff-text2">{r.text}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  </div>
)

/**
 * A plain list of sentences, one per item, in a panel with no padding. Like Reasons, a hairline runs the full width
 * between items (none under the last) so each reads as its own line of thought; the padding sits on the items so the
 * rule reaches both edges.
 */
export const Sentences = ({ children, className }: { children: ReactNode; className?: string }) => (
  <ul className={cx('divide-y divide-ff-line text-[12.5px] leading-[1.45] text-ff-text2 [&>li]:px-3 [&>li]:py-2', className)}>{children}</ul>
)

export const Empty = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="border border-dashed border-ff-line2 px-4 py-10 text-center">
    <div className="text-sm text-ff-text">{title}</div>
    {children && <div className="mx-auto mt-1 max-w-md text-[13px] text-ff-muted">{children}</div>}
  </div>
)

/** Small key/value grid for detail panes. */
export const KV = ({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: number }) => (
  <dl className={cx('grid gap-x-4 gap-y-2', cols === 3 ? 'grid-cols-3' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')}>
    {items.map(([k, v], i) => (
      <div key={i} className="min-w-0">
        <dt className="truncate text-[11px] text-ff-muted">{k}</dt>
        <dd className="num truncate text-[13px] text-ff-text">{v}</dd>
      </div>
    ))}
  </dl>
)
