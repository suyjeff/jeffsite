import React, { useEffect, useState, type ReactNode } from 'react'
import Head from 'next/head'
import { Avatar, cx } from './ui'

export const SECTION_KEYS = ['dash', 'trades', 'me', 'waivers', 'power', 'teams', 'players', 'model'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

type Group = 'Overview' | 'Your team' | 'League' | 'Engine'
type Section = { key: SectionKey; label: string; short: string; group: Group }

/** Order is the register: the number beside each entry is also its keyboard shortcut. */
export const SECTIONS: Section[] = [
  { key: 'dash', label: 'Dashboard', short: 'Dash', group: 'Overview' },
  { key: 'trades', label: 'Trades', short: 'Trades', group: 'Your team' },
  { key: 'me', label: 'My team', short: 'Team', group: 'Your team' },
  { key: 'waivers', label: 'Waivers', short: 'Waivers', group: 'Your team' },
  { key: 'power', label: 'Power', short: 'Power', group: 'League' },
  { key: 'teams', label: 'Teams', short: 'Teams', group: 'League' },
  { key: 'players', label: 'Players', short: 'Players', group: 'League' },
  { key: 'model', label: 'Model', short: 'Model', group: 'Engine' },
]
const GROUPS: Group[] = ['Overview', 'Your team', 'League', 'Engine']

/** The two-digit register number shown beside a section, which is also its keyboard shortcut. */
export const sectionCode = (key: SectionKey) => String(SECTIONS.findIndex((s) => s.key === key) + 1).padStart(2, '0')

/** What the phone's bottom bar carries; everything else lives in the drawer. */
const TAB_BAR: SectionKey[] = ['dash', 'trades', 'me', 'power']

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
  loading: boolean
  progress: string
  onRefresh: () => void
  loadedAt: Date | null
  /** Short status readouts for the footer, e.g. ["WK 05", "SIM 4000"]. */
  status?: string[]
}

/** The wordmark. Shared by the shell and onboarding. */
export const Brand = () => (
  <span className="flex items-baseline gap-2">
    <span className="text-[14px] font-semibold tracking-[-0.01em] text-ff-text">Fantasy</span>
    <span className="font-mono text-[10px] text-ff-muted">/term</span>
  </span>
)

