import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FantasyProvider } from '../../components/fantasy/FantasyContext'
import SheetHost, { sheetKey, type SheetRef } from '../../components/fantasy/SheetHost'
import Shell, { SECTION_KEYS, SECTIONS, type SectionKey } from '../../components/fantasy/Shell'
import { Label, Segmented, Select, cx, simOdds } from '../../components/fantasy/ui'
import DashboardView from '../../components/fantasy/views/DashboardView'
import Onboarding, { type OnboardResult } from '../../components/fantasy/Onboarding'
import MeView from '../../components/fantasy/views/MeView'
import ModelView, { READOUT } from '../../components/fantasy/views/ModelView'
import MatchupsView from '../../components/fantasy/views/MatchupsView'
import PlayoffsView from '../../components/fantasy/views/PlayoffsView'
import SlateView from '../../components/fantasy/views/SlateView'
import PlayersView from '../../components/fantasy/views/PlayersView'
import PowerView from '../../components/fantasy/views/PowerView'
import TeamsView from '../../components/fantasy/views/TeamsView'
import WaiversView from '../../components/fantasy/views/WaiversView'
import TradesView from '../../components/fantasy/views/TradesView'
import type { AcceptRead } from '../../lib/fantasy/behavior'
import { applyLessons, ideaKey, learn, loadGrades, saveGrades, type GradeRecord, type Grades } from '../../lib/fantasy/grades'
import type { TradeIdea } from '../../lib/fantasy/trades'
import { applyAdjustments, liveAdjustments, loadAdjustments, saveAdjustments, type Adjustment, type Adjustments } from '../../lib/fantasy/adjust'
import { analyze, withWeights } from '../../lib/fantasy/analysis'
import { buildHistory, buildModels } from '../../lib/fantasy/models'
import { DEFAULT_POWER_WEIGHTS, type PowerWeights } from '../../lib/fantasy/power'
import { purgeStaleCache } from '../../lib/fantasy/sleeper'
import {
  DEFAULT_HORIZON_MODE,
  DEFAULT_PLAYOFF_WEIGHT,
  providerName,
  useLeagueData,
  type HorizonMode,
  type LoadOptions,
  type Provider,
} from '../../lib/fantasy/useLeagueData'
import { useRoute } from '../../lib/fantasy/useRoute'
import { DEFAULT_MODEL, type ModelConfig } from '../../lib/fantasy/war'
import { DEFAULT_THEME, themeById, type Scheme } from '../../lib/fantasy/themes'
import UserMenu from '../../components/fantasy/UserMenu'
import DisplayMenu, { type Density } from '../../components/fantasy/ThemePicker'
import CommandPalette from '../../components/fantasy/CommandPalette'
import { useTheme } from '../../lib/fantasy/useTheme'

const PREFS_KEY = 'ff:prefs'

export type Prefs = {
  /** True once a league has been confirmed (a Sleeper username, or an ESPN league and team); until then the page shows onboarding. */
  onboarded: boolean
  /** Where the league lives. Missing in prefs saved before ESPN support, which were all Sleeper. */
  provider: Provider
  username: string
  /** The Sleeper league picked in the switcher. */
  leagueId: string | null
  /** ESPN's league id and your team in it. */
  espnLeagueId: string | null
  espnTeamId: number | null
  season: string | null
  horizon: HorizonMode
  playoffWeight: number
  model: ModelConfig
  weights: PowerWeights
  /** Colour theme id (lib/fantasy/themes.ts) and, for themes with both, light, dark or the system's. */
  theme: string
  scheme: Scheme
  /** Compact (the default) or comfortable: type size and row height across the app. */
  density: Density
  /** The desktop sidebar: shown, or folded away behind a show-sidebar button. */
  sidebar: boolean
  /** The sidebar's settings box, opened or folded to a one-line summary. */
  settingsOpen: boolean
}

const TOUR_KEY = 'ff:tour:v1'

const HORIZON_SHORT: Record<HorizonMode, string> = { next6: '6 wks', regular: 'season', playoffs: '+ playoffs' }
const HORIZON_LONG: Record<HorizonMode, string> = {
  next6: 'The next six regular-season weeks',
  regular: 'Everything left before the fantasy playoffs',
  playoffs: 'Everything left, fantasy playoffs included',
}

