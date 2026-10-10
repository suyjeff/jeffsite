import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getPlayers,
  getRosters,
  getConsensusCsv,
  getDraftBoard,
  getLines,
  getScoredProjections,
  getSchedule,
  getSeasonGamesPlayed,
  getState,
  getTransactions,
  getTrendingAdds,
  getUser,
  getUserLeagues,
  getWeekStatLines,
  getWeekStats,
} from './sleeper'
import {
  buildEspnIndex,
  convertEspnLeague,
  EspnError,
  espnLeagueSettings,
  espnUnnamedPlayers,
  espnUserId,
  findEspnLeague,
  getEspnLeague,
  getEspnPlayerNames,
  getEspnWeek,
  nflSeasons,
  type EspnWeek,
} from './espn'
import { scoreStatLine, statLinePlayed } from './scoring'
import type { ScheduleGame } from './context'
import type {
  DraftBoard,
  PlayerMap,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperState,
  SleeperTransaction,
  SleeperUser,
  TrendingEntry,
  WeekStats,
} from './types'
import {
  adjustHorizon,
  availabilityRates,
  buildSchedule,
  usageFromStats,
  type Availability,
  type PlayerContext,
  type Schedule,
  type SeasonGames,
  type Usage,
} from './context'
import { matchConsensus, reduceConsensusCsv, type Consensus } from './consensus'
import { blendWeek, marketWeek, reduceLines, saveSnapshot, type LineRow, type MarketWeek } from './lines'
import type { Horizon } from './trades'
import type { WeekPoints } from './war'

export type PointsSource = 'stats' | 'matchups' | 'proxy-stats' | 'proxy-matchups' | 'none'

/** Where the forward-looking horizon came from, which changes how much to trust it. */
export type HorizonSource = 'projections' | 'results' | 'none'

/**
 * How far ahead a trade is priced. Each week is one ~650KB projection request
 * the first time, then ~20KB from cache.
 *   next6    the next six regular-season weeks
 *   regular  everything left before the fantasy playoffs
 *   playoffs everything left, fantasy playoffs included
 */
export type HorizonMode = 'next6' | 'regular' | 'playoffs'
export const DEFAULT_HORIZON_MODE: HorizonMode = 'playoffs'
/** Playoff weeks count this many times a regular-season week by default. */
export const DEFAULT_PLAYOFF_WEIGHT = 1

/** Games each NFL team plays in a regular season since 2021. */
const TEAM_GAMES = 17

/** Where a league lives. Everything but the league itself comes from Sleeper either way. */
export type Provider = 'sleeper' | 'espn'

/** The platform's name, for copy that points a manager back to it ("Read it in ESPN"). */
export const providerName = (p: Provider | undefined) => (p === 'espn' ? 'ESPN' : 'Sleeper')

export type LeagueData = {
  provider: Provider
  /** Whether a trade can include FAAB: Sleeper's can, ESPN's cannot. Every trade-FAAB control and suggestion reads this. */
  tradeFaab: boolean
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
  /** The same weeks before injury and role adjustments: Sleeper's projection, with the coming week blended with prop lines when there are any. */
  rawHorizon: Horizon
  /** Per-player adjustments and the reasons for them: availability, role changes, schedule. */
  context: Record<string, PlayerContext>
  availability: Record<string, Availability>
  usage: Record<string, Usage>
  schedule: Schedule | null
  horizonMode: HorizonMode
  playoffWeight: number
  /** Fantasy playoff weeks for this league. */
  playoffWeeks: number[]
  trending: TrendingEntry[]
  /** This season's transactions, every type. */
  transactions: SleeperTransaction[]
  /**
   * Last season of the same league, when Sleeper links one: results seed the
   * rating model's prior and lengthen its backtest; trades lengthen the
   * behaviour record. Roster ids are remapped onto this season's by owner.
   */
  history: LeagueHistory | null
  /** Sleeper's own projection for each completed week, for the backtest. */
  pastProjections: Record<number, Record<string, number>>
  /** FantasyPros consensus, when the mirror could be read. */
  consensus: Consensus | null
  /** The league's draft order, when it has had a draft: where managers anchor what a player is worth. */
  draft?: DraftBoard | null
  /** Prop lines for the coming week, read as expected stats and points, when the board has them. */
  market: MarketWeek | null
  warnings: string[]
}

export type LeagueHistory = {
  league: SleeperLeague
  season: string
  matchupsByWeek: Record<number, SleeperMatchup[]>
  /** Completed regular-season weeks. */
  weeks: number[]
  transactions: SleeperTransaction[]
  /** Last season's roster id -> this season's roster id with the same owner. */
  rosterMap: Record<number, number>
}

