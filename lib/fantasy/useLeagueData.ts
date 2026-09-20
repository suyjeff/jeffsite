import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getPlayers,
  getRosters,
  getScoredProjections,
  getState,
  getTrendingAdds,
  getUser,
  getUserLeagues,
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
import type { Horizon } from './trades'
import type { WeekPoints } from './war'

export type PointsSource = 'stats' | 'matchups' | 'proxy-stats' | 'proxy-matchups' | 'none'

/** Where the forward-looking horizon came from, which changes how much to trust it. */
export type HorizonSource = 'projections' | 'results' | 'none'

/** Weeks of forward-looking projections to pull. Each is one ~650KB request. */
export const DEFAULT_HORIZON_WEEKS = 6

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
  /**
   * Per-week league-scored points for the weeks a trade made today would cover.
   * Built from live weekly projections when the season is running, so byes and
   * players ruled out already read as zero. Falls back to results already in
   * the books when there is nothing left to project.
   */
  horizon: Horizon
  horizonSource: HorizonSource
  trending: TrendingEntry[]
  warnings: string[]
}

export type LoadOptions = {
  username: string
  leagueId?: string | null
  season?: string | null
  /** How many weeks ahead to project. Defaults to DEFAULT_HORIZON_WEEKS. */
  horizonWeeks?: number
}

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
  else if (state.season_type === 'regular') {
    // `state.week` rolls over before the last games of the old week are final,
    // so a week can be "past" while its Monday night score is still moving.
    // `last_scored_leg` is the league's own answer to what is settled; take
    // whichever is earlier so a half-scored week never enters the model.
    const lastScored = league.settings?.last_scored_leg
    currentWeek = typeof lastScored === 'number' && lastScored >= 0 ? Math.min(state.week, lastScored + 1) : state.week
  } else currentWeek = startWeek

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

  // ---- Forward-looking horizon ----
  // Everything above looks backwards. A trade is a bet on the weeks still to
  // come, so it gets its own basis: one league-scored projection per player per
  // remaining week.
  let projections: Record<string, number> | null = null
  let projectionWeek: number | null = null
  let horizon: Horizon = []
  let horizonSource: HorizonSource = 'none'
  let trending: TrendingEntry[] = []

  const upcoming = state.season_type === 'pre' ? startWeek : Math.max(state.week, currentWeek)
  const horizonLen = Math.max(1, opts.horizonWeeks ?? DEFAULT_HORIZON_WEEKS)
  const horizonWeeks =
    isCurrentSeason && (state.season_type === 'regular' || state.season_type === 'pre')
      ? weekList.filter((w) => w >= upcoming && w < playoffStart).slice(0, horizonLen)
      : []

  if (horizonWeeks.length) {
    onProgress(`Projecting weeks ${horizonWeeks[0]}–${horizonWeeks[horizonWeeks.length - 1]}`)
    const projResults = await settled(
      horizonWeeks.map((w) => getScoredProjections(league.league_id, league.season, w, league.scoring_settings)),
    )
    horizonWeeks.forEach((w, i) => {
      const raw = projResults[i]
      if (!raw || !Object.keys(raw).length) return
      const pts: Record<string, number> = {}
      for (const id of Object.keys(raw)) if (players[id]) pts[id] = raw[id]
      if (Object.keys(pts).length) horizon.push({ week: w, pts })
    })
    if (horizon.length) {
      horizonSource = 'projections'
      projectionWeek = horizon[0].week
      projections = horizon[0].pts
      if (horizon.length < horizonWeeks.length) {
        warnings.push(`Projections missing for ${horizonWeeks.length - horizon.length} of the next ${horizonWeeks.length} weeks.`)
      }
    }
  }

  if (!horizon.length && valueWeeks.length) {
    // No projections to be had — a finished season, or the feed is down. Price
    // trades off what already happened and say so, because it is a weaker basis.
    horizon = valueWeeks.map((w) => ({ week: w, pts: weekPoints[w] ?? {} }))
    horizonSource = 'results'
    warnings.push(`Projections unavailable; trade values use ${valueSeason} results instead of the weeks ahead.`)
  }

  if (isCurrentSeason && (state.season_type === 'regular' || state.season_type === 'pre')) {
    const [trend] = await settled([getTrendingAdds(24, 50)])
    if (Array.isArray(trend)) trending = trend
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
    horizon,
    horizonSource,
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
  }, [opts?.username, opts?.leagueId, opts?.season, opts?.horizonWeeks, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, progress, reload }
}
