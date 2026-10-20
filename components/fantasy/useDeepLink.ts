import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'

/**
 * A shared Power Rank link: `?league=<id>&reveal=<week>`. It is read once on arrival and kept in memory while the
 * visitor gets through onboarding (and the tour), so it survives the name prompt; the address keeps its parameters
 * until the link has been used, so a reload in the middle of that still finds it. Then the league is selected if the
 * visitor is in it, and the week's reveal opens (useReveal). Used up, the parameters come off the address.
 *
 * `reveal=` alone, or `reveal=1`, means the latest week. A week number means that week; week 1 is written `01`.
 */
export type DeepLink = { league: string | null; week: number | 'latest' | null }

/** The link in an address's query string, or null when it carries none. */
export const parseDeepLink = (search: string): DeepLink | null => {
  const q = new URLSearchParams(search)
  const league = q.get('league')
  const reveal = q.get('reveal')
  if (league == null && reveal == null) return null
  let week: DeepLink['week'] = null
  if (reveal != null) {
    // A bare 1 has always meant "the latest"; week 1 is `01`.
    week = reveal === '1' || !/^\d{1,2}$/.test(reveal) ? 'latest' : Number(reveal)
    if (week === 0) week = 'latest'
  }
  return { league: league && /^[A-Za-z0-9:_.-]{1,64}$/.test(league) ? league : null, week }
}

/** Takes the link's parameters off the address, leaving the rest. */
const clearParams = () => {
  const q = new URLSearchParams(window.location.search)
  if (q.get('league') == null && q.get('reveal') == null) return
  q.delete('league')
  q.delete('reveal')
  const rest = q.toString()
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
}

/** What the visitor is told when the link cannot be followed all the way. */
export type DeepNote = { text: string }

/**
 * `ready` is the link once its league is the one on screen (or it names none): hand it to useReveal, which opens the week
 * and calls `finish`. `note` is a friendly line for a link that could not be followed.
 */
export const useDeepLink = ({
  onboarded,
  data,
  loading,
  selectLeague,
}: {
  onboarded: boolean
  data: LeagueData | null
  loading: boolean
  selectLeague: (id: string) => void
}) => {
  const [link, setLink] = useState<DeepLink | null>(null)
  const [note, setNote] = useState<DeepNote | null>(null)
  // After asking for the link's league: waiting for the load to start, then for it to land.
  const asked = useRef<null | 'wait' | 'loading'>(null)
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    setLink(parseDeepLink(window.location.search))
  }, [])

  const finish = useCallback((text?: string) => {
    clearParams()
    asked.current = null
    setStalled(false)
    setLink(null)
    if (text) setNote({ text })
  }, [])

  const wrong = 'That link is for a league this account is not in, so this is your own league instead.'
  // Switch to the link's league when the visitor is in it; otherwise say so.
  useEffect(() => {
    if (!link?.league || !onboarded || !data || data.league.league_id === link.league) return
    if (asked.current === null) {
      if (loading) return
      if (data.leagues.some((l) => l.league_id === link.league)) {
        asked.current = 'wait'
        selectLeague(link.league)
      } else finish(wrong)
      return
    }
    if (loading) asked.current = 'loading'
    else if (asked.current === 'loading' || stalled) finish(wrong)
  }, [link, onboarded, data, loading, selectLeague, finish, stalled])
  // A switch that never shows a load must not hold the link forever.
  useEffect(() => {
    if (!link?.league || !onboarded) return
    const id = window.setTimeout(() => setStalled(true), 20000)
    return () => window.clearTimeout(id)
  }, [link, onboarded])

  const ready = link && onboarded && data && !loading && (!link.league || data.league.league_id === link.league) ? link : null
  // A link that names a league and no week is used up as soon as the league is up.
  useEffect(() => {
    if (ready && ready.week == null) finish()
  }, [ready, finish])

  const dismiss = useCallback(() => setNote(null), [])
  return { link, ready: ready && ready.week != null ? { week: ready.week } : null, finish, note, dismiss }
}

/** The plain address of a week's reveal in the app, for a link with no preview (and the one the preview sends people to). */
export const deepLinkUrl = (leagueId: string, week: number, site = 'https://sujeff.com') => `${site}/fantasy?league=${encodeURIComponent(leagueId)}&reveal=${week === 1 ? '01' : week}#power`
