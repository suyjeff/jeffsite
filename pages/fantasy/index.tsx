import React, { useEffect, useMemo, useState } from 'react'
import Shell, { SECTION_KEYS, type SectionKey } from '../../components/fantasy/Shell'
import { Label, Segmented, cx } from '../../components/fantasy/ui'
import MeView from '../../components/fantasy/views/MeView'
import ModelView from '../../components/fantasy/views/ModelView'
import PlayersView from '../../components/fantasy/views/PlayersView'
import PowerView from '../../components/fantasy/views/PowerView'
import TeamsView from '../../components/fantasy/views/TeamsView'
import TradesView from '../../components/fantasy/views/TradesView'
import { analyze } from '../../lib/fantasy/analysis'
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

const DEFAULT_USERNAME = 'thejeffanator'
const PREFS_KEY = 'ff:prefs'

export type Prefs = {
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
    username: DEFAULT_USERNAME,
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
    return { ...base, ...p, model: { ...DEFAULT_MODEL, ...(p.model ?? {}) }, weights: { ...DEFAULT_POWER_WEIGHTS, ...(p.weights ?? {}) } }
  } catch {
    return base
  }
}

const FantasyPage = () => {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [usernameInput, setUsernameInput] = useState(DEFAULT_USERNAME)
  const route = useRoute(SECTION_KEYS, 'trades')

  useEffect(() => {
    purgeStaleCache()
    const p = loadPrefs()
    setPrefs(p)
    setUsernameInput(p.username)
  }, [])
  useEffect(() => {
    if (!prefs) return
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // ignore
    }
  }, [prefs])

  const opts = useMemo<LoadOptions | null>(
    () =>
      prefs
        ? { username: prefs.username, leagueId: prefs.leagueId, season: prefs.season, horizon: prefs.horizon, playoffWeight: prefs.playoffWeight }
        : null,
    [prefs?.username, prefs?.leagueId, prefs?.season, prefs?.horizon, prefs?.playoffWeight], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const { data, error, loading, progress, reload } = useLeagueData(opts)
  const analysis = useMemo(() => (data && prefs ? analyze(data, prefs.model, prefs.weights) : null), [data, prefs?.model, prefs?.weights]) // eslint-disable-line react-hooks/exhaustive-deps

  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  useEffect(() => {
    if (data) setLoadedAt(new Date())
  }, [data])

  const seasonOptions = useMemo(() => {
    const current = Number(data?.state.league_season ?? data?.state.season ?? new Date().getFullYear())
    return [current, current - 1, current - 2].map(String)
  }, [data])

  // Functional form, so two updates in one handler (Model's "Reset all") both land.
  const update = (patch: Partial<Prefs>) => setPrefs((p) => (p ? { ...p, ...patch } : p))

  const myTeam = analysis && analysis.myRosterId != null ? analysis.teamById[analysis.myRosterId] : null
  const mySeason = myTeam ? analysis!.seasonById[myTeam.rosterId] : null
  const myPower = myTeam ? analysis!.powerById[myTeam.rosterId] : null
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
          <span className="text-[12px] text-ff-text2">
            Playoff weeks count <span className="num text-ff-muted">({data!.playoffWeeks.join(', ')})</span>
          </span>
          <span className="flex items-center rounded-md border border-ff-line bg-ff-sunken">
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
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const u = usernameInput.trim()
          if (u && u !== prefs.username) update({ username: u, leagueId: null })
        }}
      >
        <input
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          aria-label="Sleeper username"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-ff-line bg-ff-sunken px-2 font-mono text-[11.5px] text-ff-text outline-none focus-visible:ring-2 focus-visible:ring-ff-accent/40"
        />
        <select
          aria-label="Season"
          value={prefs.season ?? seasonOptions[0]}
          onChange={(e) => update({ season: e.target.value === seasonOptions[0] ? null : e.target.value, leagueId: null })}
          className="h-7 rounded-md border border-ff-line bg-ff-sunken px-1.5 font-mono text-[11.5px] text-ff-text"
        >
          {seasonOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </form>
    </>
  )

  const section = route.section as SectionKey
  const title = data ? `${route.section === 'me' ? 'My team' : route.section[0].toUpperCase() + route.section.slice(1)} · ${data.league.name}` : 'Fantasy'

  return (
    <Shell
      section={section}
      onNavigate={(s) => route.go(s)}
      title={title}
      leagues={(data?.leagues ?? []).map((l) => ({ id: l.league_id, name: l.name }))}
      leagueId={data?.league.league_id ?? null}
      onLeague={(id) => update({ leagueId: id })}
      leagueMeta={data ? `${data.league.season} · ${data.league.total_rosters} teams${data.state.season_type === 'regular' && data.league.season === data.state.season ? ` · wk ${data.state.week}` : ''}` : undefined}
      me={myTeam ? { name: myTeam.name, avatar: myTeam.avatar, line: `${mySeason ? `${mySeason.wins}-${mySeason.losses}${mySeason.ties ? `-${mySeason.ties}` : ''}` : ''}${myPower ? ` · power #${myPower.rank} of ${analysis!.teams.length}` : ''}` } : null}
      controls={controls}
      loading={loading}
      progress={progress}
      onRefresh={reload}
      loadedAt={loadedAt}
    >
      {error && (
        <div className="mt-4 rounded-lg border border-ff-neg/40 bg-ff-neg/10 px-3 py-2.5 text-[13px] text-ff-neg">{error}</div>
      )}
      {data && data.warnings.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {data.warnings.map((w) => (
            <div key={w} className="text-[11.5px] text-ff-warn">
              {w}
            </div>
          ))}
        </div>
      )}

      {data && analysis && prefs ? (
        <div key={data.league.league_id} className={cx(loading && 'opacity-60 transition-opacity')}>
          {section === 'trades' && <TradesView data={data} analysis={analysis} sub={route.sub} onSub={route.setSub} />}
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
      ) : (
        !error && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-ff-muted">
              <span className="ff-pulse h-1.5 w-1.5 rounded-full bg-ff-warn" />
              {loading ? `${progress}…` : 'Starting…'}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-56 animate-pulse rounded-lg border border-ff-line bg-ff-panel" />
              ))}
            </div>
          </div>
        )
      )}
    </Shell>
  )
}

export default FantasyPage
