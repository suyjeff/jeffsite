import { startingSlots, type Slot } from './lineup'
import {
  buildTeamSeasons,
  buildTeamWeeks,
  computePower,
  futureOpponents,
  type PowerRow,
  type PowerWeights,
  type TeamSeason,
  type TeamWeek,
} from './power'
import {
  averageStarter,
  horizonValues,
  marketValues,
  projectedReplacement,
  rosterCapacity,
  teamNeeds,
  type HorizonValues,
  type TeamNeeds,
} from './trades'
import type { SleeperRoster, SleeperUser } from './types'
import type { LeagueData } from './useLeagueData'
import {
  playerValues,
  positionRanks,
  replacementLevels,
  rosterStrength,
  teamScoreSigma,
  type ModelConfig,
  type PlayerValue,
  type ReplacementLevels,
} from './war'

export type TeamInfo = {
  rosterId: number
  name: string
  owner: string
  avatar: string | null
  userId: string | null
  roster: SleeperRoster
  players: string[]
}

export type Analysis = {
  slots: Slot[]
  teams: TeamInfo[]
  teamById: Record<number, TeamInfo>
  myRosterId: number | null
  rosteredBy: Record<string, number>
  levels: ReplacementLevels
  sigma: number
  values: Record<string, PlayerValue>
  posRanks: Record<string, number>
  teamWeeks: Record<number, TeamWeek[]>
  seasons: TeamSeason[]
  seasonById: Record<number, TeamSeason>
  strength: Record<number, number>
  power: PowerRow[]
  powerById: Record<number, PowerRow>
  // ---- Forward-looking layer, used by the trade finder ----
  /** Projected points over the horizon, read both per week and per active week. */
  horizon: HorizonValues
  /** Replacement level per position, per active week, over the horizon. */
  horizonReplacement: Record<string, number>
  /** What a league-average starter at each position produces per week. */
  horizonStarter: Record<string, number>
  /** Points per week above replacement: what a player is worth to the league at large. */
  market: Record<string, number>
  /** Per-team lineup production, slot by slot, and the size of each hole. */
  needs: Record<number, TeamNeeds>
  /** Players a roster may hold, so uneven packages are costed honestly. */
  capacity: number
}

export const teamDisplayName = (user: SleeperUser | undefined, rosterId: number) =>
  user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`

export const analyze = (data: LeagueData, model: ModelConfig, weights: PowerWeights): Analysis => {
  const { league, rosters, users, players, weekPoints, valueWeeks, regularWeeks, futureWeeks, matchupsByWeek } = data
  const slots = startingSlots(league.roster_positions ?? [])
  const numTeams = league.total_rosters || rosters.length
  const userById: Record<string, SleeperUser> = {}
  users.forEach((u) => (userById[u.user_id] = u))

  const teams: TeamInfo[] = rosters
    .map((r) => {
      const user = r.owner_id ? userById[r.owner_id] : undefined
      return {
        rosterId: r.roster_id,
        name: teamDisplayName(user, r.roster_id),
        owner: user?.display_name ?? 'Unowned',
        avatar: user?.metadata?.avatar
          ? user.metadata.avatar
          : user?.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}`
            : null,
        userId: r.owner_id,
        roster: r,
        players: r.players ?? [],
      }
    })
    .sort((a, b) => a.rosterId - b.rosterId)
  const teamById: Record<number, TeamInfo> = {}
  teams.forEach((t) => (teamById[t.rosterId] = t))
  const mine = teams.find(
    (t) => t.userId === data.me.user_id || (t.roster.co_owners ?? []).includes(data.me.user_id),
  )
  const rosteredBy: Record<string, number> = {}
  teams.forEach((t) => t.players.forEach((id) => (rosteredBy[id] = t.rosterId)))

  const teamWeeks = buildTeamWeeks(matchupsByWeek, regularWeeks, slots, players)
  const teamScores = regularWeeks.flatMap((w) => (teamWeeks[w] ?? []).map((t) => t.points))
  const levels = replacementLevels(weekPoints, valueWeeks, players, league.roster_positions ?? [], numTeams, model.benchFactor)
  const sigma = teamScoreSigma(teamScores, weekPoints, valueWeeks, players, league.roster_positions ?? [], numTeams)
  const values = playerValues(weekPoints, valueWeeks, players, levels, sigma, model)
  const posRanks = positionRanks(values, players, (v) => v.war)

  const remaining = futureOpponents(matchupsByWeek, futureWeeks)
  const seasons = buildTeamSeasons(teams.map((t) => t.rosterId), teamWeeks, regularWeeks, remaining)
  const seasonById: Record<number, TeamSeason> = {}
  seasons.forEach((s) => (seasonById[s.rosterId] = s))
  const strength: Record<number, number> = {}
  teams.forEach((t) => (strength[t.rosterId] = rosterStrength(slots, t.players, players, values)))
  const power = computePower(seasons, strength, weights, sigma)
  const powerById: Record<number, PowerRow> = {}
  power.forEach((p) => (powerById[p.rosterId] = p))

  const rosterPositions = league.roster_positions ?? []
  const horizon = horizonValues(data.horizon)
  // Replacement level and market price read per active week: a bye inside an
  // arbitrary six-week window is not a reason to mark a player down.
  const horizonReplacement = projectedReplacement(horizon.perActive, players, rosterPositions, numTeams, model.benchFactor)
  const horizonStarter = averageStarter(horizon.perActive, players, rosterPositions, numTeams)
  const market = marketValues(horizon.perActive, players, horizonReplacement)
  const capacity = Math.max(rosterCapacity(rosterPositions), ...teams.map((t) => t.players.length))
  const needs = teamNeeds(teams, slots, players, data.horizon, horizonStarter, rosterPositions, numTeams, horizonReplacement)

  return {
    slots,
    teams,
    teamById,
    myRosterId: mine?.rosterId ?? null,
    rosteredBy,
    levels,
    sigma,
    values,
    posRanks,
    teamWeeks,
    seasons,
    seasonById,
    strength,
    power,
    powerById,
    horizon,
    horizonReplacement,
    horizonStarter,
    market,
    needs,
    capacity,
  }
}

/**
 * The same analysis under different composite weights. Only the power ranking
 * moves, so this skips everything else — and, because every other field keeps
 * its identity, nothing keyed on them (the models, the trade-search cache) is
 * rebuilt when a weight slider moves.
 */
export const withWeights = (analysis: Analysis, weights: PowerWeights): Analysis => {
  const power = computePower(analysis.seasons, analysis.strength, weights, analysis.sigma)
  const powerById: Record<number, PowerRow> = {}
  power.forEach((p) => (powerById[p.rosterId] = p))
  return { ...analysis, power, powerById }
}

/**
 * Sleeper's pre-game projection for one player in each of the given weeks, in
 * league scoring, or null where there was none. Never read against a proxy
 * season's weeks, whose numbers would line up with the wrong games.
 */
export const pastProjection = (data: LeagueData, id: string, weeks: number[]): (number | null)[] =>
  data.pointsSource.startsWith('proxy') ? weeks.map(() => null) : weeks.map((w) => data.pastProjections[w]?.[id] ?? null)
