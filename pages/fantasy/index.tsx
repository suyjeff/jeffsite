import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FantasyProvider } from '../../components/fantasy/FantasyContext'
import PlayerSheet from '../../components/fantasy/PlayerSheet'
import Shell, { SECTION_KEYS, SECTIONS, type SectionKey } from '../../components/fantasy/Shell'
import { Label, Segmented, Select, cx, simOdds } from '../../components/fantasy/ui'
import DashboardView from '../../components/fantasy/views/DashboardView'
import Onboarding from '../../components/fantasy/Onboarding'
import MeView from '../../components/fantasy/views/MeView'
import ModelView from '../../components/fantasy/views/ModelView'
import PlayersView from '../../components/fantasy/views/PlayersView'
import PowerView from '../../components/fantasy/views/PowerView'
import TeamsView from '../../components/fantasy/views/TeamsView'
import WaiversView from '../../components/fantasy/views/WaiversView'
import TradesView from '../../components/fantasy/views/TradesView'
import { applyAdjustments, liveAdjustments, loadAdjustments, saveAdjustments, type Adjustment, type Adjustments } from '../../lib/fantasy/adjust'
import { analyze, withWeights } from '../../lib/fantasy/analysis'
import { buildHistory, buildModels } from '../../lib/fantasy/models'
import { DEFAULT_POWER_WEIGHTS, type PowerWeights } from '../../lib/fantasy/power'
import { purgeStaleCache } from '../../lib/fantasy/sleeper'
import {
  DEFAULT_HORIZON_MODE,
  DEFAULT_PLAYOFF_WEIGHT,
  useLeagueData,
  type HorizonMode,
  type LoadOptions,
} from '../../lib/fantasy/useLeagueData'
import { useRoute } from '../../lib/fantasy/useRoute'
import { DEFAULT_MODEL, type ModelConfig } from '../../lib/fantasy/war'

const PREFS_KEY = 'ff:prefs'

export type Prefs = {
  /** True once a username has been confirmed against Sleeper; until then the page shows onboarding. */
  onboarded: boolean
  username: string
  leagueId: string | null
  season: string | null
  horizon: HorizonMode
  playoffWeight: number
  model: ModelConfig
  weights: PowerWeights
}

const loadPrefs = (): Prefs => {
  const base: Prefs = {
    onboarded: false,
    username: '',
    leagueId: null,
    season: null,
    horizon: DEFAULT_HORIZON_MODE,
    playoffWeight: DEFAULT_PLAYOFF_WEIGHT,
    model: DEFAULT_MODEL,
    weights: DEFAULT_POWER_WEIGHTS,
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return base
    const p = JSON.parse(raw) as Partial<Prefs>
    // Prefs saved before onboarding existed carry a username but no flag: they get the (pre-filled) form once.
    return { ...base, ...p, onboarded: p.onboarded === true && !!p.username, model: { ...DEFAULT_MODEL, ...(p.model ?? {}) }, weights: { ...DEFAULT_POWER_WEIGHTS, ...(p.weights ?? {}) } }
  } catch {
    return base
  }
}