type CommonOptions = {
  season?: string | null
  horizon?: HorizonMode
  playoffWeight?: number
}

/** Saved settings from before ESPN support carry no provider: those are Sleeper. */
export type LoadOptions = CommonOptions &
  (
    | { provider?: 'sleeper'; username: string; leagueId?: string | null }
    | { provider: 'espn'; /** ESPN's league id, the number after leagueId= in its address bar. */ leagueId: string; teamId?: number | null }
  )

/** What the ESPN branch hands the shared pipeline besides the league itself. */
type EspnExtras = { transactions: SleeperTransaction[]; draft: DraftBoard | null; history: LeagueHistory | null }

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

/**
 * The league's playoff weeks. Each round is one week unless the settings say
 * the championship (round type 1) or every round (type 2) runs two.
 */
export const fantasyPlayoffWeeks = (league: SleeperLeague): number[] => {
  const start = league.settings?.playoff_week_start
  const teams = Number(league.settings?.playoff_teams ?? 0)
  if (!start || teams < 2) return []
  const rounds = Math.ceil(Math.log2(teams))
  const roundType = Number(league.settings?.playoff_round_type ?? 0)
  const weeks = roundType === 2 ? rounds * 2 : roundType === 1 ? rounds + 1 : rounds
  return Array.from({ length: weeks }, (_, i) => start + i).filter((w) => w <= MAX_WEEK)
}

/** Games played this season, against the games each team has actually played. */
const currentSeasonGames = (weeks: { week: number; stats: WeekStats }[], schedule: Schedule | null) => {
  if (!weeks.length || !schedule) return null
  const gp: Record<string, number> = {}
  for (const { stats } of weeks) for (const id of Object.keys(stats)) if (stats[id]?.gp) gp[id] = (gp[id] ?? 0) + 1
  const teamGames: Record<string, number> = {}
  for (const team of Object.keys(schedule.opp)) teamGames[team] = weeks.filter(({ week }) => schedule.opp[team][week]).length
  return { gp, teamGames }
}

/** The first week not yet settled: a finished season is past every week, a preseason one starts at its first. */
const currentWeekOf = (league: SleeperLeague, state: SleeperState) => {
  const startWeek = league.settings?.start_week ?? 1
  const isCurrentSeason = league.season === state.season
  if (!isCurrentSeason || state.season_type === 'post' || league.status === 'complete') return MAX_WEEK + 1
  if (state.season_type === 'regular') {
    // `state.week` rolls over before the last games of the old week are final,
    // so a week can be "past" while its Monday night score is still moving.
    // `last_scored_leg` is the league's own answer to what is settled; take
    // whichever is earlier so a half-scored week never enters the model.
    const lastScored = league.settings?.last_scored_leg
    return typeof lastScored === 'number' && lastScored >= 0 ? Math.min(state.week, lastScored + 1) : state.week
  }
  return startWeek
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)

/**
 * An ESPN league in the shapes the rest of the loader reads. The league, its
 * rosters and lineups come from ESPN; players are Sleeper's, matched by id.
 */
