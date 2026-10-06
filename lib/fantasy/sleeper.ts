import type { ScheduleGame } from './context'
import { scoreStatLine } from './scoring'
import type {
  PlayerMap,
  SleeperLeague,
  SleeperMatchup,
  SleeperPlayer,
  SleeperRoster,
  SleeperState,
  SleeperUser,
  TrendingEntry,
  TrimmedPlayer,
  WeekStats,
} from './types'

const BASE = 'https://api.sleeper.app/v1'
// v2: trimmed players gained depth-chart and injury fields; older cached copies lack them.
const CACHE_PREFIX = 'ff:v2:'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

type CacheEntry<T> = { t: number; data: T }

const memory = new Map<string, CacheEntry<unknown>>()

const hasStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    return false
  }
}

const readCache = <T>(key: string, ttl: number): T | null => {
  const now = Date.now()
  const mem = memory.get(key) as CacheEntry<T> | undefined
  if (mem && now - mem.t < ttl) return mem.data
  if (!hasStorage()) return null
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (now - entry.t >= ttl) return null
    memory.set(key, entry)
    return entry.data
  } catch {
    return null
  }
}

const writeCache = <T>(key: string, data: T, persist = true) => {
  const entry: CacheEntry<T> = { t: Date.now(), data }
  memory.set(key, entry)
  if (!persist || !hasStorage()) return
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Quota exceeded or private mode: memory cache still works for this session.
  }
}

const removeKeys = (match: (key: string) => boolean) => {
  if (!hasStorage()) return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && match(k)) keys.push(k)
    }
    keys.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    // ignore
  }
}

export const clearFantasyCache = () => {
  memory.clear()
  removeKeys((k) => k.startsWith(CACHE_PREFIX))
}

/** Free the quota held by caches from older versions of this page. */
let purged = false
export const purgeStaleCache = () => {
  if (purged) return
  purged = true
  removeKeys((k) => /^ff:v\d+:/.test(k) && !k.startsWith(CACHE_PREFIX))
}

export class SleeperError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new SleeperError(`${res.status} ${res.statusText} for ${url}`, res.status)
  return (await res.json()) as T
}

/**
 * Cached GET. `ttl` in ms. Set persist=false for payloads too big for localStorage.
 * `transform` runs before caching so the stored payload is already trimmed.
 */
const cachedGet = async <T, R = T>(
  path: string,
  ttl: number,
  opts: { persist?: boolean; transform?: (raw: T) => R; base?: string; key?: string } = {},
): Promise<R> => {
  const url = (opts.base ?? BASE) + path
  // A transform that depends on league settings needs its own key so two
  // leagues with different scoring do not read each other's cached result.
  const cacheKey = opts.key ?? url
  const cached = readCache<R>(cacheKey, ttl)
  if (cached !== null) return cached
  const raw = await fetchJson<T>(url)
  const data = (opts.transform ? opts.transform(raw) : (raw as unknown)) as R
  writeCache(cacheKey, data, opts.persist ?? true)
  return data
}

// ---------- Documented endpoints ----------

export const getUser = (usernameOrId: string) =>
  cachedGet<SleeperUser>(`/user/${encodeURIComponent(usernameOrId)}`, 6 * HOUR)

export const getState = () => cachedGet<SleeperState>('/state/nfl', 30 * MINUTE)

