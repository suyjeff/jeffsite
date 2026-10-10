import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Head from 'next/head'
import { MONKE } from './brand'
import Tour, { TOUR } from './Tour'
import { PanelIcon } from './icons'
import SwipeSheet, { type SwipeSheetHandle } from './SwipeSheet'
import { Avatar, CrumbContext, Dropdown, cx, shortcutLabel, usePhone } from './ui'

export const SECTION_KEYS = ['dash', 'slate', 'trades', 'me', 'waivers', 'matchups', 'power', 'playoffs', 'teams', 'players', 'monke', 'model'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

type Group = 'Overview' | 'Your team' | 'League' | 'Engine'
type Section = { key: SectionKey; label: string; short: string; group: Group }

/** Order is the register: the number beside each entry is also its keyboard shortcut. */
export const SECTIONS: Section[] = [
  { key: 'dash', label: 'Dashboard', short: 'Dash', group: 'Overview' },
  { key: 'slate', label: 'Gameday', short: 'Gameday', group: 'Overview' },
  { key: 'trades', label: 'Trades', short: 'Trades', group: 'Your team' },
  { key: 'me', label: 'My team', short: 'Team', group: 'Your team' },
  { key: 'waivers', label: 'Waivers', short: 'Waivers', group: 'Your team' },
  { key: 'matchups', label: 'Matchups', short: 'Matchups', group: 'League' },
  { key: 'power', label: 'Power', short: 'Power', group: 'League' },
  { key: 'playoffs', label: 'Playoffs', short: 'Playoffs', group: 'League' },
  { key: 'teams', label: 'Teams', short: 'Teams', group: 'League' },
  { key: 'players', label: 'Players', short: 'Players', group: 'League' },
  { key: 'monke', label: 'M.O.N.K.E.', short: 'MONKE', group: 'Engine' },
  { key: 'model', label: 'Tuning', short: 'Tuning', group: 'Engine' },
]
const GROUPS: Group[] = ['Overview', 'Your team', 'League', 'Engine']

export { MONKE }

/** The two-digit register number shown beside a section, which is also its keyboard shortcut. */
export const sectionCode = (key: SectionKey) => String(SECTIONS.findIndex((s) => s.key === key) + 1).padStart(2, '0')

/** What the phone's bottom bar carries; everything else lives in the drawer. */
const TAB_BAR: SectionKey[] = ['dash', 'slate', 'trades', 'me']

export type ShellProps = {
  section: SectionKey
  onNavigate: (s: SectionKey) => void
  children: ReactNode
  title: string
  leagues: { id: string; name: string }[]
  leagueId: string | null
  onLeague: (id: string) => void
  leagueMeta?: string
  me?: { name: string; avatar: string | null; line: string } | null
  controls?: ReactNode
  /** The settings box, folded to a one-line summary or open. */
  controlsOpen?: boolean
  onControls?: (open: boolean) => void
  controlsSummary?: ReactNode
  loading: boolean
  progress: string
  onRefresh: () => void
  loadedAt: Date | null
  /** Opens the command palette; without it there is no search entry. */
  onSearch?: () => void
  /** The engine's readouts for the footer: label, value, and what it means. */
  status?: { label: string; value: string; title?: string }[]
  /** The first-visit tour, over the page; the sidebar stays clear and lights the section being explained. */
  tour?: boolean
  onTourEnd?: () => void
  /** The desktop sidebar shown (the default) or folded away; folding needs `onSidebar`. */
  sidebar?: boolean
  onSidebar?: (open: boolean) => void
}

/** The wordmark. Shared by the shell and onboarding. */
export const Brand = () => <span className="text-[14px] font-semibold tracking-[-0.01em] text-ff-text">Fantasy</span>

/** One button that never moves: the sidebar slides under it, and the icon only shades or clears its sidebar side. */
const SidebarToggle = ({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
    aria-keyshortcuts="["
    title={`${open ? 'Hide' : 'Show'} sidebar ([)`}
    className={cx('flex h-7 w-7 items-center justify-center rounded text-ff-muted/60 transition-colors hover:bg-ff-raised hover:text-ff-text2', className)}
  >
    <PanelIcon open={open} />
  </button>
)

/** Document head for every fantasy screen. */
export const FantasyHead = ({ title }: { title: string }) => (
  <Head>
    <title>{title}</title>
    <meta name="viewport" content="initial-scale=1.0, width=device-width, viewport-fit=cover, interactive-widget=resizes-content" />
    <meta name="robots" content="noindex" />
    {/* The default theme's top bar, until the chosen theme is known (useTheme then sets its own tag). */}
    <meta key="theme-dark" name="theme-color" content="#111114" media="(prefers-color-scheme: dark)" />
    <meta key="theme-light" name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </Head>
)

const clock = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--')

const SidebarBody = ({
  section,
  onNavigate,
  leagues,
  leagueId,
  onLeague,
  leagueMeta,
  me,
  controls,
  loading,
  progress,
  onRefresh,
  loadedAt,
  status,
  onClose,
  onSearch,
  tourKey,
  clearToggle,
  controlsOpen,
  onControls,
  controlsSummary,
}: Omit<ShellProps, 'children' | 'title'> & { onClose?: () => void; tourKey?: string | null; /** Leave room at the left of the header for the fixed sidebar toggle. */ clearToggle?: boolean }) => (
  <div className="flex h-full flex-col">
    <div className={cx('flex h-11 shrink-0 items-center justify-between border-b border-ff-line pr-2', clearToggle ? 'pl-11' : 'pl-3')}>
      <Brand />
      <span className="flex items-center gap-1">
        {onClose && (
          <button onClick={onClose} className="h-8 px-2 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text" aria-label="Close menu">
            ESC
          </button>
        )}
      </span>
    </div>

    <div className="shrink-0 border-b border-ff-line">
      <Dropdown
        label="League"
        value={leagueId ?? ''}
        onChange={onLeague}
        options={leagues.map((l) => ({ value: l.id, label: l.name }))}
        menuClassName="!left-2 !right-2 !min-w-0"
        buttonClassName="block hover:bg-ff-raised"
        renderButton={(cur, open) => (
          <span className="flex items-center justify-between gap-2 px-3 py-2.5">
            <span className="min-w-0">
              <span className="ff-label block">League</span>
              <span className="mt-0.5 block truncate text-[13px] font-medium text-ff-text">{cur?.label ?? '—'}</span>
              {leagueMeta && <span className="block truncate font-mono text-[10.5px] text-ff-muted">{leagueMeta}</span>}
            </span>
            <span aria-hidden className="shrink-0 font-mono text-[10px] text-ff-muted">
              {open ? '▴' : '▾'}
            </span>
          </span>
        )}
      />
      {me && (
        <div className="flex items-center gap-2 border-t border-ff-line px-3 py-2">
          <Avatar src={me.avatar} name={me.name} size={22} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[12.5px] text-ff-text">{me.name}</span>
            <span className="block truncate font-mono text-[10.5px] text-ff-muted">{me.line}</span>
          </span>
        </div>
      )}
    </div>

    {onSearch && (
      <div className="shrink-0 border-b border-ff-line px-3 py-2">
        <button
          type="button"
          onClick={() => {
            onClose?.()
            onSearch()
          }}
          data-tour-key="finish"
          className={cx(
            'flex h-7 w-full items-center gap-2 border bg-ff-sunken px-2 text-left text-[12px] text-ff-muted hover:border-ff-line2 hover:text-ff-text2',
            tourKey === 'finish' ? 'border-ff-accent text-ff-text2' : 'border-ff-line',
          )}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <span aria-hidden className="font-mono text-ff-accent">
            ›
          </span>
          <span className="flex-1">Jump to…</span>
          <kbd className="font-mono text-[10px]">{shortcutLabel()}</kbd>
        </button>
      </div>
    )}

    <nav className="ff-scroll flex-1 overflow-y-auto py-1.5" aria-label="Sections">
      {GROUPS.map((g) => (
        <div key={g} className="pb-1.5">
          <div className="ff-label px-3 pb-1 pt-2">{g}</div>
          {SECTIONS.filter((s) => s.group === g).map(({ key, label }) => {
            const i = SECTIONS.findIndex((s) => s.key === key) + 1
            const active = key === section
            return (
              <button
                key={key}
                data-tour-key={key}
                onClick={() => onNavigate(key)}
                aria-current={active ? 'page' : undefined}
                aria-keyshortcuts={i <= 9 ? String(i) : i === 10 ? '0' : undefined}
                title={key === 'monke' ? MONKE.long : undefined}
                className={cx(
                  'group flex h-7 w-full items-center gap-3 px-3 text-left text-[13px] transition-colors',
                  tourKey === key
                    ? 'bg-ff-accent/10 text-ff-text shadow-[inset_2px_0_0_rgb(var(--ff-accent))]'
                    : active
                      ? 'bg-ff-raised text-ff-text'
                      : 'text-ff-text2 hover:bg-ff-raised/60 hover:text-ff-text',
                )}
              >
                {/* Numbers are keyboard shortcuts, so phones (the drawer) leave them out. */}
                <span className={cx('num hidden w-4 text-[10.5px] md:inline', active ? 'text-ff-text' : 'text-ff-muted')}>{String(i).padStart(2, '0')}</span>
                <span className={cx('flex-1', active && 'font-medium')}>{label}</span>
                {/* 1–9 then 0 for the tenth; past that a section has no key. */}
                {i <= 10 && (
                  <kbd className="hidden h-[18px] min-w-[18px] items-center justify-center border border-ff-line px-1 font-mono text-[10px] text-ff-muted group-hover:inline-flex md:inline-flex md:opacity-0 md:group-hover:opacity-100">
                    {i === 10 ? 0 : i}
                  </kbd>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>

    {controls && (
      <div className="shrink-0 border-t border-ff-line">
        {/* Settings fold to one line: what they are set to, opened when needed. */}
        <button
          type="button"
          aria-expanded={!!controlsOpen}
          aria-controls="ff-settings"
          onClick={() => onControls?.(!controlsOpen)}
          className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-ff-raised"
        >
          <span className="ff-label shrink-0">Settings</span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-ff-muted">{controlsSummary}</span>
          <span aria-hidden className={cx('font-mono text-[10px] text-ff-muted motion-safe:transition-transform motion-safe:duration-150', controlsOpen && 'rotate-180')}>
            ▴
          </span>
        </button>
        {controlsOpen && (
          <div id="ff-settings" className="space-y-3 px-3 pb-3">
            {controls}
          </div>
        )}
      </div>
    )}

    <div className="shrink-0 border-t border-ff-line px-3 pb-2.5 pt-2 font-mono text-[10.5px] text-ff-muted">
      <div className="flex h-6 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cx('h-1.5 w-1.5 shrink-0', loading ? 'ff-pulse bg-ff-warn' : 'bg-ff-pos')} aria-hidden />
          <span className="min-w-0 truncate">{loading ? progress.toLowerCase() : `synced ${clock(loadedAt)}`}</span>
        </span>
        <button onClick={onRefresh} disabled={loading} className="-mr-1.5 h-6 shrink-0 px-1.5 text-ff-text2 hover:bg-ff-raised hover:text-ff-text disabled:opacity-50" title="Reload from Sleeper (R)">
          reload
        </button>
      </div>
      {status && status.length > 0 && (
        <dl className="mt-1 grid grid-cols-2 gap-px border border-ff-line bg-ff-line">
          {status.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-2 bg-ff-panel px-2 py-1" title={s.title}>
              <dt className="text-[9.5px] tracking-[0.08em]">{s.label}</dt>
              <dd className="num truncate text-ff-text2">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  </div>
)

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  // An open dropdown takes letters and digits for type-ahead.
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute('aria-expanded') === 'true')
}

const Shell = (props: ShellProps) => {
  const { section, onNavigate, children, title, loading, onRefresh, leagues, leagueId, onSidebar } = props
  const [drawer, setDrawer] = useState(false)
  const phone = usePhone()
  // The tour lights entries in the sidebar, so it shows the sidebar while it runs.
  const sidebarOpen = props.sidebar !== false || !onSidebar || !!props.tour
  // The drawer is a phone control; widening the window past it simply closes it.
  useEffect(() => {
    if (!phone) setDrawer(false)
  }, [phone])
  const drawerSheet = useRef<SwipeSheetHandle>(null)
  // Closing slides the drawer away first; it unmounts once it is off screen.
  const closeDrawer = () => (drawerSheet.current ? drawerSheet.current.dismiss() : setDrawer(false))

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && drawerSheet.current?.dismiss()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [drawer])

  // Number keys jump between sections; R reloads.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      // A sheet over the page owns the keyboard.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      // 1–9 open the first nine sections and 0 the tenth, like the number row reads.
      const n = e.key === '0' ? 10 : Number(e.key)
      if (n >= 1 && n <= SECTIONS.length && /^[0-9]$/.test(e.key)) {
        e.preventDefault()
        onNavigate(SECTIONS[n - 1].key)
        window.scrollTo({ top: 0 })
      } else if (e.key === 'r' || e.key === 'R') onRefresh()
      else if (e.key === '[' && onSidebar && !phone) onSidebar(!sidebarOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNavigate, onRefresh, onSidebar, sidebarOpen, phone])

  // The tour: which step it is on. A sidebar click while it runs moves the tour there instead of the page.
  // Back to the start as it ends, so a replay opens on step one rather than flashing the step it ended on.
  const [tourStep, setTourStep] = useState(0)
  const endTour = () => {
    setTourStep(0)
    props.onTourEnd?.()
  }
  const tourKey = props.tour ? TOUR[tourStep]?.key : null
  const navigate = (s: SectionKey) => {
    if (props.tour) {
      const i = TOUR.findIndex((t) => t.key === s)
      if (i >= 0) setTourStep(i)
      return
    }
    if (drawer) closeDrawer()
    onNavigate(s)
    window.scrollTo({ top: 0 })
  }
  // Folding the sidebar moves the page at once (padding, so it lays out once, not every frame), then slides the
  // page from where it was to where it now is, on the sidebar's own curve and timing, so the two travel together.
  const page = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(sidebarOpen)
  useLayoutEffect(() => {
    if (wasOpen.current === sidebarOpen) return
    wasOpen.current = sidebarOpen
    const el = page.current
    const main = el?.parentElement
    if (phone || !el || !main || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const max = parseFloat(getComputedStyle(el).maxWidth) || Infinity
    // A page narrower than the window sits centred, so it moves half the sidebar's width, not all of it.
    const left = (pad: number) => pad + Math.max(0, (main.clientWidth - pad - max) / 2)
    const dx = left(sidebarOpen ? 0 : 220) - left(sidebarOpen ? 220 : 0)
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 170, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })
  }, [sidebarOpen, phone])
  const current = SECTIONS.find((s) => s.key === section)
  // The top bar's breadcrumb: the section crumb is the shell's; a page with tabs portals its page crumb into the slot.
  const [crumbSlot, setCrumbSlot] = useState<HTMLElement | null>(null)
  const [paged, setPaged] = useState(false)
  const home = useRef<(() => boolean) | null>(null)
  const crumbs = useMemo(() => ({ slot: crumbSlot, section: current?.label ?? '', home, setPaged }), [crumbSlot, current?.label])
  // Tapping the section goes to its first page; already there (or nothing to go to), it opens the menu.
  const crumbHome = () => {
    if (!home.current?.()) setDrawer(true)
  }
  const leagueName = leagues.find((l) => l.id === leagueId)?.name

  return (
    // Page headers read data-sidebar to leave room for the show-sidebar button when the sidebar is folded.
    <CrumbContext.Provider value={crumbs}>
    <div className="ff group/shell min-h-dvh bg-ff-bg text-ff-text antialiased" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <FantasyHead title={title} />

      {/* Desktop sidebar. Folded, it slides off to the left and leaves the tab order. */}
      <aside
        inert={!sidebarOpen}
        className={cx(
          'fixed inset-y-0 left-0 z-30 hidden w-[calc(220px+env(safe-area-inset-left))] border-r border-ff-line bg-ff-panel pl-[env(safe-area-inset-left)] motion-safe:transition-transform motion-safe:duration-[170ms] motion-safe:ease-ff-drawer md:block',
          !sidebarOpen && '-translate-x-full',
        )}
      >
        <SidebarBody {...props} onNavigate={navigate} tourKey={tourKey} clearToggle={!!onSidebar && !props.tour} />
      </aside>
      {/* The toggle is fixed over the sidebar's header row and the page's, so it stays put as the sidebar goes. */}
      {onSidebar && !props.tour && (
        <div className="fixed left-0 top-0 z-40 hidden h-11 items-center pl-[calc(8px+env(safe-area-inset-left))] md:flex">
          <SidebarToggle open={sidebarOpen} onClick={() => onSidebar(!sidebarOpen)} />
        </div>
      )}
      {props.tour && props.onTourEnd && <Tour step={tourStep} setStep={setTourStep} onClose={endTour} phone={phone} />}

      {/* Phone top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-[var(--ff-top)] items-center border-b border-ff-line bg-ff-panel/95 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <button onClick={() => setDrawer(true)} className="flex h-full items-center border-r border-ff-line px-3 text-ff-text2" aria-label="Open menu">
          <PanelIcon />
        </button>
        <div className="min-w-0 flex-1 px-3 leading-tight">
          {/* The crumbs are taller than their text so a thumb can hit them; the league line under them lets taps through. */}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-[15px] font-medium">
            <button
              type="button"
              onClick={crumbHome}
              title={current?.label}
              aria-label={paged ? `${current?.label}: first page` : `${current?.label}: open menu`}
              className={cx('-my-3.5 max-w-[45%] shrink-0 truncate py-3.5 text-left', paged ? 'font-normal text-ff-text2' : 'text-ff-text')}
            >
              {current?.label}
            </button>
            <div ref={setCrumbSlot} className="contents" />
          </nav>
          {leagueName && <div className="pointer-events-none truncate font-mono text-[10.5px] text-ff-muted">{leagueName}</div>}
        </div>
        {props.onSearch && (
          <button onClick={props.onSearch} className="flex h-full items-center border-l border-ff-line px-3 font-mono text-[11px] tracking-[0.1em] text-ff-text2" aria-label="Find a page, player or team">
            FIND
          </button>
        )}
        <button onClick={onRefresh} className="flex h-full items-center border-l border-ff-line px-3 font-mono text-[11px] text-ff-text2" aria-label="Reload from Sleeper">
          {loading ? <span className="ff-pulse">SYNC</span> : '↻'}
        </button>
      </header>

      {/* Phone drawer: swipe it left to close, like any native sheet. */}
      {drawer && phone && (
        <div>
          <SwipeSheet
            ref={drawerSheet}
            side="left"
            className="z-40"
            onDismissed={() => setDrawer(false)}
            backdropClassName="bg-black/60"
            panelProps={{ role: 'dialog', 'aria-label': 'Menu' }}
            panelClassName="h-full w-[86vw] max-w-[320px] shrink-0 border-r border-ff-line bg-ff-panel"
          >
            <SidebarBody {...props} onNavigate={navigate} onClose={closeDrawer} />
          </SwipeSheet>
        </div>
      )}

      <main className={cx('overflow-x-clip pt-[var(--ff-top)] md:pt-0', sidebarOpen && 'md:pl-[calc(220px+env(safe-area-inset-left))]')}>
        <div ref={page} className={cx('ff-gutter mx-auto pb-24 md:pb-12', section === 'dash' ? 'max-w-none' : 'max-w-[1440px]')}>{children}</div>
      </main>

      {/* Phone tab bar: words, not pictures. */}
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ff-line bg-ff-panel/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur md:hidden">
        {TAB_BAR.map((key) => {
          const s = SECTIONS.find((x) => x.key === key)!
          const active = key === section
          return (
            <button
              key={key}
              onClick={() => navigate(key)}
              aria-current={active ? 'page' : undefined}
              className={cx('flex h-12 items-center justify-center border-r border-ff-line text-[12px]', active ? 'bg-ff-raised font-medium text-ff-text' : 'text-ff-muted')}
            >
              {s.short}
            </button>
          )
        })}
        <button onClick={() => setDrawer(true)} className={cx('flex h-12 items-center justify-center text-[12px]', !TAB_BAR.includes(section) ? 'bg-ff-raised font-medium text-ff-text' : 'text-ff-muted')}>
          More
        </button>
      </nav>
    </div>
    </CrumbContext.Provider>
  )
}

export default Shell