/** Document head for every fantasy screen. */
export const FantasyHead = ({ title }: { title: string }) => (
  <Head>
    <title>{title}</title>
    <meta name="viewport" content="initial-scale=1.0, width=device-width, viewport-fit=cover" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#060709" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#eceef1" media="(prefers-color-scheme: light)" />
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
}: Omit<ShellProps, 'children' | 'title'> & { onClose?: () => void }) => (
  <div className="flex h-full flex-col">
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-ff-line pl-3 pr-2">
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
      <label className="group relative block">
        <span className="sr-only">League</span>
        <select value={leagueId ?? ''} onChange={(e) => onLeague(e.target.value)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="flex items-center justify-between gap-2 px-3 py-2.5 peer-hover:bg-ff-raised peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ff-accent/40">
          <span className="min-w-0">
            <span className="ff-label block">League</span>
            <span className="mt-0.5 block truncate text-[13px] font-medium text-ff-text">{leagues.find((l) => l.id === leagueId)?.name ?? '—'}</span>
            {leagueMeta && <span className="block truncate font-mono text-[10.5px] text-ff-muted">{leagueMeta}</span>}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-ff-muted">▾</span>
        </span>
      </label>
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
                onClick={() => onNavigate(key)}
                aria-current={active ? 'page' : undefined}
                aria-keyshortcuts={String(i)}
                className={cx(
                  'group flex h-8 w-full items-center gap-3 px-3 text-left text-[13px] transition-colors',
                  active ? 'bg-ff-raised text-ff-text' : 'text-ff-text2 hover:bg-ff-raised/60 hover:text-ff-text',
                )}
              >
                <span className={cx('num w-4 text-[10.5px]', active ? 'text-ff-text' : 'text-ff-muted/70')}>{String(i).padStart(2, '0')}</span>
                <span className={cx('flex-1', active && 'font-medium')}>{label}</span>
                <kbd className="hidden h-[18px] min-w-[18px] items-center justify-center border border-ff-line px-1 font-mono text-[10px] text-ff-muted group-hover:inline-flex md:inline-flex md:opacity-0 md:group-hover:opacity-100">{i}</kbd>
              </button>
            )
          })}
        </div>
      ))}
    </nav>

    {controls && <div className="shrink-0 space-y-3 border-t border-ff-line p-3">{controls}</div>}

    <div className="shrink-0 border-t border-ff-line px-3 py-2 font-mono text-[10px] leading-[15px] text-ff-muted">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{loading ? `${progress.toLowerCase()}` : `SYNC ${clock(loadedAt)}`}</span>
        <button onClick={onRefresh} className="shrink-0 px-1 text-ff-text2 hover:text-ff-text" title="Reload from Sleeper" aria-label="Reload from Sleeper">
          {loading ? '···' : 'R↻'}
        </button>
      </div>
      {status && status.length > 0 && (
        <div className="flex flex-wrap gap-x-2">
          {status.map((s) => (
            <span key={s} className="whitespace-nowrap">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  </div>
)

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

const Shell = (props: ShellProps) => {
  const { section, onNavigate, children, title, loading, onRefresh, leagues, leagueId } = props
  const [drawer, setDrawer] = useState(false)

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
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
      const n = Number(e.key)
      if (n >= 1 && n <= SECTIONS.length) {
        e.preventDefault()
        onNavigate(SECTIONS[n - 1].key)
        window.scrollTo({ top: 0 })
      } else if (e.key === 'r' || e.key === 'R') onRefresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNavigate, onRefresh])

  const navigate = (s: SectionKey) => {
    setDrawer(false)
    onNavigate(s)
    window.scrollTo({ top: 0 })
  }
  const current = SECTIONS.find((s) => s.key === section)
  const index = SECTIONS.findIndex((s) => s.key === section) + 1
  const leagueName = leagues.find((l) => l.id === leagueId)?.name

  return (
    <div className="ff min-h-screen bg-ff-bg text-ff-text antialiased">
      <FantasyHead title={title} />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] border-r border-ff-line bg-ff-panel md:block">
        <SidebarBody {...props} onNavigate={navigate} />
      </aside>

      {/* Phone top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center border-b border-ff-line bg-ff-panel/95 backdrop-blur md:hidden">
        <button onClick={() => setDrawer(true)} className="flex h-full items-center gap-2 border-r border-ff-line px-3 font-mono text-[11px] tracking-[0.1em] text-ff-text2" aria-label="Open menu">
          MENU
        </button>
        <div className="min-w-0 flex-1 px-3 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="num text-[10.5px] text-ff-muted">{String(index).padStart(2, '0')}</span>
            <span className="truncate text-[15px] font-medium">{current?.label}</span>
          </div>
          {leagueName && <div className="truncate font-mono text-[10.5px] text-ff-muted">{leagueName}</div>}
        </div>
        <button onClick={onRefresh} className="flex h-full items-center border-l border-ff-line px-3 font-mono text-[11px] text-ff-text2" aria-label="Reload from Sleeper">
          {loading ? <span className="ff-pulse">SYNC</span> : '↻'}
        </button>
      </header>

      {/* Phone drawer */}
      <div className={cx('fixed inset-0 z-40 md:hidden', drawer ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!drawer}>
        <div onClick={() => setDrawer(false)} className={cx('absolute inset-0 bg-black/60 transition-opacity duration-150', drawer ? 'opacity-100' : 'opacity-0')} />
        <div
          role="dialog"
          aria-label="Menu"
          className={cx(
            'absolute inset-y-0 left-0 w-[86vw] max-w-[320px] border-r border-ff-line bg-ff-panel transition-transform duration-150 ease-out',
            drawer ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <SidebarBody {...props} onNavigate={navigate} onClose={() => setDrawer(false)} />
        </div>
      </div>

      <main className="overflow-x-clip pt-12 md:pl-[220px] md:pt-0">
        <div className={cx('mx-auto px-3 pb-24 md:px-5 md:pb-12', section === 'dash' ? 'max-w-none' : 'max-w-[1440px]')}>{children}</div>
      </main>

      {/* Phone tab bar: words, not pictures. */}
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ff-line bg-ff-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TAB_BAR.map((key) => {
          const s = SECTIONS.find((x) => x.key === key)!
          const active = key === section
          return (
            <button
              key={key}
              onClick={() => navigate(key)}
              aria-current={active ? 'page' : undefined}
              className={cx('flex h-12 flex-col items-center justify-center gap-0.5 border-r border-ff-line text-[11.5px]', active ? 'bg-ff-raised font-medium text-ff-text' : 'text-ff-muted')}
            >
              <span className="num text-[9.5px] opacity-70">{String(SECTIONS.findIndex((x) => x.key === key) + 1).padStart(2, '0')}</span>
              {s.short}
            </button>
          )
        })}
        <button onClick={() => setDrawer(true)} className={cx('flex h-12 flex-col items-center justify-center gap-0.5 text-[11.5px]', !TAB_BAR.includes(section) ? 'bg-ff-raised font-medium text-ff-text' : 'text-ff-muted')}>
          <span className="num text-[9.5px] opacity-70">··</span>
          More
        </button>
      </nav>
    </div>
  )
}

export default Shell
