import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { THEMES, type Scheme } from '../../lib/fantasy/themes'
import { useFantasy } from './FantasyContext'
import { SECTIONS, sectionCode, type SectionKey } from './Shell'
import { Swatch } from './ThemePicker'
import { Avatar, PlayerAvatar, cx, fmt, ownerLabel, shortcutLabel } from './ui'

// Cmd/Ctrl+K: one box that reaches every section and tab, every player in the
// league's pool, every team, and the settings worth changing in a hurry.
// Results rank by how well the query matches (whole word, word start, inside,
// then letters in order), players then by how much they matter here.

type Item = {
  id: string
  group: 'Go to' | 'Players' | 'Teams' | 'Actions'
  label: string
  /** Extra words that should find it ("odds" finds Power › Playoff odds). */
  keywords?: string
  hint?: ReactNode
  icon?: ReactNode
  /** Tie-break for equally good matches, higher first. */
  weight?: number
  run: () => void
}

const TABS: Partial<Record<SectionKey, [string, string][]>> = {
  trades: [
    ['suggested', 'Suggested trades'],
    ['targets', 'Trade targets'],
    ['needs', 'League needs'],
    ['injuries', 'Injuries & roles'],
    ['builder', 'Trade builder'],
  ],
  me: [
    ['overview', 'Overview'],
    ['roster', 'Roster'],
  ],
  waivers: [
    ['moves', 'Recommended moves'],
    ['stream', 'Streamers'],
    ['adds', 'All adds'],
  ],
  power: [
    ['rankings', 'Rankings'],
    ['odds', 'Playoff odds'],
    ['standings', 'Standings'],
    ['schedule', 'Remaining schedule'],
  ],
  players: [
    ['ahead', 'Rest of season'],
    ['todate', 'Season to date'],
  ],
  monke: [
    ['overview', 'Overview'],
    ['system', 'Wiring'],
    ['forecast', 'Forecast'],
    ['backtest', 'Backtest'],
    ['behavior', 'Behaviour'],
    ['data', 'Data'],
  ],
  model: [
    ['value', 'Player value'],
    ['power', 'Composite weights'],
    ['availability', 'Availability'],
    ['engine', 'Trade engine'],
  ],
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** How well `q` matches `text`: 0 for no match, higher is better. */
export const matchScore = (q: string, text: string) => {
  if (!q) return 1
  const t = norm(text)
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (words.some((w) => w.startsWith(q))) return 60
  if (t.includes(q)) return 40
  // Letters in order, and every term of a multi-word query somewhere.
  const terms = q.split(/\s+/).filter(Boolean)
  if (terms.length > 1 && terms.every((x) => t.includes(x))) return 35
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 10 : 0
}

const RECENT_KEY = 'ff:palette:recent'
const loadRecent = (): string[] => {
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

const CommandPalette = ({
  open,
  onClose,
  scheme,
  onTheme,
  onScheme,
  onReload,
  leagues,
  onLeague,
}: {
  open: boolean
  onClose: () => void
  scheme: Scheme
  onTheme: (id: string) => void
  onScheme: (s: Scheme) => void
  onReload: () => void
  leagues: { id: string; name: string }[]
  onLeague: (id: string) => void
}) => {
  const { data, analysis, go, openPlayer } = useFantasy()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    setRecent(loadRecent())
    const back = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => input.current?.focus())
    return () => back?.focus?.({ preventScroll: true })
  }, [open])

  // Everything the palette can reach that is not a player; players are searched separately, there are thousands.
  const fixed = useMemo<Item[]>(() => {
    const items: Item[] = []
    for (const s of SECTIONS) {
      items.push({ id: `go:${s.key}`, group: 'Go to', label: s.label, hint: <span className="num">{sectionCode(s.key)}</span>, weight: 3, run: () => go(s.key) })
      for (const [sub, label] of TABS[s.key] ?? [])
        items.push({ id: `go:${s.key}/${sub}`, group: 'Go to', label: `${s.label} › ${label}`, keywords: label, weight: 2, run: () => go(s.key, sub) })
    }
    for (const t of analysis.teams)
      items.push({
        id: `team:${t.rosterId}`,
        group: 'Teams',
        label: t.name,
        keywords: t.owner,
        icon: <Avatar src={t.avatar} name={t.name} size={18} />,
        hint: t.rosterId === analysis.myRosterId ? 'you' : t.owner !== t.name ? `@${t.owner}` : undefined,
        weight: t.rosterId === analysis.myRosterId ? 2 : 1,
        run: () => go('teams', String(t.rosterId)),
      })
    for (const th of THEMES)
      items.push({ id: `theme:${th.id}`, group: 'Actions', label: `Theme: ${th.label}`, keywords: `color colour ${th.family}`, icon: <Swatch theme={th} />, run: () => onTheme(th.id) })
    for (const [m, label] of [
      ['system', 'Follow the system'],
      ['light', 'Light mode'],
      ['dark', 'Dark mode'],
    ] as [Scheme, string][])
      if (m !== scheme) items.push({ id: `scheme:${m}`, group: 'Actions', label, keywords: 'theme appearance', run: () => onScheme(m) })
    items.push({ id: 'reload', group: 'Actions', label: 'Reload from Sleeper', keywords: 'refresh sync', hint: 'R', run: onReload })
    for (const l of leagues)
      if (l.id !== data.league.league_id) items.push({ id: `league:${l.id}`, group: 'Actions', label: `Switch league: ${l.name}`, keywords: 'league', run: () => onLeague(l.id) })
    return items
  }, [analysis, go, onTheme, onScheme, scheme, onReload, leagues, onLeague, data.league.league_id])

  // Players worth finding: anyone rostered here or with a value or a projection ahead.
  const pool = useMemo(
    () =>
      Object.values(data.players)
        .filter((p) => analysis.rosteredBy[p.id] != null || analysis.market[p.id] != null || (analysis.horizon.perWeek[p.id] ?? 0) > 0)
        .map((p) => ({ p, key: norm(`${p.name} ${p.team ?? ''} ${p.pos}`), weight: Math.max(analysis.market[p.id] ?? 0, 0) + (analysis.rosteredBy[p.id] != null ? 3 : 0) })),
    [data.players, analysis],
  )
  const playerItem = (p: (typeof pool)[number]['p']): Item => ({
    id: `player:${p.id}`,
    group: 'Players',
    label: p.name,
    icon: <PlayerAvatar id={p.id} player={p} size={20} />,
    hint: (
      <span className="font-mono">
        {p.pos} {p.team ?? 'FA'} · {ownerLabel(analysis, p.id)}
        {analysis.horizon.perWeek[p.id] ? ` · ${fmt(analysis.horizon.perWeek[p.id])}/wk` : ''}
      </span>
    ),
    run: () => openPlayer(p.id),
  })

  const results = useMemo(() => {
    const query = norm(q.trim())
    if (!query) {
      const byId = new Map(fixed.map((i) => [i.id, i]))
      const recents = recent
        .map((id) => byId.get(id) ?? (id.startsWith('player:') && data.players[id.slice(7)] ? playerItem(data.players[id.slice(7)]) : null))
        .filter((x): x is Item => !!x)
        .map((i) => ({ ...i, group: 'Recent' as Item['group'] }))
      const sections = fixed.filter((i) => i.id.startsWith('go:') && !i.id.includes('/'))
      return [...recents.slice(0, 5), ...sections]
    }
    const scored = fixed.map((i) => ({ i, s: Math.max(matchScore(query, i.label), i.keywords ? matchScore(query, i.keywords) * 0.9 : 0) })).filter((x) => x.s > 0)
    const players = pool
      .map((x) => ({ x, s: matchScore(query, x.key) }))
      .filter((y) => y.s >= 35)
      .sort((a, b) => b.s - a.s || b.x.weight - a.x.weight)
      .slice(0, 8)
      .map((y) => ({ i: playerItem(y.x.p), s: y.s }))
    const order: Item['group'][] = ['Go to', 'Players', 'Teams', 'Actions']
    return [...scored, ...players]
      .sort((a, b) => order.indexOf(a.i.group) - order.indexOf(b.i.group) || b.s - a.s || (b.i.weight ?? 0) - (a.i.weight ?? 0))
      .reduce<Item[]>((out, { i }) => {
        // At most 8 a group, so one kind of result never buries the rest.
        if (out.filter((o) => o.group === i.group).length < 8) out.push(i)
        return out
      }, [])
  }, [q, fixed, pool, recent]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (item: Item | undefined) => {
    if (!item) return
    const id = item.id
    try {
      const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 8)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // Recents simply do not persist in a private window.
    }
    onClose()
    item.run()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') e.preventDefault()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-2 pt-[max(12px,10vh)] sm:px-4" role="presentation">
      <div className="ff-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="ff-pop relative flex max-h-[min(560px,80vh)] w-full max-w-[620px] flex-col border border-ff-line2 bg-ff-panel shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        onKeyDown={onKey}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-ff-line px-3.5">
          <span aria-hidden className="font-mono text-[14px] text-ff-accent">
            ›
          </span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page, player, team or setting"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ff-text placeholder:text-ff-muted focus:outline-none"
          />
          <kbd className="hidden border border-ff-line px-1.5 py-0.5 font-mono text-[10px] text-ff-muted sm:inline">esc</kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Results" className="ff-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {results.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ff-muted">Nothing matches &ldquo;{q}&rdquo;. Try a surname, a team or a page.</div>}
          {results.map((item, i) => {
            const heading = item.group !== results[i - 1]?.group ? item.group : null
            return (
              <React.Fragment key={item.id}>
                {heading && (
                  <div role="presentation" className="ff-label px-3.5 pb-1 pt-2.5">
                    {heading}
                  </div>
                )}
                <div
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => run(item)}
                  className={cx('mx-1.5 flex h-9 cursor-pointer items-center gap-2.5 px-2 text-[13px]', i === active ? 'bg-ff-raised text-ff-text' : 'text-ff-text2')}
                >
                  <span className="flex w-5 shrink-0 justify-center">{item.icon ?? <span className="h-1.5 w-1.5 bg-ff-line2" />}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 truncate text-[11px] text-ff-muted">{item.hint}</span>}
                  {i === active && (
                    <span aria-hidden className="shrink-0 font-mono text-[11px] text-ff-accent">
                      ↵
                    </span>
                  )}
                </div>
              </React.Fragment>
            )
          })}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-ff-line px-3.5 font-mono text-[10.5px] text-ff-muted">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span className="hidden sm:inline">esc close</span>
          <span className="ml-auto">{shortcutLabel()}</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
