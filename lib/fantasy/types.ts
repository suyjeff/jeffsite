// Sleeper API shapes (read-only public API, https://docs.sleeper.com).
// Fields are typed loosely on purpose: Sleeper omits or nulls many of them.

export type SleeperUser = {
  user_id: string
  username?: string
  display_name?: string
  avatar?: string | null
  metadata?: { team_name?: string; avatar?: string } | null
  is_owner?: boolean
}

export type SleeperState = {
  week: number
  display_week?: number
  season: string
  season_type: 'pre' | 'regular' | 'post' | 'off' | string
  league_season?: string
  previous_season?: string
  leg?: number
}

export type SleeperLeague = {
  league_id: string
  name: string
  season: string
  status?: 'pre_draft' | 'drafting' | 'in_season' | 'complete' | string
  sport?: string
  total_rosters: number
  roster_positions: string[]
  scoring_settings: Record<string, number>
  settings?: {
    playoff_week_start?: number
    playoff_teams?: number
    num_teams?: number
    leg?: number
    last_scored_leg?: number
    start_week?: number
    type?: number // 0 redraft, 1 keeper, 2 dynasty
    [k: string]: unknown
  }
  previous_league_id?: string | null
  avatar?: string | null
}

export type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  players: string[] | null
  starters: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
  co_owners?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    fpts_against?: number
    fpts_against_decimal?: number
    ppts?: number
    ppts_decimal?: number
    waiver_budget_used?: number
    total_moves?: number
    division?: number
  }
  metadata?: Record<string, string> | null
}

export type SleeperMatchup = {
  roster_id: number
  matchup_id: number | null
  points: number
  players: string[] | null
  starters: string[] | null
  starters_points?: number[] | null
  players_points?: Record<string, number> | null
  custom_points?: number | null
}

export type SleeperPlayer = {
  player_id: string
  first_name?: string
  last_name?: string
  full_name?: string
  position?: string | null
  fantasy_positions?: string[] | null
  team?: string | null
  status?: string | null
  injury_status?: string | null
  age?: number | null
  years_exp?: number | null
  number?: number | null
  depth_chart_order?: number | null
  active?: boolean
}

export type TrimmedPlayer = {
  id: string
  name: string
  pos: string
  fpos: string[]
  team: string | null
  status: string | null
  injury: string | null
  age: number | null
  exp: number | null
}

export type PlayerMap = Record<string, TrimmedPlayer>

/** Raw weekly stat line keyed by Sleeper stat name (pass_yd, rec, pts_ppr, gp, ...). */
export type StatLine = Record<string, number>
export type WeekStats = Record<string, StatLine>

export type TrendingEntry = { player_id: string; count: number }