const FantasyPage = () => {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const route = useRoute(SECTION_KEYS, 'dash')
  // Waivers moved out of My team into their own section; old links still land there.
  useEffect(() => {
    if (route.section === 'me' && route.sub === 'waivers') route.go('waivers', 'adds', { replace: true })
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
  const opts = useMemo<LoadOptions | null>(
    () =>
      prefs && ready
        ? { username: prefs.username, leagueId: prefs.leagueId, season: prefs.season, horizon: prefs.horizon, playoffWeight: prefs.playoffWeight }
        : null,
    [ready, prefs?.username, prefs?.leagueId, prefs?.season, prefs?.horizon, prefs?.playoffWeight], // eslint-disable-line react-hooks/exhaustive-deps
  )
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

  // The player detail sheet, open over whatever page you are on.
  const [sheet, setSheet] = useState<string | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  useEffect(() => setSheet(null), [leagueKey])

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

  const controls = prefs && (
    <>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <Label>Pricing horizon</Label>
          {horizonWeeks.length > 0 && (
            <span className="num text-[10.5px] text-ff-muted">
              wk {horizonWeeks[0]}–{horizonWeeks[horizonWeeks.length - 1]}
            </span>
          )}
        </div>
        <Segmented<HorizonMode>
          size="sm"
          label="Pricing horizon"
          value={prefs.horizon}
          onChange={(h) => update({ horizon: h })}
          options={[
            { key: 'next6', label: '6 wks', title: 'The next six regular-season weeks' },
            { key: 'regular', label: 'Season', title: 'Everything left before the fantasy playoffs' },
            { key: 'playoffs', label: '+ Playoffs', title: 'Everything left, fantasy playoffs included' },
          ]}
        />
      </div>
      {prefs.horizon === 'playoffs' && (data?.playoffWeeks.length ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 leading-tight">
            <span className="block text-[12px] text-ff-text2">Playoff weight</span>
            <span className="num block text-[10px] text-ff-muted">wk {data!.playoffWeeks.join(' ')}</span>
          </span>
          <span className="flex items-center border border-ff-line bg-ff-panel">
            {(
              [
                ['−', -0.5],
                ['+', 0.5],
              ] as const
            ).map(([label, step], i) => (
              <React.Fragment key={label}>
                {i === 1 && <span className="num w-9 text-center text-[12px] text-ff-text">{prefs.playoffWeight}×</span>}
                <button
                  className="h-6 w-6 text-ff-muted hover:text-ff-text"
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
      <div className="space-y-1.5">
        <div className="flex h-8 items-center justify-between gap-2 border border-ff-line bg-ff-panel pl-2.5">
          <span className="min-w-0 truncate font-mono text-[11.5px] text-ff-text" title="Sleeper username">
            @{prefs.username}
          </span>
          <button type="button" onClick={() => update({ onboarded: false })} className="h-full shrink-0 border-l border-ff-line px-2.5 font-mono text-[10.5px] text-ff-muted hover:bg-ff-raised hover:text-ff-text">
            switch
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label>Season</Label>
          <Select
            label="Season"
            value={prefs.season ?? seasonOptions[0]}
            onChange={(v) => update({ season: v === seasonOptions[0] ? null : v, leagueId: null })}
            className="w-[84px] shrink-0 font-mono text-[11.5px]"
          >
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </>
  )

  const section = route.section as SectionKey
  const title = data ? `${SECTIONS.find((s) => s.key === route.section)?.label ?? 'Fantasy'} · ${data.league.name}` : 'Fantasy'
  const status = [
    data?.state.season_type === 'regular' ? `WK ${String(data.state.week).padStart(2, '0')}` : null,
    models?.forecast ? `SIM ${models.forecast.sims}` : null,
    models?.forecast ? `σ ${models.forecast.sigma.toFixed(1)}` : null,
    data?.consensus ? 'ECR ✓' : null,
  ].filter((x): x is string => !!x)

  // Until prefs are read (first client render), draw nothing rather than flash the wrong screen.
  if (!prefs) return <div className="ff min-h-screen bg-ff-bg" />
  if (!prefs.onboarded) {
    return (
      <Onboarding
        initial={prefs.username}
        onDone={(username) => {
          const same = username.toLowerCase() === prefs.username.trim().toLowerCase()
          update({ onboarded: true, username, leagueId: same ? prefs.leagueId : null, season: same ? prefs.season : null })
        }}
        onCancel={prefs.username ? () => update({ onboarded: true }) : undefined}
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
      me={myTeam ? { name: myTeam.name, avatar: myTeam.avatar, line: `${mySeason ? `${mySeason.wins}-${mySeason.losses}${mySeason.ties ? `-${mySeason.ties}` : ''}` : ''}${mySim ? ` · ${simOdds(mySim, 'playoffs')} playoffs` : myPower ? ` · power #${myPower.rank} of ${analysis!.teams.length}` : ''}` } : null}
      controls={controls}
      loading={loading}
      progress={progress}
      onRefresh={reload}
      loadedAt={loadedAt}
      status={status}
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
        <FantasyProvider value={{ data, analysis, models, adjust, go: (s, sub) => route.go(s, sub ?? undefined), openPlayer: setSheet }}>
        <div key={data.league.league_id} className={cx(loading && 'opacity-60 transition-opacity')}>
          {section === 'dash' && <DashboardView />}
          {section === 'trades' && <TradesView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'waivers' && <WaiversView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'me' && <MeView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} onTeam={(id) => route.go('teams', String(id))} />}
          {section === 'power' && (
            <PowerView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} onTeam={(id) => route.go('teams', String(id))} weights={prefs.weights} />
          )}
          {section === 'teams' && <TeamsView data={data} analysis={analysis} sub={route.sub} onTeam={(id) => route.go('teams', String(id))} />}
          {section === 'players' && <PlayersView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
          {section === 'model' && (
            <ModelView
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
        {sheet && data.players[sheet] && <PlayerSheet id={sheet} onClose={closeSheet} />}
        </FantasyProvider>
      ) : (
        !error && (
          // Padding, not margin: a top margin here collapses through to the page and shows a strip of body.
          <div className="pb-6">
            <div className="-mx-3 flex h-11 items-center gap-2.5 border-b border-ff-line px-3 font-mono text-[11.5px] text-ff-muted md:-mx-5 md:px-5">
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
