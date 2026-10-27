// When an NFL game counts as over, or under way.
//
// Three sources, best first. ESPN's scoreboard knows a game is under way or over to the minute, but only while its
// reading is fresh: a feed that stopped answering says nothing. Sleeper's schedule status comes next, though it lags.
// Last is the calendar, in US Eastern time, since that is the date a game is listed under: compared with the UTC
// date, every Sunday game turned final at 8 PM Eastern, mid-slate, with the night game still to play. A night game can
// also run past midnight Eastern, so "past" means the game's date is before the Eastern date four hours ago: Sunday's
// games end by the calendar at 4 AM Monday.

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The US Eastern calendar date of an instant, YYYY-MM-DD. Read from the parts, not a locale's date format. */
export const etDay = (ms: number) => {
  const parts = ET.formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`
}

const HOUR = 3600_000
/** Hours after midnight Eastern that a game dated the day before can still be running (overtime in a night game). */
const GRACE_HOURS = 4

/** Whether a game dated `date` (Eastern, YYYY-MM-DD) is over by the calendar at `now`. */
export const pastByCalendar = (date: string | null | undefined, now = Date.now()) => !!date && date < etDay(now - GRACE_HOURS * HOUR)

/**
 * A full day beyond that: by then a Sleeper status still saying the game is on is stale, not a game in its second day,
 * and the calendar closes it anyway.
 */
export const longPastByCalendar = (date: string | null | undefined, now = Date.now()) => pastByCalendar(date, now - 24 * HOUR)

/** A game's state as ESPN's scoreboard reports it, keyed "AWAY@HOME". Postponed and suspended games read 'pre'. */
export type FeedState = 'pre' | 'in' | 'post'

/** One reading of ESPN's feed for a game: its state, and when it was fetched. */
export type FeedReading = { state: FeedState; at: number }

/**
 * How long an 'in' or 'pre' reading counts: past this (the fetch failing, the poll stopped) the game falls back to
 * Sleeper. A completed game ('post') stays over however old the reading: once over, always over.
 */
export const FEED_TTL = 10 * 60_000

/** A feed's state if it still holds at `now`, else nothing. A bare state is taken as current (a caller that checked). */
export const readFeed = (f: FeedState | FeedReading | null | undefined, now = Date.now()): FeedState | undefined =>
  !f ? undefined : typeof f === 'string' ? f : f.state === 'post' || now - f.at <= FEED_TTL ? f.state : undefined

type Game = { status?: string | null; date?: string | null }
const sleeperLive = (g: Game | undefined) => g?.status === 'in_game' || g?.status === 'in_progress'

/**
 * Whether a game is final: a fresh ESPN reading first (over, on, or not yet started: a postponed game is not final
 * however far its old date is behind), then Sleeper's status, then the calendar. A Sleeper status still saying the
 * game is on holds the calendar off only until a day past its close.
 */
export const gameIsFinal = (g: Game | undefined, feed: FeedState | FeedReading | null | undefined, now = Date.now()) => {
  if (!g) return false
  const f = readFeed(feed, now)
  if (f) return f === 'post'
  if (g.status === 'complete') return true
  if (sleeperLive(g)) return longPastByCalendar(g.date, now)
  return pastByCalendar(g.date, now)
}

/** Whether a game is under way: a fresh ESPN reading says so, or, without one, Sleeper does (until its status is stale). */
export const gameIsLive = (g: Game | undefined, feed: FeedState | FeedReading | null | undefined, now = Date.now()) => {
  const f = readFeed(feed, now)
  if (f) return f === 'in'
  return sleeperLive(g) && !longPastByCalendar(g?.date, now)
}
