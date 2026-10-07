// Everything built on top of the core analysis: ratings and simulation, the
// calibration backtest, league behaviour, and consensus-perceived value. Kept
// apart from `analyze` so the expensive simulation does not rerun when only a
// display preference changes.

import type { Analysis } from './analysis'
import { leagueBehavior, type LeagueBehavior } from './behavior'
import { perceivedValues } from './consensus'
import { backtest, buildForecast, gamesFrom, preseasonElo, runElo, type EloRun, type Forecast, type ForecastInput } from './forecast'
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

const powerScore = (teamWeeks: Record<number, TeamWeek[]>, weeks: number[]) => {
  if (!weeks.length) return {}
  const ids = [...new Set(weeks.flatMap((w) => (teamWeeks[w] ?? []).map((t) => t.rosterId)))]
  // Results-only composite: roster strength needs the value model at that date, so it sits out.
  const seasons = buildTeamSeasons(ids, teamWeeks, weeks, {})
  const out: Record<number, number> = {}
  for (const p of computePower(seasons, {}, DEFAULT_POWER_WEIGHTS)) out[p.rosterId] = p.score
  return out
}

export const buildModels = (data: LeagueData, analysis: Analysis): Models => {
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

  const record: ForecastInput['record'] = {}
  for (const s of analysis.seasons) record[s.rosterId] = { wins: s.wins, losses: s.losses, ties: s.ties, pf: s.pf }
  const forecastInput: ForecastInput = {
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
    elo: elo.final,
    sigmaFallback: analysis.sigma * 0.9,
  }
  const forecast = data.horizon.length && data.horizonSource === 'projections' ? buildForecast(forecastInput) : null

  const bt = backtest(
    [
      { season: data.league.season, teamWeeks: analysis.teamWeeks, weeks: data.regularWeeks, pastProjections: data.pastProjections, eloStart: eloPrior },
      ...(prevTeamWeeks && data.history ? [{ season: data.history.season, teamWeeks: prevTeamWeeks, weeks: data.history.weeks }] : []),
    ],
    { slots: analysis.slots, players: data.players, floor: analysis.horizonReplacement, sigma: forecast?.sigma ?? analysis.sigma, powerScore },
  )

  const behavior = leagueBehavior({
    rosterIds: ids,
    season: data.league.season,
    transactions: data.transactions,
    history: data.history,
    players: data.players,
    market: analysis.market,
  })
  const perceived = data.consensus ? perceivedValues(data.consensus, analysis.market) : null

  return { forecast, forecastInput, elo, eloPrior, lastSeasonGames, backtest: bt, behavior, perceived }
}
