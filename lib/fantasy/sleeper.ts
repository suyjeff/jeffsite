import type { ScheduleGame } from './context'
import { scoreStatLine } from './scoring'
import type {
  PlayerMap,
  SleeperLeague,
  SleeperMatchup,
  SleeperPlayer,
  SleeperRoster,
  SleeperState,
  SleeperTransaction,
  SleeperUser,
  TrendingEntry,
  TrimmedPlayer,
  WeekStats,
} from './types'

const BASE = 'https://api.sleeper.app/v1'
// v3: trimmed players carry the news timestamp; v2 added depth-chart and injury fields.
// Older copies are purged on load (purgeStaleCache), so the bump frees their quota.
const CACHE_PREFIX = 'ff:v3:'

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
  // Transactions moved to tx2 (FAAB bids kept); the old copies are dead weight.
  removeKeys((k) => k.startsWith(`${CACHE_PREFIX}tx:`))
}

export class SleeperError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const fetchJson = async <T>(url: string, text = false): Promise<T> => {
  const res = await fetch(url, { headers: { accept: text ? 'text/csv,text/plain' : 'application/json' } })
  if (!res.ok) throw new SleeperError(`${res.status} ${res.statusText} for ${url}`, res.status)
  return (text ? await res.text() : await res.json()) as T
}

/**
 * Cached GET. `ttl` in ms. Set persist=false for payloads too big for localStorage.
 * `transform` runs before caching so the stored payload is already trimmed.
 */
const cachedGet = async <T, R = T>(
  path: string,
  ttl: number,
  opts: { persist?: boolean; transform?: (raw: T) => R; base?: string; key?: string; text?: boolean } = {},
): Promise<R> => {
  const url = (opts.base ?? BASE) + path
  // A transform that depends on league settings needs its own key so two
  // leagues with different scoring do not read each other's cached result.
  const cacheKey = opts.key ?? url
  const cached = readCache<R>(cacheKey, ttl)
  if (cached !== null) return cached
  const raw = await fetchJson<T>(url, opts.text)
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
    newsAt: p.news_updated ?? null,
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
  // Short-lived: the rows carry each game's status, which Gameday reads to know what is final.
  cachedGet<ScheduleGame[]>(`/schedule/nfl/regular/${season}`, 20 * MINUTE, { base: 'https://api.sleeper.app' })

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

type RawTransaction = {
  type: string
  status: string
  roster_ids?: number[] | null
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?: unknown[] | null
  created?: number
  leg?: number
  settings?: { waiver_bid?: number } | null
  waiver_budget?: { sender: number; receiver: number; amount: number }[] | null
}

/**
 * One week's transactions: trades, waiver claims, free-agent pickups. Small,
 * and a finished week never changes, so past weeks cache for a day.
 */
export const getTransactions = (leagueId: string, week: number, isPast: boolean) =>
  cachedGet<RawTransaction[], SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`, isPast ? 24 * HOUR : 10 * MINUTE, {
    // v2: keeps FAAB bids and FAAB moved in trades.
    key: `tx2:${leagueId}:${week}`,
    transform: (raw) =>
      (Array.isArray(raw) ? raw : []).map((t) => ({
        type: t.type,
        status: t.status,
        roster_ids: t.roster_ids ?? [],
        adds: t.adds ?? null,
        drops: t.drops ?? null,
        picks: t.draft_picks?.length ?? 0,
        created: t.created ?? 0,
        leg: t.leg ?? week,
        bid: t.settings?.waiver_bid ?? null,
        faab: t.waiver_budget?.length ? t.waiver_budget : null,
      })),
  })

/**
 * One week of projected stat lines, kept only for players with a real share
 * of the week (2+ PPR points), so the cached copy is a few dozen KB rather
 * than the raw ~650KB. Feeds the prop-line scoring, which needs the
 * categories the lines do not price (fumbles, two-pointers, bonuses).
 */
export const getWeekStatLines = (season: string, week: number) =>
  cachedGet<WeekStats, WeekStats>(`/projections/nfl/regular/${season}/${week}`, 3 * HOUR, {
    key: `proj-lines:${season}:${week}`,
    transform: (raw) => {
      const out: WeekStats = {}
      for (const id of Object.keys(raw)) if ((raw[id]?.pts_ppr ?? 0) >= 2 || (raw[id]?.fgm ?? 0) > 0) out[id] = raw[id]
      return out
    },
  })

// ---------- Market lines ----------

/**
 * Sleeper's prop board for the NFL, reduced to two-sided player props before
 * caching. About 100KB gzipped; Sleeper's CDN caches it for 30 seconds, and
 * this page reads it at most every 20 minutes.
 */
export const getLines = <R>(transform: (raw: unknown) => R) =>
  cachedGet<unknown, R>('/lines/available?sports%5B%5D=nfl', 20 * MINUTE, { base: 'https://api.sleeper.app', key: 'lines:nfl', transform })

// ---------- Outside rankings ----------

/**
 * FantasyPros expert consensus rankings (ECR), as mirrored weekly by the
 * open-source DynastyProcess data repo on GitHub. One ~900KB CSV a day, read
 * from GitHub's raw CDN (CORS-open, no key, generous limits), reduced to the
 * redraft and weekly offensive pages and cached for twelve hours. Nothing here
 * calls FantasyPros itself, so there is no scraping and nothing to get blocked.
 */
export const CONSENSUS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv'
export const getConsensusCsv = <R>(transform: (csv: string) => R) =>
  cachedGet<string, R>('', 12 * HOUR, { base: CONSENSUS_URL, key: 'consensus:fpecr', text: true, transform })

// ---------- Image helpers ----------

export const avatarUrl = (avatar: string | null | undefined) =>
  avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null

export const playerImageUrl = (player: TrimmedPlayer) =>
  player.pos === 'DEF'
    ? `https://sleepercdn.com/images/team_logos/nfl/${player.id.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`
