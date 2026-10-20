// The address of a shared Power Rank, written in one place for both sides: the worker redirects to it, and the app
// builds the same address for a link with no preview and reads it back (components/fantasy/useDeepLink.ts).
// Free of imports so the app's bundle and the worker's can both take it.

export const SITE = 'https://sujeff.com'

/** A league id as the app and the worker accept it (Sleeper's numbers, and ESPN's `espn:<id>`). */
export const LEAGUE_ID = /^[A-Za-z0-9:_.-]{1,64}$/

/**
 * Where a shared week lives in the app. The season keeps a link to a past season's league working. Week 1 is written
 * `01`, because a bare `reveal=1` already means "the latest week".
 */
export const appUrl = (m: { leagueId: string; week: number; season?: string | null }, site = SITE) =>
  `${site}/fantasy?league=${encodeURIComponent(m.leagueId)}${m.season ? `&season=${encodeURIComponent(m.season)}` : ''}&reveal=${m.week === 1 ? '01' : m.week}#power`
