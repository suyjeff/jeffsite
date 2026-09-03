import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getPlayers,
  getRosters,
  getState,
  getTrendingAdds,
  getUser,
  getUserLeagues,
  getWeekProjections,
  getWeekStats,
} from './sleeper'
import { scoreStatLine, statLinePlayed } from './scoring'
import type {
  PlayerMap,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperState,
  SleeperUser,
  TrendingEntry,
  WeekStats,
} from './types'
import type { WeekPoints } from './war'

export type PointsSource = 'stats' | 'matchups' | 'proxy-stats' | 'proxy-matchups' | 'none'

export type LeagueData = {
  state: SleeperState
  me: SleeperUser
  leagues: SleeperLeague[]
  league: SleeperLeague
  users: SleeperUser[]
  rosters: SleeperRoster[]
  players: PlayerMap
  matchupsByWeek: Record<number, SleeperMatchup[]>
  /** Completed regular-season weeks (standings, power). */
  regularWeeks: number[]
  /** Regular-season weeks still to be played (strength of schedule). */
  futureWeeks: number[]
  /** Weeks feeding the player model, in the season named by `valueSeason`. */
  valueWeeks: number[]
  valueSeason: string
  weekPoints: WeekPoints
  pointsSource: PointsSource
  /** Projected points for the upcoming week in league scoring, when available. */
  projections: Record<string, number> | null
  projectionWeek: number | null
  trending: TrendingEntry[]
  warnings: string[]
}

export type LoadOptions = { username: string; leagueId?: string | null; season?: string | null }

const MAX_WEEK = 18

const settled = async <T>(promises: Promise<T>[]): Promise<(T | null)[]> => {
  const results = await Promise.allSettled(promises)
  return results.map((r) => (r.status === 'fulfilled' ? r.value : null))
}

const weekHasScores = (ms: SleeperMatchup[] | null | undefined) =>
  !!ms && ms.some((m) => (m.points ?? 0) > 0)

/** League-scored points for every player who played that week, from a raw stat dump. */
const pointsFromStats = (
  stats: WeekStats,
  players: PlayerMap,
  scoring: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const id of Object.keys(stats)) {
    if (!players[id]) continue
    const line = stats[id]
    if (!statLinePlayed(line)) continue
    out[id] = scoreStatLine(line, scoring)
  }
  return out
}

/** Points for rostered players straight from the league's matchup payloads. */
const pointsFromMatchups = (ms: SleeperMatchup[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const m of ms) {
    const pp = m.players_points ?? {}
    for (const id of Object.keys(pp)) out[id] = pp[id]
  }
  return out
}

