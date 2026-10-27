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
// A forced read asked for while one is out: run once more when it lands, with the latest arguments.
const queued = new Map<string, LiveWeekArgs>()
const lastRun = new Map<string, number>()
/** At most one read per this gap, whichever view asks; the live caches keep less than it, so each read is new. */
const GAP = 30_000

export const liveKey = (leagueId: string, season: string, week: number) => `${leagueId}:${season}:${week}`

/**
 * Read the week's matchups, schedule and stats again: at most once per gap unless `force`d (a Reload). A forced read
 * asked for while one is out runs as soon as that one lands, so it is never lost.
 */
export const refreshLiveWeek = (a: LiveWeekArgs, force: boolean) => {
  const key = liveKey(a.leagueId, a.season, a.week)
  if (running.has(key)) {
    if (force) queued.set(key, a)
    return
  }
  if (!force && Date.now() - (lastRun.get(key) ?? 0) < GAP) return
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
    .finally(() => {
      running.delete(key)
      const next = queued.get(key)
      queued.delete(key)
      if (next) refreshLiveWeek(next, true)
    })
}

// What a week keeps beyond a read: when each game was first seen over, and whether the week has settled. Both are
// kept in this browser per league and week, so they survive a reload and a feed that has stopped answering; settled
// never goes back to false.
type WeekMemo = { ends: Record<string, number>; settled: boolean }
const memos = new Map<string, WeekMemo>()
const MEMO_PREFIX = 'ff:v3:week-memo:'

const memoOf = (key: string): WeekMemo => {
  let m = memos.get(key)
  if (!m) {
    m = { ends: {}, settled: false }
    try {
      const raw = window.localStorage.getItem(MEMO_PREFIX + key)
      if (raw) m = { ...m, ...(JSON.parse(raw) as WeekMemo) }
    } catch {
      // Storage blocked: this visit only.
    }
    memos.set(key, m)
  }
  return m
}
const saveMemo = (key: string, m: WeekMemo) => {
  memos.set(key, m)
  try {
    window.localStorage.setItem(MEMO_PREFIX + key, JSON.stringify(m))
  } catch {
    // Storage blocked or full: memory is enough for this visit.
  }
}

/** Each game's recorded end, with any newly seen ones added (the earliest sighting kept). */
export const recordEnds = (key: string | null, seen: Record<string, number>) => {
  if (!key) return seen
  const m = memoOf(key)
  let changed = false
  const ends = { ...m.ends }
  for (const [k, t] of Object.entries(seen))
    if (ends[k] == null || t < ends[k]) {
      ends[k] = t
      changed = true
    }
  if (changed) saveMemo(key, { ...m, ends })
  return changed ? ends : m.ends
}

/** Whether the week has settled: once `now` says so, for good. */
export const stickySettled = (key: string | null, now: boolean) => {
  if (!key) return now
  const m = memoOf(key)
  if (now && !m.settled) saveMemo(key, { ...m, settled: true })
  return now || m.settled
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
 * Reads the week again while `active` (a game under way or in its kickoff window, or one over whose points are older
 * than its end): at once, then on each `tick` of the live poll, and at once on Reload (`version`, the league data).
 * Outside that the page's own cached loads stand, apart from one last read as the poll stops (shared by every view,
 * like the rest: the gap between reads keeps it to one).
 */
export const useLiveWeekRefresh = (args: LiveWeekArgs | null, active: boolean, tick: number, version: unknown) => {
  const seen = useRef({ version, active })
  const key = args ? liveKey(args.leagueId, args.season, args.week) : null
  useEffect(() => {
    if (!args) return
    const was = seen.current
    seen.current = { version, active }
    if (active) refreshLiveWeek(args, was.version !== version)
    else if (was.active) refreshLiveWeek(args, false)
  }, [key, active, tick, version, args?.settled]) // eslint-disable-line react-hooks/exhaustive-deps
}