const loadPrefs = (): Prefs => {
  const base: Prefs = {
    onboarded: false,
    provider: 'sleeper',
    username: '',
    leagueId: null,
    espnLeagueId: null,
    espnTeamId: null,
    season: null,
    horizon: DEFAULT_HORIZON_MODE,
    playoffWeight: DEFAULT_PLAYOFF_WEIGHT,
    model: DEFAULT_MODEL,
    weights: DEFAULT_POWER_WEIGHTS,
    theme: DEFAULT_THEME,
    scheme: 'system',
    density: 'compact',
    sidebar: true,
    settingsOpen: false,
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return base
    const p = JSON.parse(raw) as Partial<Prefs>
    // Prefs saved before onboarding existed carry a username but no flag: they get the (pre-filled) form once.
    const known = p.provider === 'espn' ? !!p.espnLeagueId : !!p.username
    return { ...base, ...p, onboarded: p.onboarded === true && known, model: { ...DEFAULT_MODEL, ...(p.model ?? {}) }, weights: { ...DEFAULT_POWER_WEIGHTS, ...(p.weights ?? {}) } }
  } catch {
    return base
  }
}

const FantasyPage = () => {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const route = useRoute(SECTION_KEYS, 'dash', { matchup: 'slate/week' })
  useTheme(prefs?.theme, prefs?.scheme ?? 'system', prefs != null)
  // Density is one attribute on the root; styles/fantasy.css scales type and rows from it.
  useEffect(() => {
    if (!prefs) return
    document.documentElement.dataset.ffDensity = prefs.density
    return () => {
      delete document.documentElement.dataset.ffDensity
    }
  }, [prefs?.density]) // eslint-disable-line react-hooks/exhaustive-deps
  // Waivers moved out of My team into their own section; old links still land there.
  useEffect(() => {
    if (route.section === 'me' && route.sub === 'waivers') route.go('waivers', 'adds', { replace: true })
    // The Model page split into M.O.N.K.E. (read-only) and Tuning; its read-only tabs moved over.
    if (route.section === 'model' && route.sub && READOUT.includes(route.sub as (typeof READOUT)[number])) route.go('monke', route.sub, { replace: true })
    // Playoffs moved out of Power into its own page; your matchup moved into Gameday, the league's into Matchups.
    if (route.section === 'power' && route.sub === 'odds') route.go('playoffs', null, { replace: true })
  }, [route.section, route.sub]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    purgeStaleCache()
    const p = loadPrefs()
    setPrefs(p)
  }, [])
  useEffect(() => {
    if (!prefs) return
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // ignore
    }
  }, [prefs])

  // Nothing loads until a username is confirmed. Once one has been this
  // session, reopening the form (switch) keeps the current data live, so
  // backing out of it costs nothing.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (prefs?.onboarded) setReady(true)
  }, [prefs?.onboarded])
  const opts = useMemo<LoadOptions | null>(() => {
    if (!prefs || !ready) return null
    const common = { season: prefs.season, horizon: prefs.horizon, playoffWeight: prefs.playoffWeight }
    return prefs.provider === 'espn' && prefs.espnLeagueId
      ? { ...common, provider: 'espn', leagueId: prefs.espnLeagueId, teamId: prefs.espnTeamId }
      : { ...common, provider: 'sleeper', username: prefs.username, leagueId: prefs.leagueId }
  }, [ready, prefs?.provider, prefs?.username, prefs?.leagueId, prefs?.espnLeagueId, prefs?.espnTeamId, prefs?.season, prefs?.horizon, prefs?.playoffWeight]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data: loaded, error, loading, progress, reload } = useLeagueData(opts)
  // Your nudges for this league, applied to the data itself so every model downstream uses them.
  // Read in the same render the league arrives in, so no model is built with another league's reads.
  const leagueKey = loaded?.league.league_id ?? null
  const stored = useMemo(() => (leagueKey ? loadAdjustments(leagueKey) : {}), [leagueKey])
  const [edited, setEdited] = useState<{ key: string | null; adj: Adjustments } | null>(null)
  const adj = edited && edited.key === leagueKey ? edited.adj : stored
  const firstWeek = loaded?.horizon[0]?.week ?? null
  const live = useMemo(() => liveAdjustments(adj, firstWeek), [adj, firstWeek])
  const data = useMemo(() => (loaded ? applyAdjustments(loaded, live) : null), [loaded, live])
  const adjust = useMemo(
    () => ({
      all: live,
      week: firstWeek,
      set: (id: string, a: Adjustment | null) => {
        const next = { ...live }
        if (a && a.pct) next[id] = a
        else delete next[id]
        if (leagueKey) saveAdjustments(leagueKey, next)
        setEdited({ key: leagueKey, adj: next })
      },
    }),
    [live, firstWeek, leagueKey],
  )
  // Your grades of suggested trades, per league, and what they teach the trade read.
  const storedGrades = useMemo(() => (leagueKey ? loadGrades(leagueKey) : {}), [leagueKey])
  const [editedGrades, setEditedGrades] = useState<{ key: string | null; g: Grades } | null>(null)
  const gradeMap = editedGrades && editedGrades.key === leagueKey ? editedGrades.g : storedGrades
  const grades = useMemo(() => {
    const players = loaded?.players ?? {}
    const posOf = (id: string) => players[id]?.pos
    const name = (id: string) => players[id]?.name ?? id
    const lessons = learn(gradeMap, posOf)
    return {
      all: gradeMap,
      lessons,
      set: (idea: TradeIdea, rec: Omit<GradeRecord, 'partnerId' | 'give' | 'get' | 'at'> | null) => {
        const next = { ...gradeMap }
        const k = ideaKey(idea)
        if (rec) next[k] = { ...rec, partnerId: idea.partnerId, give: idea.give, get: idea.get, at: Date.now() }
        else delete next[k]
        if (leagueKey) saveGrades(leagueKey, next)
        setEditedGrades({ key: leagueKey, g: next })
      },
      apply: (read: AcceptRead, idea: TradeIdea) => applyLessons(read, idea, lessons, name, posOf),
    }
  }, [gradeMap, leagueKey, loaded?.players])
  // Everything but the composite ranking depends on the data and the value model;
  // weights only re-rank. Models and the trade search key on the core, so moving
  // a weight slider never reruns the season simulation or the backtest.
  // Your reads change the weeks ahead only: the history-based models (Elo, the backtest, league behaviour)
  // are built once from the league as loaded and kept when a read changes.
  const coreLoaded = useMemo(() => (loaded && prefs ? analyze(loaded, prefs.model, DEFAULT_POWER_WEIGHTS) : null), [loaded, prefs?.model]) // eslint-disable-line react-hooks/exhaustive-deps
  const core = useMemo(
    () => (data && prefs ? (data === loaded ? coreLoaded : analyze(data, prefs.model, DEFAULT_POWER_WEIGHTS)) : null),
    [data, loaded, coreLoaded, prefs?.model], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const analysis = useMemo(() => (core && prefs ? withWeights(core, prefs.weights) : null), [core, prefs?.weights]) // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => (loaded && coreLoaded ? buildHistory(loaded, coreLoaded) : null), [loaded, coreLoaded])
  const models = useMemo(() => (data && core && history ? buildModels(data, core, history) : null), [data, core, history])

  // The one detail sheet, over whatever page you are on. Opening another from inside it swaps the content in place
  // and keeps a short trail back; the same thing twice in a row is one entry.
  const [sheets, setSheets] = useState<SheetRef[]>([])
  const openSheet = useCallback(
    (r: SheetRef) => setSheets((xs) => (xs.length && sheetKey(xs[xs.length - 1]) === sheetKey(r) ? xs : [...xs.slice(-7), r])),
    [],
  )
  const closeSheet = useCallback(() => setSheets([]), [])
  const backSheet = useCallback(() => setSheets((xs) => xs.slice(0, -1)), [])
  const sheetApi = useMemo(
    () => ({
      openPlayer: (id: string) => openSheet({ kind: 'player', id }),
      openTeam: (id: number) => openSheet({ kind: 'team', id }),
      openGame: (key: string) => openSheet({ kind: 'game', key }),
      openMatchup: (week: number, a: number, b: number) => openSheet({ kind: 'matchup', week, a, b }),
    }),
    [openSheet],
  )
  // Cmd/Ctrl+K opens the command palette from anywhere, fields included; again closes it.
  const [palette, setPalette] = useState(false)
  const closePalette = useCallback(() => setPalette(false), [])
  // Only once the app is up: on the loader or onboarding there is nothing to jump to, and a press there must not open it later.
  const appUp = !!(data && analysis && models && prefs)
  const canPalette = useRef(appUp)
  canPalette.current = appUp
  useEffect(() => {
    if (!appUp) setPalette(false)
  }, [appUp])

  // The tour runs on a first visit, once a league is up to point at; after that only when asked for.
  const [tour, setTour] = useState(false)
  useEffect(() => {
    if (!appUp) return
    try {
      if (!window.localStorage.getItem(TOUR_KEY)) setTour(true)
    } catch {
      // Storage blocked: skip it rather than show it on every visit.
    }
  }, [appUp])
  const endTour = useCallback(() => {
    setTour(false)
    try {
      window.localStorage.setItem(TOUR_KEY, '1')
    } catch {
      // ignore
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canPalette.current && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((x) => !x)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => setSheets([]), [leagueKey])

  // A new section fades its content in (the header stays put), so switching never flashes. Tabs within a page
  // switch instantly: they are flipped back and forth far too often to wait on.
  const view = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = view.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of root.children) if (!el.classList.contains('ff-pagehead')) el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
  }, [route.section])

  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  useEffect(() => {
    if (loaded) setLoadedAt(new Date())
  }, [loaded])

  const seasonOptions = useMemo(() => {
    const current = Number(data?.state.league_season ?? data?.state.season ?? new Date().getFullYear())
    return [current, current - 1, current - 2].map(String)
  }, [data])

  // Functional form, so two updates in one handler (Model's "Reset all") both land.
  const update = (patch: Partial<Prefs>) => setPrefs((p) => (p ? { ...p, ...patch } : p))

  const myTeam = analysis && analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  const mySeason = myTeam ? analysis!.seasonById[myTeam.rosterId] : null
  const myPower = myTeam ? analysis!.powerById[myTeam.rosterId] : null
  const mySim = myTeam && models?.forecast ? models.forecast.sim[myTeam.rosterId] : null
  const horizonWeeks = data?.horizon.map((h) => h.week) ?? []

  // Sidebar settings: one row per setting, label on the left, control filling the rest, all on the same 28px rhythm.
  const row = 'flex h-7 items-center gap-2'
  const key = 'ff-label w-[52px] shrink-0'
  const controls = prefs && (
    <>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Pricing horizon</Label>
          {horizonWeeks.length > 0 && (
            <span className="num text-[10.5px] text-ff-muted" title={HORIZON_LONG[prefs.horizon]}>
              wk {horizonWeeks[0]}–{horizonWeeks[horizonWeeks.length - 1]}
            </span>
          )}
        </div>
        <Segmented<HorizonMode>
          size="sm"
          block
          label="Pricing horizon"
          value={prefs.horizon}
          onChange={(h) => update({ horizon: h })}
          options={[
            { key: 'next6', label: '6 wks', title: HORIZON_LONG.next6 },
            { key: 'regular', label: 'Season', title: HORIZON_LONG.regular },
            { key: 'playoffs', label: '+ Playoffs', title: HORIZON_LONG.playoffs },
          ]}
        />
        {prefs.horizon === 'playoffs' && (data?.playoffWeeks.length ?? 0) > 0 && (
          <div className={row} title={`How much the fantasy playoff weeks (${data!.playoffWeeks.join(', ')}) count against a regular week`}>
            <span className={key}>Weight</span>
            <span className="flex h-full flex-1 items-center border border-ff-line bg-ff-panel">
              {(
                [
                  ['−', -0.5],
                  ['+', 0.5],
                ] as const
              ).map(([label, step], i) => (
                <React.Fragment key={label}>
                  {i === 1 && <span className="num flex-1 text-center text-[12px] text-ff-text">{prefs.playoffWeight}×</span>}
                  <button
                    className={cx('h-full w-7 text-ff-muted hover:bg-ff-raised hover:text-ff-text', i === 0 ? 'border-r border-ff-line' : 'border-l border-ff-line')}
                    aria-label={step < 0 ? 'Count playoff weeks less' : 'Count playoff weeks more'}
                    onClick={() => update({ playoffWeight: Math.max(0, Math.min(3, prefs.playoffWeight + step)) })}
                  >
                    {label}
                  </button>
                </React.Fragment>
              ))}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <div className={row}>
          <span className={key}>User</span>
          <UserMenu
            provider={prefs.provider}
            username={prefs.provider === 'espn' ? `ESPN ${prefs.espnLeagueId ?? ''}` : prefs.username}
            onSwitch={() => update({ onboarded: false })}
            onTour={() => setTour(true)}
          />
        </div>
        <div className={row}>
          <span className={key}>Season</span>
          <Select
            label="Season"
            value={prefs.season ?? seasonOptions[0]}
            onChange={(v) => update({ season: v === seasonOptions[0] ? null : v, leagueId: null })}
            className="flex-1 font-mono text-[11.5px] [&>button]:h-7"
          >
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className={row}>
          <span className={key}>Display</span>
          <DisplayMenu
            theme={prefs.theme}
            onTheme={(t) => update({ theme: t })}
            scheme={prefs.scheme}
            onScheme={(m) => update({ scheme: m })}
            density={prefs.density}
            onDensity={(d) => update({ density: d })}
          />
        </div>
      </div>
    </>
  )

  const section = route.section as SectionKey
  const title = data ? `${SECTIONS.find((s) => s.key === route.section)?.label ?? 'Fantasy'} · ${data.league.name}` : 'Fantasy'
  const status = [
    data?.state.season_type === 'regular' ? { label: 'WEEK', value: String(data.state.week), title: 'NFL week, from Sleeper\'s calendar' } : null,
    models?.forecast ? { label: 'SIMS', value: models.forecast.sims.toLocaleString(), title: 'Seasons simulated for the playoff odds' } : null,
    models?.forecast ? { label: 'σ', value: models.forecast.sigma.toFixed(1), title: 'Weekly score noise: how far a team-week strays from its projection' } : null,
    { label: 'ECR', value: data?.consensus ? 'on' : 'off', title: data?.consensus ? 'FantasyPros consensus ranks loaded' : 'FantasyPros consensus ranks unavailable' },
  ].filter((x): x is { label: string; value: string; title: string } => !!x)

  // Until prefs are read (first client render), draw nothing rather than flash the wrong screen.
  if (!prefs) return <div className="ff min-h-dvh bg-ff-bg" />
  if (!prefs.onboarded) {
    return (
      <Onboarding
        initial={{ provider: prefs.provider, username: prefs.username, espnLeagueId: prefs.espnLeagueId, espnTeamId: prefs.espnTeamId }}
        onDone={(r: OnboardResult) => {
          if (r.provider === 'espn') {
            const same = prefs.provider === 'espn' && r.leagueId === prefs.espnLeagueId
            update({ onboarded: true, provider: 'espn', espnLeagueId: r.leagueId, espnTeamId: r.teamId, season: same ? prefs.season : null })
            return
          }
          const same = prefs.provider !== 'espn' && r.username.toLowerCase() === prefs.username.trim().toLowerCase()
          update({ onboarded: true, provider: 'sleeper', username: r.username, leagueId: same ? prefs.leagueId : null, season: same ? prefs.season : null })
        }}
        onCancel={(prefs.provider === 'espn' ? prefs.espnLeagueId : prefs.username) ? () => update({ onboarded: true }) : undefined}
        cancelLabel={prefs.provider === 'espn' ? `keep ESPN league ${prefs.espnLeagueId}` : `keep @${prefs.username}`}
      />
    )
  }

  return (
    <Shell
      section={section}
      onNavigate={(s) => route.go(s)}
      title={title}
      leagues={(data?.leagues ?? []).map((l) => ({ id: l.league_id, name: l.name }))}
      leagueId={data?.league.league_id ?? null}
      onLeague={(id) => update({ leagueId: id })}
      leagueMeta={data ? `${data.league.season} · ${data.league.total_rosters} teams${data.state.season_type === 'regular' && data.league.season === data.state.season ? ` · wk ${data.state.week}` : ''}` : undefined}
      me={myTeam ? { name: myTeam.name, avatar: myTeam.avatar, line: `${mySeason ? `${mySeason.wins}-${mySeason.losses}${mySeason.ties ? `-${mySeason.ties}` : ''}` : ''}${mySim ? ` · ${simOdds(mySim, 'playoffs')} playoffs` : myPower ? ` · power rank #${myPower.rank} of ${analysis!.teams.length}` : ''}` } : null}
      controls={controls}
      controlsOpen={prefs.settingsOpen}
      onControls={(open) => update({ settingsOpen: open })}
      controlsSummary={`${HORIZON_SHORT[prefs.horizon]} · ${themeById(prefs.theme).label}`}
      loading={loading}
      progress={progress}
      onRefresh={reload}
      source={providerName(data?.provider ?? prefs.provider)}
      loadedAt={loadedAt}
      status={status}
      onSearch={data ? () => setPalette(true) : undefined}
      sidebar={prefs.sidebar}
      onSidebar={(open) => update({ sidebar: open })}
      tour={tour && appUp}
      onTourEnd={endTour}
    >
      {error && (
        <div className="mt-4 border border-ff-neg/40 bg-ff-neg/10 px-3 py-2.5 font-mono text-[12px] text-ff-neg">ERR · {error}</div>
      )}
      {data && data.warnings.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {data.warnings.map((w) => (
            <div key={w} className="font-mono text-[11px] text-ff-warn">
              ! {w}
            </div>
          ))}
        </div>
      )}

      {data && analysis && models && prefs ? (
        <FantasyProvider value={{ data, analysis, models, adjust, grades, go: (s, sub) => route.go(s, sub ?? undefined), ...sheetApi }}>
        <div key={data.league.league_id} ref={view} className={cx(loading && 'opacity-60 transition-opacity')}>
          {section === 'dash' && <DashboardView />}
          {section === 'trades' && <TradesView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'waivers' && <WaiversView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'me' && <MeView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} onTeam={(id) => route.go('teams', String(id))} />}
          {section === 'power' && (
            <PowerView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} onTeam={sheetApi.openTeam} weights={prefs.weights} />
          )}
          {section === 'teams' && (
            // Moving to another team keeps the page, so rosters can be compared.
            <TeamsView data={data} analysis={analysis} sub={route.sub} page={route.page} onPage={route.setPage} onTeam={(id) => route.go('teams', id == null ? null : String(id), { page: route.page })} />
          )}
          {section === 'players' && <PlayersView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'slate' && <SlateView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'matchups' && <MatchupsView />}
          {section === 'playoffs' && <PlayoffsView sub={route.sub} onSub={route.setSub} />}
          {(section === 'model' || section === 'monke') && (
            <ModelView
              key={section}
              mode={section === 'monke' ? 'readout' : 'tuning'}
              data={data}
              analysis={analysis}
              sub={route.sub}
              onSub={route.setSub}
              model={prefs.model}
              setModel={(m) => update({ model: m })}
              weights={prefs.weights}
              setWeights={(w) => update({ weights: w })}
              reload={reload}
            />
          )}
        </div>
        {sheets.length > 0 && <SheetHost stack={sheets} onBack={backSheet} onClose={closeSheet} />}
        <CommandPalette
          open={palette}
          onClose={closePalette}
          theme={prefs.theme}
          scheme={prefs.scheme}
          onTheme={(t) => update({ theme: t })}
          onScheme={(m) => update({ scheme: m })}
          density={prefs.density}
          onDensity={(d) => update({ density: d })}
          onReload={reload}
          source={providerName(data.provider)}
          onTour={() => setTour(true)}
          leagues={(data.leagues ?? []).map((l) => ({ id: l.league_id, name: l.name }))}
          onLeague={(id) => update({ leagueId: id })}
        />
        </FantasyProvider>
      ) : (
        !error && (
          // Padding, not margin: a top margin here collapses through to the page and shows a strip of body.
          <div className="pb-6">
            <div className="ff-bleed ff-gutter flex h-11 items-center gap-2.5 border-b border-ff-line font-mono text-[11.5px] text-ff-muted">
              <span className="ff-pulse h-1.5 w-1.5 shrink-0 bg-ff-warn" />
              <span className="ff-caret min-w-0 truncate">{loading ? progress : 'starting'}</span>
            </div>
            <div className="mt-4 grid gap-px border border-ff-line bg-ff-line lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-56 animate-pulse bg-ff-panel" />
              ))}
            </div>
          </div>
        )
      )}
    </Shell>
  )
}

export default FantasyPage
