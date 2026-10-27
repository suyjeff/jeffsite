// The week while it is being played: what the live readers (ESPN's scoreboard, and Sleeper's matchups, schedule and
// stats, read again each minute) tell the slate, and when to keep asking. Pure, so the hooks stay thin and the rules
// can be tested against a clock.

import type { ScheduleGame } from './context'
import { etDay, gameIsFinal, gameIsLive, longPastByCalendar, pastByCalendar, readFeed, type FeedReading } from './gameTime'
import type { Broadcast } from './nfl'
import type { SleeperMatchup } from './types'

const MIN = 60_000
const HOUR = 60 * MIN

/** How long after kickoff a game can still be running, as a bound when no reading saw it end. */
export const GAME_SPAN = 5 * HOUR

export const keyOf = (g: { away: string; home: string }) => `${g.away}@${g.home}`

/** The week's games, canceled ones aside. */
export const weekGames = (games: ScheduleGame[] | null | undefined, week: number) => (games ?? []).filter((g) => g.week === week && g.status !== 'canceled')

/** A feed reading with what the slate needs to judge it: when it was read, and the latest the game can have ended. */
export type LiveFeed = FeedReading & { ended?: number }

/**
 * From ESPN's scoreboard: each game's reading for the slate, and the share of regulation played in each game under way.
 * Stale readings are dropped here as well as in the slate. The key changes only when what the slate reads does.
 */
export const feedFrom = (casts: Record<string, Broadcast>, now: number) => {
  const feed: Record<string, LiveFeed> = {}
  const elapsed: Record<string, number> = {}
  for (const [k, c] of Object.entries(casts)) {
    if (!c.state || c.at == null || !readFeed({ state: c.state, at: c.at }, now)) continue
    feed[k] = { state: c.state, at: c.at, ...(c.ended != null ? { ended: c.ended } : {}) }
    if (c.state === 'in' && c.elapsed != null) elapsed[k] = c.elapsed
  }
  const sig = Object.keys(feed)
    .sort()
    .map((k) => `${k}:${feed[k].state}${elapsed[k] != null ? `:${elapsed[k].toFixed(3)}` : ''}`)
    .join('|')
  return { feed, elapsed, sig }
}

/** A scoreboard entry as a feed reading, when it has a state and a fetch time. */
const toReading = (c: Broadcast | undefined): FeedReading | undefined => (c?.state && c.at != null ? { state: c.state, at: c.at } : undefined)

/** Each game as the calendar alone reads it now: a key for caches, so the 4 AM close lands without a feed change. */
export const calendarSig = (games: ScheduleGame[], now: number) =>
  games.map((g) => (longPastByCalendar(g.date, now) ? 'L' : pastByCalendar(g.date, now) ? 'P' : g.date === etDay(now) ? 'T' : '-')).join('')

/**
 * Whether the week is on at all: a game today (Eastern), or one under way or over. Then the live readers are asked
 * once (a finished week still needs its box scores), and the poll decides whether to keep asking.
 */
export const weekOn = (games: ScheduleGame[], casts: Record<string, Broadcast>, now: number) => {
  const today = etDay(now)
  return games.some((g) => g.date === today || gameIsLive(g, toReading(casts[keyOf(g)]), now) || gameIsFinal(g, toReading(casts[keyOf(g)]), now))
}

/**
 * Whether to keep polling: some game under way by a fresh feed or Sleeper's status, or one in its kickoff window. The
 * window is ESPN's kickoff when it has one (fifteen minutes before, to five hours after, unless it reads over), else
 * Sleeper's date being today in Eastern time with the game not yet over. It stops once every game of the day is over.
 */
export const shouldPoll = (games: ScheduleGame[], casts: Record<string, Broadcast>, now: number) => {
  const today = etDay(now)
  return games.some((g) => {
    const c = casts[keyOf(g)]
    const f = readFeed(toReading(c), now)
    if (gameIsLive(g, toReading(c), now)) return true
    if (f === 'post' || g.status === 'complete') return false
    if (c?.start != null) return now >= c.start - 15 * MIN && now <= c.start + GAME_SPAN
    return g.date === today
  })
}

/**
 * Whether the week's results can be kept as final: Sleeper's schedule says every game is complete, or two hours have
 * passed since ESPN last saw one end, so Sleeper's stats have caught up before the week is cached for a day.
 */
export const weekSettled = (games: ScheduleGame[], casts: Record<string, Broadcast>, now: number) => {
  if (!games.length) return false
  if (games.every((g) => g.status === 'complete')) return true
  const ends = games.map((g) => {
    const c = casts[keyOf(g)]
    return readFeed(toReading(c), now) === 'post' ? (c!.ended ?? c!.at!) : null
  })
  if (ends.some((e) => e == null)) return false
  return now - Math.max(...(ends as number[])) >= 2 * HOUR
}

/**
 * The fresher of two copies of a week's matchups: the one loaded with the page, or one read since. Only the newer
 * read's points and lineups count, so a game can never settle on what was posted before it started.
 */
export const freshMatchups = (base: SleeperMatchup[], live: { matchups: SleeperMatchup[]; at: number } | null, baseAt: number) =>
  live && live.at > baseAt && live.matchups.length ? { matchups: live.matchups, at: live.at } : { matchups: base, at: baseAt }

/** The week's schedule rows, with the statuses of a fresher read laid over the page's copy. */
export const freshGames = (base: ScheduleGame[], live: ScheduleGame[] | null) => {
  if (!live?.length) return base
  const byKey = new Map(live.map((g) => [`${g.week}:${keyOf(g)}`, g]))
  return base.map((g) => {
    const l = byKey.get(`${g.week}:${keyOf(g)}`)
    return l ? { ...g, status: l.status ?? g.status, date: l.date ?? g.date } : g
  })
}
