// Everything built on top of the core analysis: ratings and simulation, the
// calibration backtest, league behaviour, and consensus-perceived value. Kept
// apart from `analyze` so the expensive simulation does not rerun when only a
// display preference changes.

import type { Analysis } from './analysis'
import { leagueBehavior, type LeagueBehavior } from './behavior'
import { perceivedValues } from './consensus'
import { backtest, buildForecast, gamesFrom, pastByWeek, preseasonElo, runElo, SIM, teamRatings, type EloRun, type Forecast, type ForecastInput } from './forecast'
import { faabState, type Faab } from './faab'
import { buildTeamSeasons, buildTeamWeeks, computePower, DEFAULT_POWER_WEIGHTS, type TeamWeek } from './power'
import type { LeagueData } from './useLeagueData'

export type Models = {
  forecast: Forecast | null
  forecastInput: ForecastInput
  elo: EloRun
  /** Elo going into this season: last season's close, regressed, or flat. */
  eloPrior: Record<number, number>
  /** Last season's games, for showing where the prior came from. */
  lastSeasonGames: number
  backtest: ReturnType<typeof backtest>
  behavior: LeagueBehavior
  /** Consensus rank priced on the model's value curve, pts/wk. */
  perceived: Record<string, number> | null
  /**
   * What each team was expected to score in each completed week, before it
   * kicked off: its best projected lineup from the roster it had then, times
   * the manager's efficiency. Keyed rosterId → week.
   */
  expectedPast: Record<number, Record<number, number>>
  /** The league's FAAB picture, when it bids for waivers. */
  faab: Faab | null
}

/** Remaining regular-season pairings, one row per game. */
export const remainingSchedule = (data: LeagueData) =>
  data.futureWeeks.flatMap((week) => {
    const ms = data.matchupsByWeek[week] ?? []
    const out: { week: number; a: number; b: number }[] = []
    for (const m of ms) {
      if (m.matchup_id == null) continue
      const o = ms.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id)
      if (o && m.roster_id < o.roster_id) out.push({ week, a: m.roster_id, b: o.roster_id })
    }
    return out
  })

const powerMargin = (sigma: number) => (teamWeeks: Record<number, TeamWeek[]>, weeks: number[]) => {
  if (!weeks.length) return {}
  const ids = [...new Set(weeks.flatMap((w) => (teamWeeks[w] ?? []).map((t) => t.rosterId)))]
  // Results-only composite: roster strength needs the value model at that date, so it sits out.
  const seasons = buildTeamSeasons(ids, teamWeeks, weeks, {})
  const out: Record<number, number> = {}
  for (const p of computePower(seasons, {}, DEFAULT_POWER_WEIGHTS, sigma)) out[p.rosterId] = p.margin
  return out
}

/** The parts built on results and history alone: they do not move when a projection does. */
export type HistoryModels = Pick<Models, 'elo' | 'eloPrior' | 'lastSeasonGames' | 'backtest' | 'behavior'> & {
  /** Each team's projected optimal lineup in each completed week (see pastByWeek). */
  past: Record<number, Record<number, number>>
}

/** Everything the rating model reads, for a given horizon. */
const forecastInputFor = (data: LeagueData, analysis: Analysis, elo: Record<number, number>): ForecastInput => {
  const record: ForecastInput['record'] = {}
  for (const s of analysis.seasons) record[s.rosterId] = { wins: s.wins, losses: s.losses, ties: s.ties, pf: s.pf }
  return {
    slots: analysis.slots,
    players: data.players,
    horizon: data.horizon,
    floor: analysis.horizonReplacement,
    teams: analysis.teams.map((t) => ({ rosterId: t.rosterId, players: t.players })),
    teamWeeks: analysis.teamWeeks,
    playedWeeks: data.regularWeeks,
    pastProjections: data.pastProjections,
    schedule: remainingSchedule(data),
    record,
    playoffWeeks: data.playoffWeeks,
    playoffTeams: Number(data.league.settings?.playoff_teams ?? 6),
    elo,
    sigmaFallback: analysis.sigma * 0.9,
    weeksLeft: data.futureWeeks.length,
  }
}

