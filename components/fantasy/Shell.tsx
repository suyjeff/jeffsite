import React, { useEffect, useState, type ReactNode } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { Avatar, cx } from './ui'
import {
  IconBack,
  IconChevron,
  IconClose,
  IconMe,
  IconMenu,
  IconModel,
  IconPlayers,
  IconPower,
  IconRefresh,
  IconTeams,
  IconTrades,
} from './icons'

export const SECTION_KEYS = ['trades', 'me', 'power', 'teams', 'players', 'model'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

type Section = { key: SectionKey; label: string; group: 'Your team' | 'League' | 'Engine'; Icon: (p: { size?: number; className?: string }) => JSX.Element }

export const SECTIONS: Section[] = [
  { key: 'trades', label: 'Trades', group: 'Your team', Icon: IconTrades },
  { key: 'me', label: 'My team', group: 'Your team', Icon: IconMe },
  { key: 'power', label: 'Power', group: 'League', Icon: IconPower },
  { key: 'teams', label: 'Teams', group: 'League', Icon: IconTeams },
  { key: 'players', label: 'Players', group: 'League', Icon: IconPlayers },
  { key: 'model', label: 'Model', group: 'Engine', Icon: IconModel },
]

/** What the phone's bottom bar carries; everything else lives in the drawer. */
const TAB_BAR: SectionKey[] = ['trades', 'me', 'power', 'players']

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
}

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
  onClose,
}: Omit<ShellProps, 'children' | 'title'> & { onClose?: () => void }) => {
  const groups = ['Your team', 'League', 'Engine'] as const
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-ff-line px-3">
        <Link href="/lab" className="group flex items-center gap-1 text-ff-muted hover:text-ff-text" title="Back to the Lab">
          <IconBack size={16} />
          <span className="text-[15px] font-medium italic tracking-tight text-ff-text">Fantasy</span>
        </Link>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ff-muted" title={loading ? progress : 'Live from Sleeper'}>
            <span className={cx('h-1.5 w-1.5 rounded-full', loading ? 'ff-pulse bg-ff-warn' : 'bg-ff-pos')} />
            {loading ? 'sync' : 'live'}
          </span>
          {onClose && (
            <button onClick={onClose} className="-mr-1.5 rounded-md p-1.5 text-ff-muted hover:bg-ff-raised hover:text-ff-text" aria-label="Close menu">
              <IconClose size={18} />
            </button>
          )}
        </span>
      </div>

      <div className="shrink-0 space-y-2 border-b border-ff-line p-3">
        <label className="relative block">
          <span className="sr-only">League</span>
          <select
            value={leagueId ?? ''}
            onChange={(e) => onLeague(e.target.value)}
            className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="flex items-center justify-between gap-2 rounded-md border border-ff-line bg-ff-raised px-2.5 py-1.5 peer-hover:border-ff-line2 peer-focus-visible:ring-2 peer-focus-visible:ring-ff-accent/40">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ff-text">{leagues.find((l) => l.id === leagueId)?.name ?? 'League'}</span>
              {leagueMeta && <span className="block truncate font-mono text-[10.5px] text-ff-muted">{leagueMeta}</span>}
            </span>
            <IconChevron size={14} className="shrink-0 text-ff-muted" />
          </span>
        </label>
        {me && (
          <div className="flex items-center gap-2 px-0.5">
            <Avatar src={me.avatar} name={me.name} size={22} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12.5px] text-ff-text">{me.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-ff-muted">{me.line}</span>
            </span>
          </div>
        )}
      </div>

      <nav className="ff-scroll flex-1 overflow-y-auto px-2 py-2" aria-label="Sections">
        {groups.map((g) => (
          <div key={g} className="mb-2">
            <div className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ff-muted">{g}</div>
            {SECTIONS.filter((s) => s.group === g).map(({ key, label, Icon }) => {
              const active = key === section
              return (
                <button
                  key={key}
                  onClick={() => onNavigate(key)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                    active ? 'bg-ff-raised text-ff-text' : 'text-ff-text2 hover:bg-ff-raised/60 hover:text-ff-text',
                  )}
                >
                  {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[2px] rounded-full bg-ff-accent" />}
                  <Icon size={17} className={active ? 'text-ff-accent' : 'text-ff-muted'} />
                  {label}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {controls && <div className="shrink-0 space-y-3 border-t border-ff-line p-3">{controls}</div>}

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-ff-line px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[10.5px] text-ff-muted">
          {loading ? `${progress}…` : loadedAt ? `updated ${loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={onRefresh} className="rounded p-1 text-ff-muted hover:bg-ff-raised hover:text-ff-text" title="Reload from Sleeper" aria-label="Reload from Sleeper">
          <IconRefresh size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
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

  const navigate = (s: SectionKey) => {
    setDrawer(false)
    onNavigate(s)
    window.scrollTo({ top: 0 })
  }
  const current = SECTIONS.find((s) => s.key === section)
  const leagueName = leagues.find((l) => l.id === leagueId)?.name

  return (
    <div className="ff min-h-screen bg-ff-bg font-sans text-ff-text antialiased">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#08090d" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#eff1f4" media="(prefers-color-scheme: light)" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-ff-line bg-ff-panel md:block">
        <SidebarBody {...props} onNavigate={navigate} />
      </aside>

      {/* Phone top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-1 border-b border-ff-line bg-ff-panel/95 px-1.5 backdrop-blur md:hidden">
        <button onClick={() => setDrawer(true)} className="rounded-md p-2 text-ff-text2 hover:bg-ff-raised" aria-label="Open menu">
          <IconMenu size={20} />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-medium tracking-tight">{current?.label}</div>
          {leagueName && <div className="truncate font-mono text-[10.5px] text-ff-muted">{leagueName}</div>}
        </div>
        <button onClick={onRefresh} className="rounded-md p-2 text-ff-muted hover:bg-ff-raised" aria-label="Reload from Sleeper">
          <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* Phone drawer */}
      <div className={cx('fixed inset-0 z-40 md:hidden', drawer ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!drawer}>
        <div onClick={() => setDrawer(false)} className={cx('absolute inset-0 bg-black/50 transition-opacity duration-200', drawer ? 'opacity-100' : 'opacity-0')} />
        <div
          role="dialog"
          aria-label="Menu"
          className={cx(
            'absolute inset-y-0 left-0 w-[86vw] max-w-[320px] border-r border-ff-line bg-ff-panel shadow-2xl transition-transform duration-200 ease-out',
            drawer ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <SidebarBody {...props} onNavigate={navigate} onClose={() => setDrawer(false)} />
        </div>
      </div>

      <main className="pt-12 md:pl-[232px] md:pt-0">
        <div className="mx-auto max-w-[1400px] px-3 pb-28 md:px-6 md:pb-14">{children}</div>
      </main>

      {/* Phone tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ff-line bg-ff-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {TAB_BAR.map((key) => {
          const s = SECTIONS.find((x) => x.key === key)!
          const active = key === section
          return (
            <button key={key} onClick={() => navigate(key)} aria-current={active ? 'page' : undefined} className={cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px]', active ? 'text-ff-accent' : 'text-ff-muted')}>
              <s.Icon size={20} />
              {s.label}
            </button>
          )
        })}
        <button onClick={() => setDrawer(true)} className={cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px]', !TAB_BAR.includes(section) ? 'text-ff-accent' : 'text-ff-muted')}>
          <IconMenu size={20} />
          More
        </button>
      </nav>
    </div>
  )
}

export default Shell
