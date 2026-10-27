import { useEffect, useReducer, useRef } from 'react'
import type { ScheduleGame } from '../../lib/fantasy/context'
import { getLiveMatchups, getLiveSchedule, getWeekActuals, type WeekActuals } from '../../lib/fantasy/sleeper'
import type { SleeperMatchup } from '../../lib/fantasy/types'

// The page loads Sleeper's matchups and schedule once. While the week's games are on, this reads them again (with
// the week's stats) on the live poll, so points and statuses move with the games and nothing settles on what was
// posted before kickoff. One shared store per league and week: every view reads the same copy, and one request at a
// time goes out however many ask.

/** The live reads of a week, each with when it was fetched. */
export type LiveWeek = {
  matchups: { matchups: SleeperMatchup[]; at: number } | null
  games: { games: ScheduleGame[]; at: number } | null
  actuals: { data: WeekActuals; at: number } | null
}

export type LiveWeekArgs = {
  leagueId: string
  season: string
  week: number
  scoring: Record<string, number>
  /** Sleeper's league endpoints answer only for a Sleeper league; an ESPN league reads its schedule and stats alone. */
  sleeper: boolean
  /** The week is over and its stats can be kept for a day (lib/fantasy/liveWeek weekSettled). */
  settled: boolean
}

const store = new Map<string, LiveWeek>()
const subs = new Map<string, Set<() => void>>()
const running = new Set<string>()
const lastRun = new Map<string, number>()
/** At most one read per this gap, whichever view asks; the live caches keep less than it, so each read is new. */
const GAP = 30_000

export const liveKey = (leagueId: string, season: string, week: number) => `${leagueId}:${season}:${week}`

const refresh = (a: LiveWeekArgs, force: boolean) => {
  const key = liveKey(a.leagueId, a.season, a.week)
  if (running.has(key) || (!force && Date.now() - (lastRun.get(key) ?? 0) < GAP)) return
  running.add(key)
  lastRun.set(key, Date.now())
  Promise.allSettled([
    a.sleeper ? getLiveMatchups(a.leagueId, a.week) : Promise.resolve(null),
    getLiveSchedule(a.season),
    getWeekActuals(a.leagueId, a.season, a.week, a.scoring, a.settled),
  ])
    .then(([m, s, x]) => {
      const at = Date.now()
      const prev = store.get(key) ?? { matchups: null, games: null, actuals: null }
      store.set(key, {
        matchups: m.status === 'fulfilled' && Array.isArray(m.value) && m.value.length ? { matchups: m.value, at } : prev.matchups,
        games: s.status === 'fulfilled' && Array.isArray(s.value) ? { games: s.value.filter((g) => g.week === a.week), at } : prev.games,
        actuals: x.status === 'fulfilled' && x.value ? { data: x.value, at } : prev.actuals,
      })
      subs.get(key)?.forEach((f) => f())
    })
    .finally(() => running.delete(key))
}

/** The live reads of a week as they stand, re-rendering when a new read lands. Null before the first. */
export const useLiveWeekSnapshot = (key: string | null) => {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!key) return
    const set = subs.get(key) ?? new Set()
    subs.set(key, set)
    set.add(bump)
    return () => {
      set.delete(bump)
    }
  }, [key])
  return key ? (store.get(key) ?? null) : null
}

/**
 * Reads the week again while `on` (its games have started, or one is today): once, then on each `tick` of the live
 * poll, and at once on Reload (`version`, the league data) or when the week settles.
 */
export const useLiveWeekRefresh = (args: LiveWeekArgs | null, on: boolean, tick: number, version: unknown) => {
  const seen = useRef({ version, settled: args?.settled })
  const key = args ? liveKey(args.leagueId, args.season, args.week) : null
  useEffect(() => {
    if (!args || !on) return
    const force = seen.current.version !== version || seen.current.settled !== args.settled
    seen.current = { version, settled: args.settled }
    refresh(args, force)
  }, [key, on, tick, version, args?.settled]) // eslint-disable-line react-hooks/exhaustive-deps
}