/**
 * Elo, the calibration backtest and league behaviour. None of them reads the
 * weeks ahead, so the page builds them from the league as loaded and keeps
 * them when you nudge a player's projection.
 */
export const buildHistory = (data: LeagueData, analysis: Analysis): HistoryModels => {
  const ids = analysis.teams.map((t) => t.rosterId)
  const marginSd = analysis.sigma * Math.SQRT2

  // Elo: last season's close, regressed, as the prior.
  let eloPrior: Record<number, number> = {}
  let prevTeamWeeks: Record<number, TeamWeek[]> | null = null
  let lastSeasonGames = 0
  if (data.history?.weeks.length) {
    prevTeamWeeks = buildTeamWeeks(data.history.matchupsByWeek, data.history.weeks, analysis.slots, data.players)
    const prevGames = gamesFrom(prevTeamWeeks, data.history.weeks, data.history.rosterMap)
    lastSeasonGames = prevGames.length
    eloPrior = preseasonElo(runElo(prevGames, ids, {}, marginSd).final)
  }
  const elo = runElo(gamesFrom(analysis.teamWeeks, data.regularWeeks), ids, eloPrior, marginSd)

  // Weekly noise around expectations, measured on completed weeks only; the backtest grades on it.
  const pastInput = { ...forecastInputFor(data, analysis, elo.final), horizon: [] }
  const past = pastByWeek(pastInput)
  const sigma = teamRatings(pastInput, past).noise.sigma

  const bt = backtest(
    [
      { season: data.league.season, teamWeeks: analysis.teamWeeks, weeks: data.regularWeeks, pastProjections: data.pastProjections, eloStart: eloPrior },
      ...(prevTeamWeeks && data.history ? [{ season: data.history.season, teamWeeks: prevTeamWeeks, weeks: data.history.weeks }] : []),
    ],
    { slots: analysis.slots, players: data.players, floor: analysis.horizonReplacement, sigma, powerMargin: powerMargin(analysis.sigma) },
  )

  const behavior = leagueBehavior({
    rosterIds: ids,
    season: data.league.season,
    transactions: data.transactions,
    history: data.history,
    players: data.players,
    market: analysis.market,
  })
  return { elo, eloPrior, lastSeasonGames, backtest: bt, behavior, past }
}

/** The forward-looking parts: ratings, the season simulation, past expectations and consensus prices. */
export const buildModels = (data: LeagueData, analysis: Analysis, history: HistoryModels = buildHistory(data, analysis)): Models => {
  const { past } = history
  const forecastInput = forecastInputFor(data, analysis, history.elo.final)
  const forecast = data.horizon.length && data.horizonSource === 'projections' ? buildForecast(forecastInput, SIM.sims, past) : null
  const ratings = forecast?.ratings ?? teamRatings({ ...forecastInput, horizon: [] }, past).ratings
  const expectedPast: Models['expectedPast'] = {}
  for (const r of ratings) {
    const byWeek: Record<number, number> = {}
    for (const w of Object.keys(past).map(Number)) if (past[w][r.rosterId] > 0) byWeek[w] = past[w][r.rosterId] * r.efficiency
    expectedPast[r.rosterId] = byWeek
  }

  // A player the consensus does not rank (or the matcher missed) is read at the
  // model's own value rather than zero, so a miss never looks like a free player.
  const perceived = data.consensus ? { ...Object.fromEntries(Object.entries(analysis.market).map(([id, v]) => [id, Math.max(0, v)])), ...perceivedValues(data.consensus, analysis.market) } : null

  return { ...history, forecast, forecastInput, perceived, expectedPast, faab: faabState(data, analysis) }
}