const loadEspn = async (
  opts: Extract<LoadOptions, { provider: 'espn' }>,
  state: SleeperState,
  warnings: string[],
  onProgress: (msg: string) => void,
) => {
  const id = opts.leagueId.trim()
  onProgress(`Loading ESPN league ${id}`)
  // Together, so a failure in either is handled (and the first one reported).
  const [found, players] = await Promise.all([findEspnLeague(id, opts.season, await nflSeasons(state)), getPlayers()])
  const { league: raw, season } = found
  if (found.fallback) warnings.push(`ESPN league ${id} has not started its ${state.league_season ?? state.season} season yet; showing ${season}.`)
  if (!raw.teams.length) throw new Error(`ESPN league ${id} has no teams yet.`)

  // The league payload has every week's team scores; lineups and player points come a week at a time,
  // alongside last season's league (team scores only, for the rating model's prior).
  const settings = espnLeagueSettings(raw)
  const currentWeek = currentWeekOf(settings.league, state)
  const lineupWeeks = range(settings.league.settings?.start_week ?? 1, Math.min(currentWeek, MAX_WEEK))
  const prevSeason = Number(raw.season) - 1
  onProgress('Loading ESPN lineups and last season')
  const [weekResults, [prev]] = await Promise.all([
    settled(lineupWeeks.map((w) => getEspnWeek(id, season, w, w < currentWeek))),
    raw.previousSeasons.includes(prevSeason) ? settled([getEspnLeague(id, String(prevSeason))]) : Promise.resolve([null]),
  ])
  const weeks = weekResults.filter((w): w is EspnWeek => !!w)
  if (weeks.length < lineupWeeks.length) warnings.push(`ESPN lineups missing for ${lineupWeeks.length - weeks.length} week(s); those weeks have team scores only.`)
  // Moves and draft picks name players by id alone; a player no lineup carried needs ESPN's name for him.
  const unnamed = espnUnnamedPlayers(raw, weeks)
  const [names] = unnamed.length ? await settled([getEspnPlayerNames(season)]) : [null]
  const ix = buildEspnIndex(players)
  const conv = convertEspnLeague(raw, weeks, ix, names ?? {})
  warnings.push(...conv.warnings)

  const team = raw.teams.find((t) => t.id === opts.teamId) ?? raw.teams[0]
  if (opts.teamId != null && team.id !== opts.teamId) warnings.push(`Team ${opts.teamId} is not in this ESPN league any more; showing ${team.name}.`)
  const me = conv.users.find((u) => u.user_id === espnUserId(team.id))!

  // Last season, for the rating model's prior: team scores only.
  let history: LeagueHistory | null = null
  if (prev) {
    const pc = convertEspnLeague(prev, [], ix)
    const byOwner = new Map(raw.teams.filter((t) => t.ownerId).map((t) => [t.ownerId!, t.id]))
    const now = new Set(raw.teams.map((t) => t.id))
    const rosterMap: Record<number, number> = {}
    for (const t of prev.teams) {
      const to = (t.ownerId ? byOwner.get(t.ownerId) : undefined) ?? (now.has(t.id) ? t.id : undefined)
      if (to != null) rosterMap[t.id] = to
    }
    const prevPlayoff = pc.league.settings?.playoff_week_start ?? 15
    const mbw: Record<number, SleeperMatchup[]> = {}
    for (const w of Object.keys(pc.matchupsByWeek).map(Number)) if (w < prevPlayoff && weekHasScores(pc.matchupsByWeek[w])) mbw[w] = pc.matchupsByWeek[w]
    history = {
      league: pc.league,
      season: pc.league.season,
      matchupsByWeek: mbw,
      weeks: Object.keys(mbw).map(Number).sort((a, b) => a - b),
      transactions: [],
      rosterMap,
    }
  }
  if (currentWeek > (conv.league.settings?.start_week ?? 1) && !conv.transactions.length)
    warnings.push('No ESPN transactions could be read; trade and waiver history starts empty.')

  const extras: EspnExtras = { transactions: conv.transactions, draft: conv.draft, history }
  return { me, league: conv.league, users: conv.users, rosters: conv.rosters, players, matchupsByWeek: conv.matchupsByWeek, currentWeek, extras }
}