export const loadLeagueData = async (
  opts: LoadOptions,
  onProgress: (msg: string) => void = () => {},
): Promise<LeagueData> => {
  const warnings: string[] = []
  onProgress('Looking up user and NFL state')
  const [state, me] = await Promise.all([getState(), getUser(opts.username.trim())])
  if (!me?.user_id) throw new Error(`Sleeper user "${opts.username}" not found`)

  const currentSeason = state.league_season ?? state.season
  const season = opts.season ?? currentSeason
  onProgress(`Loading ${season} leagues`)
  let leagues = await getUserLeagues(me.user_id, season)
  if ((!leagues || leagues.length === 0) && !opts.season && state.previous_season) {
    leagues = await getUserLeagues(me.user_id, state.previous_season)
    if (leagues?.length) warnings.push(`No ${season} leagues yet; showing ${state.previous_season}.`)
  }
  if (!leagues?.length) throw new Error(`No NFL leagues found for ${me.display_name ?? opts.username} in ${season}`)

  const chosen = leagues.find((l) => l.league_id === opts.leagueId) ?? leagues[0]

  onProgress(`Loading ${chosen.name}`)
  const [league, rosters, users, players] = await Promise.all([
    getLeague(chosen.league_id),
    getRosters(chosen.league_id),
    getLeagueUsers(chosen.league_id),
    getPlayers(),
  ])

  const startWeek = league.settings?.start_week ?? 1
  const playoffStart = league.settings?.playoff_week_start ?? 15
  const isCurrentSeason = league.season === state.season
  let currentWeek: number
  if (!isCurrentSeason || state.season_type === 'post' || league.status === 'complete') currentWeek = MAX_WEEK + 1
  else if (state.season_type === 'regular') currentWeek = state.week
  else currentWeek = startWeek

  onProgress('Loading matchups')
  const weekList = Array.from({ length: MAX_WEEK - startWeek + 1 }, (_, i) => startWeek + i)
  const matchupResults = await settled(
    weekList.map((w) => getMatchups(league.league_id, w, w < currentWeek)),
  )
  const matchupsByWeek: Record<number, SleeperMatchup[]> = {}
  weekList.forEach((w, i) => {
    if (matchupResults[i]) matchupsByWeek[w] = matchupResults[i]!
  })

  const playedWeeks = weekList.filter((w) => w < currentWeek && weekHasScores(matchupsByWeek[w]))
  const regularWeeks = playedWeeks.filter((w) => w < playoffStart)
  const futureWeeks = weekList.filter((w) => w >= currentWeek && w < playoffStart)

  // ---- Player points for the value model ----
  let weekPoints: WeekPoints = {}
  let valueWeeks: number[] = []
  let valueSeason = league.season
  let pointsSource: PointsSource = 'none'

  if (playedWeeks.length) {
    onProgress('Loading player stats')
    const statResults = await settled(
      playedWeeks.map((w) => getWeekStats(league.season, w, w < currentWeek)),
    )
    let statWeeks = 0
    playedWeeks.forEach((w, i) => {
      const fromMatchups = pointsFromMatchups(matchupsByWeek[w] ?? [])
      const stats = statResults[i]
      if (stats && Object.keys(stats).length) {
        statWeeks++
        weekPoints[w] = { ...pointsFromStats(stats, players, league.scoring_settings), ...fromMatchups }
      } else {
        weekPoints[w] = fromMatchups
      }
    })
    valueWeeks = playedWeeks
    pointsSource = statWeeks ? 'stats' : 'matchups'
    if (!statWeeks) warnings.push('Sleeper stats feed unavailable; replacement level is estimated from rostered players only.')
    else if (statWeeks < playedWeeks.length) warnings.push(`Stats feed missing for ${playedWeeks.length - statWeeks} week(s); those weeks use rostered players only.`)
  } else {
    // Preseason: nothing scored yet. Use last season as a proxy for player value.
    const prevSeason = String(Number(league.season) - 1)
    onProgress(`No games played yet; loading ${prevSeason} as a proxy`)
    const proxyWeeks = Array.from({ length: 17 }, (_, i) => i + 1)
    const statResults = await settled(proxyWeeks.map((w) => getWeekStats(prevSeason, w, true)))
    const good = proxyWeeks.filter((_, i) => statResults[i] && Object.keys(statResults[i]!).length)
    if (good.length) {
      good.forEach((w) => {
        weekPoints[w] = pointsFromStats(statResults[w - 1]!, players, league.scoring_settings)
      })
      valueWeeks = good
      valueSeason = prevSeason
      pointsSource = 'proxy-stats'
    } else if (league.previous_league_id) {
      const prevMatchups = await settled(
        proxyWeeks.map((w) => getMatchups(league.previous_league_id!, w, true)),
      )
      proxyWeeks.forEach((w, i) => {
        if (weekHasScores(prevMatchups[i])) weekPoints[w] = pointsFromMatchups(prevMatchups[i]!)
      })
      valueWeeks = Object.keys(weekPoints).map(Number)
      valueSeason = prevSeason
      pointsSource = valueWeeks.length ? 'proxy-matchups' : 'none'
      if (valueWeeks.length) warnings.push('Stats feed unavailable; player values use last year\'s league matchups (rostered players only).')
    }
    if (pointsSource === 'none') warnings.push('No scoring data available yet. Player values will appear after week 1.')
    else warnings.push(`Season not started: player values are based on ${prevSeason} results with this league's scoring.`)
  }

  // ---- Optional extras ----
  let projections: Record<string, number> | null = null
  let projectionWeek: number | null = null
  let trending: TrendingEntry[] = []
  if (isCurrentSeason && (state.season_type === 'regular' || state.season_type === 'pre')) {
    projectionWeek = state.season_type === 'pre' ? startWeek : state.week
    onProgress(`Loading week ${projectionWeek} projections`)
    const [proj, trend] = await settled<unknown>([
      getWeekProjections(league.season, projectionWeek),
      getTrendingAdds(24, 50),
    ])
    if (proj && typeof proj === 'object') {
      projections = {}
      const raw = proj as WeekStats
      for (const id of Object.keys(raw)) {
        if (!players[id]) continue
        const pts = scoreStatLine(raw[id], league.scoring_settings)
        if (pts) projections[id] = pts
      }
    } else {
      projectionWeek = null
    }
    if (Array.isArray(trend)) trending = trend as TrendingEntry[]
  }

  return {
    state,
    me,
    leagues,
    league,
    users,
    rosters,
    players,
    matchupsByWeek,
    regularWeeks,
    futureWeeks,
    valueWeeks,
    valueSeason,
    weekPoints,
    pointsSource,
    projections,
    projectionWeek,
    trending,
    warnings,
  }
}

export const useLeagueData = (opts: LoadOptions | null) => {
  const [data, setData] = useState<LeagueData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [nonce, setNonce] = useState(0)
  const active = useRef(0)

  useEffect(() => {
    if (!opts) return
    const id = ++active.current
    setLoading(true)
    setError(null)
    loadLeagueData(opts, (msg) => {
      if (active.current === id) setProgress(msg)
    })
      .then((d) => {
        if (active.current === id) setData(d)
      })
      .catch((e: unknown) => {
        if (active.current !== id) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(/Failed to fetch|NetworkError/i.test(msg) ? `Could not reach the Sleeper API (${msg}).` : msg)
      })
      .finally(() => {
        if (active.current === id) setLoading(false)
      })
  }, [opts?.username, opts?.leagueId, opts?.season, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, progress, reload }
}
