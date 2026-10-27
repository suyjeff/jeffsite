// When an NFL game counts as over by the calendar.
//
// Sleeper's schedule status lags, so a game whose date has passed is taken as final. But the date is the game's US
// Eastern date, and the device clock is not: compared with the UTC date, every Sunday game turned final at 8 PM
// Eastern, mid-slate, with the night game still to play. A night game can also run past midnight Eastern. So "past"
// means the game's date is before the Eastern date four hours ago: Sunday's games end by the calendar at 4 AM Monday.

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The US Eastern calendar date of an instant, YYYY-MM-DD. */
export const etDay = (ms: number) => ET.format(new Date(ms))

/** Hours after midnight Eastern that a game dated the day before can still be running (overtime in a night game). */
const GRACE_HOURS = 4

/** Whether a game dated `date` (Eastern, YYYY-MM-DD) is over by the calendar at `now`. */
export const pastByCalendar = (date: string | null | undefined, now = Date.now()) => !!date && date < etDay(now - GRACE_HOURS * 3600_000)

/** A game's state as ESPN's scoreboard reports it, keyed "AWAY@HOME". */
export type FeedState = 'pre' | 'in' | 'post'

/**
 * Whether a game is final: ESPN's live feed first (it knows a game is under way or over to the minute), then Sleeper's
 * status, then the calendar, but never while Sleeper or ESPN still says the game is on.
 */
export const gameIsFinal = (g: { status?: string | null; date?: string | null } | undefined, feed: FeedState | undefined, now = Date.now()) => {
  if (!g) return false
  if (feed === 'post') return true
  if (feed === 'in') return false
  if (g.status === 'complete') return true
  if (g.status === 'in_game' || g.status === 'in_progress') return false
  return pastByCalendar(g.date, now)
}

/** Whether a game is under way: ESPN says so, or Sleeper does. */
export const gameIsLive = (g: { status?: string | null } | undefined, feed: FeedState | undefined) =>
  feed === 'in' || (feed !== 'post' && (g?.status === 'in_game' || g?.status === 'in_progress'))