export const getUserLeagues = (userId: string, season: string) =>
  cachedGet<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`, 30 * MINUTE)

export const getLeague = (leagueId: string) =>
  cachedGet<SleeperLeague>(`/league/${leagueId}`, 30 * MINUTE)

export const getRosters = (leagueId: string) =>
  cachedGet<SleeperRoster[]>(`/league/${leagueId}/rosters`, 10 * MINUTE)

export const getLeagueUsers = (leagueId: string) =>
  cachedGet<SleeperUser[]>(`/league/${leagueId}/users`, 30 * MINUTE)

/** Past weeks are immutable so they cache for a day; the live week refreshes often. */
export const getMatchups = (leagueId: string, week: number, isPast: boolean) =>
  cachedGet<SleeperMatchup[]>(
    `/league/${leagueId}/matchups/${week}`,
    isPast ? 24 * HOUR : 5 * MINUTE,
  )

export const getTrendingAdds = (lookbackHours = 24, limit = 50) =>
  cachedGet<TrendingEntry[]>(
    `/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=${limit}`,
    HOUR,
  )

const KEEP_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'])

export const trimPlayer = (p: SleeperPlayer): TrimmedPlayer | null => {
  const fpos = (p.fantasy_positions ?? (p.position ? [p.position] : [])).filter((x) =>
    KEEP_POSITIONS.has(x),
  )
  if (fpos.length === 0) return null
  const pos = p.position && KEEP_POSITIONS.has(p.position) ? p.position : fpos[0]
  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.player_id
  return {
    id: p.player_id,
    name,
    pos,
    fpos,
    team: p.team ?? null,
    status: p.status ?? null,
    injury: p.injury_status ?? null,
    age: p.age ?? null,
    exp: p.years_exp ?? null,
    depth: p.depth_chart_order ?? null,
    injuryBody: p.injury_body_part ?? null,
  }
}

/**
 * The full player dump is ~5MB and Sleeper asks that it be pulled at most daily.
 * We trim it to fantasy-relevant fields before caching so it fits in localStorage.
 */
export const getPlayers = () =>
  cachedGet<Record<string, SleeperPlayer>, PlayerMap>('/players/nfl', 24 * HOUR, {
    transform: (raw) => {
      const out: PlayerMap = {}
      for (const id of Object.keys(raw)) {
        const p = raw[id]
        if (!p) continue
        // Keep active players plus anyone Sleeper still lists on a team.
        if (p.active === false && !p.team) continue
        const t = trimPlayer({ ...p, player_id: p.player_id ?? id })
        if (t) out[t.id] = t
      }
      return out
    },
  })

// ---------- Stats & projections ----------
// These are the endpoints the Sleeper app itself uses. They are not in the public
// docs, so every caller treats them as optional and degrades to matchup data.

export const getWeekStats = (season: string, week: number, isPast: boolean) =>
  cachedGet<WeekStats>(`/stats/nfl/regular/${season}/${week}`, isPast ? 24 * HOUR : 10 * MINUTE)

export const getWeekProjections = (season: string, week: number) =>
  cachedGet<WeekStats>(`/projections/nfl/regular/${season}/${week}`, 3 * HOUR, { persist: false })

/**
 * A week of projections reduced to one league-scored number per player.
 *
 * The raw payload is ~650KB of mostly-empty rows; scored and filtered it is
 * ~20KB, which is what makes a multi-week horizon cacheable. Sleeper keeps
 * these current: a player ruled out projects 0 for that week, and a bye week
 * projects 0, so a horizon built from them prices availability automatically.
 *
 * Do not substitute `/projections/nfl/regular/{season}` (no week). That
 * endpoint is a frozen preseason full-season projection: as of week 2 of 2026
 * it still had Sam Darnold at 250 points while he was ruled out.
 */
export const getScoredProjections = (
  leagueId: string,
  season: string,
  week: number,
  scoring: Record<string, number>,
  /** The next week or two move with every injury report; later ones barely move. */
  near = true,
) =>
  cachedGet<WeekStats, Record<string, number>>(
    `/projections/nfl/regular/${season}/${week}`,
    near ? 3 * HOUR : 12 * HOUR,
    {
      key: `scored-proj:${leagueId}:${season}:${week}`,
      transform: (raw) => {
        const out: Record<string, number> = {}
        for (const id of Object.keys(raw)) {
          const pts = scoreStatLine(raw[id], scoring)
          if (pts) out[id] = pts
        }
        return out
      },
    },
  )

/**
 * The NFL schedule, one row per game. Not in the documented API (and not under
 * /v1), but it is what the Sleeper app itself loads. Byes are the weeks a team
 * is missing from it.
 */
export const getSchedule = (season: string) =>
  cachedGet<ScheduleGame[]>(`/schedule/nfl/regular/${season}`, 12 * HOUR, { base: 'https://api.sleeper.app' })

/**
 * Games played per player across a whole regular season, from the season-total
 * stat line (~1.2MB) reduced to one number per player. A finished season never
 * changes, so it caches for a week.
 */
export const getSeasonGamesPlayed = (season: string) =>
  cachedGet<WeekStats, Record<string, number>>(`/stats/nfl/regular/${season}`, 7 * 24 * HOUR, {
    key: `season-gp:${season}`,
    transform: (raw) => {
      const out: Record<string, number> = {}
      for (const id of Object.keys(raw)) {
        const gp = raw[id]?.gp
        if (gp) out[id] = gp
      }
      return out
    },
  })

// ---------- Image helpers ----------

export const avatarUrl = (avatar: string | null | undefined) =>
  avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null

export const playerImageUrl = (player: TrimmedPlayer) =>
  player.pos === 'DEF'
    ? `https://sleepercdn.com/images/team_logos/nfl/${player.id.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`