export const loadLeagueData = async (
  opts: LoadOptions,
  onProgress: (msg: string) => void = () => {},
): Promise<LeagueData> => {
  const warnings: string[] = []
  let state: SleeperState
  let me: SleeperUser
  let leagues: SleeperLeague[]
  let league: SleeperLeague
  let rosters: SleeperRoster[]
  let users: SleeperUser[]
  let players: PlayerMap
  let matchupsByWeek: Record<number, SleeperMatchup[]> = {}
  let currentWeek: number
  let espn: EspnExtras | null = null

  if (opts.provider === 'espn') {
    // Sleeper's NFL calendar still says what week it is.
    onProgress('Reading the NFL calendar')
    state = await getState()
    const src = await loadEspn(opts, state, warnings, onProgress)
    ;({ me, league, users, rosters, players, matchupsByWeek, currentWeek } = src)
    leagues = [league]
    espn = src.extras
  } else {
    onProgress('Looking up user and NFL state')
    const [st, user] = await Promise.all([getState(), getUser(opts.username.trim())])
    state = st
    if (!user?.user_id) throw new Error(`Sleeper user "${opts.username}" not found`)
    me = user

    const currentSeason = state.league_season ?? state.season
    const season = opts.season ?? currentSeason
    onProgress(`Loading ${season} leagues`)
    leagues = await getUserLeagues(me.user_id, season)
    if ((!leagues || leagues.length === 0) && !opts.season && state.previous_season) {
      leagues = await getUserLeagues(me.user_id, state.previous_season)
      if (leagues?.length) warnings.push(`No ${season} leagues yet; showing ${state.previous_season}.`)
    }
    if (!leagues?.length) throw new Error(`No NFL leagues found for ${me.display_name ?? opts.username} in ${season}`)

    const chosen = leagues.find((l) => l.league_id === opts.leagueId) ?? leagues[0]

    onProgress(`Loading ${chosen.name}`)
    ;[league, rosters, users, players] = await Promise.all([
      getLeague(chosen.league_id),
      getRosters(chosen.league_id),
      getLeagueUsers(chosen.league_id),
      getPlayers(),
    ])
    currentWeek = currentWeekOf(league, state)

    onProgress('Loading matchups')
    const startWk = league.settings?.start_week ?? 1
    const weeks = range(startWk, MAX_WEEK)
    const matchupResults = await settled(weeks.map((w) => getMatchups(league.league_id, w, w < currentWeek)))
    weeks.forEach((w, i) => {
      if (matchupResults[i]) matchupsByWeek[w] = matchupResults[i]!
    })
  }

  const startWeek = league.settings?.start_week ?? 1
  const playoffStart = league.settings?.playoff_week_start ?? 15
  const isCurrentSeason = league.season === state.season
  const weekList = range(startWeek, MAX_WEEK)

  const playedWeeks = weekList.filter((w) => w < currentWeek && weekHasScores(matchupsByWeek[w]))
  const regularWeeks = playedWeeks.filter((w) => w < playoffStart)
  const futureWeeks = weekList.filter((w) => w >= currentWeek && w < playoffStart)

  // ---- Player points for the value model ----
  let weekPoints: WeekPoints = {}
  let valueWeeks: number[] = []
  let valueSeason = league.season
  let pointsSource: PointsSource = 'none'

  const currentStats: { week: number; stats: WeekStats }[] = []
  if (playedWeeks.length) {
    onProgress('Loading player stats')
    const statResults = await settled(
      playedWeeks.map((w) => getWeekStats(league.season, w, w < currentWeek)),
    )
    playedWeeks.forEach((w, i) => {
      if (statResults[i]) currentStats.push({ week: w, stats: statResults[i]! })
    })
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
  // remaining week, then adjusted for what the projection leaves out.
  let projections: Record<string, number> | null = null
  let projectionWeek: number | null = null
  let rawHorizon: Horizon = []
  let horizon: Horizon = []
  let horizonSource: HorizonSource = 'none'
  let trending: TrendingEntry[] = []
  let context: Record<string, PlayerContext> = {}
  let availability: Record<string, Availability> = {}
  let usage: Record<string, Usage> = {}
  let schedule: Schedule | null = null
  let market: MarketWeek | null = null

  const mode: HorizonMode = opts.horizon ?? DEFAULT_HORIZON_MODE
  const playoffWeight = Math.max(0, opts.playoffWeight ?? DEFAULT_PLAYOFF_WEIGHT)
  const playoffWeeks = fantasyPlayoffWeeks(league)
  const lastWeek = mode === 'playoffs' ? Math.max(playoffStart - 1, ...playoffWeeks) : playoffStart - 1
  const upcoming = state.season_type === 'pre' ? startWeek : Math.max(state.week, currentWeek)
  let horizonWeeks =
    isCurrentSeason && (state.season_type === 'regular' || state.season_type === 'pre')
      ? weekList.filter((w) => w >= upcoming && w <= lastWeek)
      : []
  if (mode === 'next6') horizonWeeks = horizonWeeks.filter((w) => w < playoffStart).slice(0, 6)

  if (horizonWeeks.length) {
    onProgress(`Projecting weeks ${horizonWeeks[0]}–${horizonWeeks[horizonWeeks.length - 1]}`)
    const projResults = await settled(
      horizonWeeks.map((w) =>
        getScoredProjections(league.league_id, league.season, w, league.scoring_settings, w - upcoming <= 1),
      ),
    )
    horizonWeeks.forEach((w, i) => {
      const raw = projResults[i]
      if (!raw || !Object.keys(raw).length) return
      const pts: Record<string, number> = {}
      for (const id of Object.keys(raw)) if (players[id]) pts[id] = raw[id]
      if (Object.keys(pts).length) rawHorizon.push({ week: w, pts, weight: playoffWeeks.includes(w) ? playoffWeight : 1 })
    })
    if (rawHorizon.length) {
      horizonSource = 'projections'
      projectionWeek = rawHorizon[0].week
      projections = rawHorizon[0].pts
      if (rawHorizon.length < horizonWeeks.length) {
        warnings.push(`Projections missing for ${horizonWeeks.length - rawHorizon.length} of ${horizonWeeks.length} weeks ahead.`)
      }
    }
  }

  if (rawHorizon.length) {
    // What the projections leave out: injury risk, designations they disagree
    // with, and where an absent player's work goes. None of it is essential,
    // so a failed request costs the adjustment, not the page.
    onProgress('Reading injury history and depth charts')
    const season = Number(league.season)
    const [sched, gpPrev, gpPrev2, lineRows] = await settled<unknown>([
      getSchedule(league.season),
      getSeasonGamesPlayed(String(season - 1)),
      getSeasonGamesPlayed(String(season - 2)),
      getLines(reduceLines),
    ])
    schedule = Array.isArray(sched) && sched.length ? buildSchedule(sched as ScheduleGame[]) : null

    // Betting-market props for the coming week. They come as medians and
    // prices; marketWeek turns them into expected stats scored with this
    // league's settings, and the week's projection becomes an even blend of
    // that and Sleeper's. Optional like everything else here.
    const gameWeek: Record<string, number> = {}
    if (Array.isArray(sched)) for (const g of sched as (ScheduleGame & { game_id?: string })[]) if (g.game_id) gameWeek[String(g.game_id)] = g.week
    const lineWeek = rawHorizon[0].week
    const rows = Array.isArray(lineRows) ? (lineRows as LineRow[]) : []
    // Only lines whose game the schedule places in the coming week; without a schedule there is no way to tell, so none.
    if (rows.some((r) => gameWeek[r.game] === lineWeek)) {
      const [statLines] = await settled([getWeekStatLines(league.season, lineWeek)])
      if (statLines) {
        market = marketWeek({ rows, gameWeek, week: lineWeek, projections: statLines, scoring: league.scoring_settings, players })
        if (market.players) saveSnapshot(league.season, market)
        else market = null
      }
    }
    const seasons: SeasonGames[] = []
    if (gpPrev && typeof gpPrev === 'object') seasons.push({ season: season - 1, gp: gpPrev as Record<string, number>, teamGames: TEAM_GAMES })
    if (gpPrev2 && typeof gpPrev2 === 'object') seasons.push({ season: season - 2, gp: gpPrev2 as Record<string, number>, teamGames: TEAM_GAMES })
    const current = currentSeasonGames(currentStats, schedule)
    availability = availabilityRates(players, seasons, season, current ?? undefined)
    usage = usageFromStats(currentStats, players)
    // From here on the base projection is the blended one, so every later
    // comparison (injury drag, raw vs adjusted) isolates the injury and role
    // adjustments rather than picking up the lines.
    if (market) rawHorizon = rawHorizon.map((h) => (h.week === market!.week ? { ...h, pts: blendWeek(h.pts, market!) } : h))
    const priced = rawHorizon
    const adjustedResult = adjustHorizon({
      horizon: priced,
      players,
      availability,
      schedule,
      usage,
      playoffStart: playoffWeeks.length ? playoffWeeks[0] : undefined,
    })
    horizon = adjustedResult.horizon
    context = adjustedResult.context
    if (!seasons.length) warnings.push('Injury history unavailable; every player is given the league-average chance of playing.')
    if (!schedule) warnings.push('NFL schedule unavailable; byes and opponents are not shown.')
  }

  if (!horizon.length && valueWeeks.length) {
    // No projections to be had — a finished season, or the feed is down. Price
    // trades off what already happened and say so, because it is a weaker basis.
    horizon = valueWeeks.map((w) => ({ week: w, pts: weekPoints[w] ?? {} }))
    rawHorizon = horizon
    horizonSource = 'results'
    warnings.push(`Projections unavailable; trade values use ${valueSeason} results instead of the weeks ahead.`)
  }

  if (isCurrentSeason && (state.season_type === 'regular' || state.season_type === 'pre')) {
    const [trend] = await settled([getTrendingAdds(24, 50)])
    if (Array.isArray(trend)) trending = trend
  }

  // ---- League history and outside opinion ----
  // All optional: each one sharpens a model, none of them is needed to draw the page.
  onProgress('Reading league history')
  const txWeeks = weekList.filter((w) => w <= Math.min(currentWeek, MAX_WEEK))
  const [txResults, projResults, consensusRows, draftResult] = await Promise.all([
    // An ESPN league's moves and draft came with its weekly payloads.
    espn ? Promise.resolve([espn.transactions]) : settled(txWeeks.map((w) => getTransactions(league.league_id, w, w < currentWeek))),
    settled(regularWeeks.map((w) => getScoredProjections(league.league_id, league.season, w, league.scoring_settings, false))),
    isCurrentSeason ? settled([getConsensusCsv(reduceConsensusCsv)]).then((r) => r[0]) : Promise.resolve(null),
    // Dynasty leagues' latest draft is a rookie draft: its order says nothing about the rest of the pool.
    league.settings?.type === 2 ? Promise.resolve(null) : espn ? Promise.resolve(espn.draft) : settled([getDraftBoard(league.league_id)]).then((r) => r[0]),
  ])
  const transactions = txResults.flatMap((r) => r ?? [])
  const pastProjections: Record<number, Record<string, number>> = {}
  regularWeeks.forEach((w, i) => {
    if (projResults[i] && Object.keys(projResults[i]!).length) pastProjections[w] = projResults[i]!
  })
  let consensus: Consensus | null = null
  if (consensusRows?.length) consensus = matchConsensus(consensusRows, players)
  else if (isCurrentSeason) warnings.push('FantasyPros consensus unavailable right now; consensus columns are hidden.')

  let history: LeagueHistory | null = espn?.history ?? null
  if (!espn && league.previous_league_id && league.previous_league_id !== '0') {
    const prevId = league.previous_league_id
    const [prevLeague, prevRosters] = await settled<unknown>([getLeague(prevId), getRosters(prevId)])
    if (prevLeague && Array.isArray(prevRosters)) {
      const pl = prevLeague as SleeperLeague
      const prevStart = pl.settings?.start_week ?? 1
      const prevPlayoff = pl.settings?.playoff_week_start ?? 15
      const prevWeeks = Array.from({ length: prevPlayoff - prevStart }, (_, i) => prevStart + i)
      const [prevMatchups, prevTx] = await Promise.all([
        settled(prevWeeks.map((w) => getMatchups(prevId, w, true))),
        settled(Array.from({ length: MAX_WEEK }, (_, i) => getTransactions(prevId, i + 1, true))),
      ])
      const byOwner = new Map(rosters.filter((r) => r.owner_id).map((r) => [r.owner_id!, r.roster_id]))
      const rosterMap: Record<number, number> = {}
      for (const r of prevRosters as SleeperRoster[]) {
        const now = r.owner_id ? byOwner.get(r.owner_id) : undefined
        if (now != null) rosterMap[r.roster_id] = now
      }
      const mbw: Record<number, SleeperMatchup[]> = {}
      prevWeeks.forEach((w, i) => {
        if (weekHasScores(prevMatchups[i])) mbw[w] = prevMatchups[i]!
      })
      history = {
        league: pl,
        season: pl.season,
        matchupsByWeek: mbw,
        weeks: Object.keys(mbw).map(Number).sort((a, b) => a - b),
        transactions: prevTx.flatMap((r) => r ?? []),
        rosterMap,
      }
    }
  }

  return {
    provider: espn ? 'espn' : 'sleeper',
    tradeFaab: !espn,
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
    rawHorizon,
    context,
    availability,
    usage,
    schedule,
    horizonMode: mode,
    playoffWeight,
    playoffWeeks,
    trending,
    transactions,
    history,
    pastProjections,
    consensus,
    // A draft that covered only a few rounds is a supplemental one, not a read on the whole pool.
    draft: draftResult && draftResult.picks >= league.total_rosters * 6 ? draftResult : null,
    market,
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
  const lastUser = useRef<string | null>(null)

  useEffect(() => {
    if (!opts) return
    const id = ++active.current
    // A different user's (or ESPN league's) data must never stay on screen under the new name, even if their load fails.
    const who = opts.provider === 'espn' ? `espn:${opts.leagueId.trim()}` : opts.username.trim().toLowerCase()
    if (lastUser.current !== null && lastUser.current !== who) setData(null)
    lastUser.current = who
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
        // ESPN's errors already say what to do; a bare network failure here is Sleeper's.
        setError(e instanceof EspnError || !/Failed to fetch|NetworkError/i.test(msg) ? msg : `Could not reach the Sleeper API (${msg}).`)
      })
      .finally(() => {
        if (active.current === id) setLoading(false)
      })
  }, [opts?.provider, opts && 'username' in opts ? opts.username : null, opts?.leagueId, opts?.provider === 'espn' ? opts.teamId : null, opts?.season, opts?.horizon, opts?.playoffWeight, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, progress, reload }
}
