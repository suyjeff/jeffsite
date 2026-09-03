import React, { useEffect, useMemo, useState } from 'react'
import FantasyShell from '../../components/fantasy/FantasyShell'
import ModelTab from '../../components/fantasy/ModelTab'
import MyTeamTab from '../../components/fantasy/MyTeamTab'
import PlayersTab from '../../components/fantasy/PlayersTab'
import PowerTab from '../../components/fantasy/PowerTab'
import TeamsTab from '../../components/fantasy/TeamsTab'
import { Tabs } from '../../components/fantasy/ui'
import { analyze } from '../../lib/fantasy/analysis'
import { DEFAULT_POWER_WEIGHTS, type PowerWeights } from '../../lib/fantasy/power'
import { useLeagueData, type LoadOptions } from '../../lib/fantasy/useLeagueData'
import { DEFAULT_MODEL, type ModelConfig } from '../../lib/fantasy/war'

type TabKey = 'power' | 'teams' | 'players' | 'me' | 'model'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'power', label: 'Power' },
  { key: 'teams', label: 'Teams' },
  { key: 'players', label: 'Players' },
  { key: 'me', label: 'My team' },
  { key: 'model', label: 'Model' },
]

const DEFAULT_USERNAME = 'thejeffanator'
const PREFS_KEY = 'ff:prefs'

type Prefs = {
  username: string
  leagueId: string | null
  season: string | null
  model: ModelConfig
  weights: PowerWeights
}

const loadPrefs = (): Prefs => {
  const base: Prefs = { username: DEFAULT_USERNAME, leagueId: null, season: null, model: DEFAULT_MODEL, weights: DEFAULT_POWER_WEIGHTS }
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
  const [tab, setTab] = useState<TabKey>('power')
  const [teamId, setTeamId] = useState<number | null>(null)

  useEffect(() => {
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
    () => (prefs ? { username: prefs.username, leagueId: prefs.leagueId, season: prefs.season } : null),
    [prefs?.username, prefs?.leagueId, prefs?.season], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const { data, error, loading, progress, reload } = useLeagueData(opts)

  const analysis = useMemo(() => (data && prefs ? analyze(data, prefs.model, prefs.weights) : null), [data, prefs?.model, prefs?.weights]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTeam = teamId ?? analysis?.myRosterId ?? analysis?.teams[0]?.rosterId ?? 0

  const seasonOptions = useMemo(() => {
    const current = Number(data?.state.league_season ?? data?.state.season ?? new Date().getFullYear())
    return [current, current - 1, current - 2].map(String)
  }, [data])

  const control = 'rounded border border-stone-200 bg-transparent px-2 py-1 text-sm dark:border-stone-800'

  return (
    <FantasyShell title={data ? `${data.league.name} · Fantasy` : 'Fantasy'}>
      {prefs && (
        <form
          className="flex flex-wrap items-center gap-2 mb-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (usernameInput.trim() && usernameInput.trim() !== prefs.username) setPrefs({ ...prefs, username: usernameInput.trim(), leagueId: null })
          }}
        >
          <input value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} className={`${control} w-40`} aria-label="Sleeper username" />
          <button type="submit" className="rounded border border-stone-300 px-2 py-1 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800">
            Load
          </button>
          <select value={prefs.season ?? seasonOptions[0]} onChange={(e) => setPrefs({ ...prefs, season: e.target.value === seasonOptions[0] ? null : e.target.value, leagueId: null })} className={control} aria-label="Season">
            {seasonOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {data && data.leagues.length > 0 && (
            <select value={data.league.league_id} onChange={(e) => setPrefs({ ...prefs, leagueId: e.target.value })} className={`${control} max-w-[260px]`} aria-label="League">
              {data.leagues.map((l) => (
                <option key={l.league_id} value={l.league_id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          {loading && <span className="text-stone-400 dark:text-stone-500 animate-pulse">{progress}…</span>}
          {!loading && data && (
            <button type="button" onClick={reload} className="text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200">
              refresh
            </button>
          )}
        </form>
      )}

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 mb-4">
          {error}
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs text-amber-800 dark:text-amber-300">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {data && analysis && prefs && (
        <>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-lg tracking-tight font-medium">{data.league.name}</span>{' '}
              <span className="text-sm text-stone-400 dark:text-stone-500">
                {data.league.season} · {data.league.total_rosters} teams · {data.state.season_type === 'regular' && data.league.season === data.state.season ? `week ${data.state.week}` : data.league.status?.replace('_', ' ')}
              </span>
            </div>
          </div>
          <div className="mb-4">
            <Tabs<TabKey> tabs={TABS} value={tab} onChange={setTab} />
          </div>
          {tab === 'power' && (
            <PowerTab
              data={data}
              analysis={analysis}
              onSelectTeam={(id) => {
                setTeamId(id)
                setTab('teams')
              }}
            />
          )}
          {tab === 'teams' && <TeamsTab data={data} analysis={analysis} rosterId={selectedTeam} onSelectTeam={setTeamId} />}
          {tab === 'players' && <PlayersTab data={data} analysis={analysis} />}
          {tab === 'me' && <MyTeamTab data={data} analysis={analysis} />}
          {tab === 'model' && (
            <ModelTab data={data} analysis={analysis} model={prefs.model} setModel={(m) => setPrefs({ ...prefs, model: m })} weights={prefs.weights} setWeights={(w) => setPrefs({ ...prefs, weights: w })} reload={reload} />
          )}
        </>
      )}

      {!data && !error && (
        <div className="text-sm text-stone-400 dark:text-stone-500">{loading ? `${progress}…` : 'Loading…'}</div>
      )}
    </FantasyShell>
  )
}

export default FantasyPage
