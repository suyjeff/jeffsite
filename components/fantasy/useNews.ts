import { useEffect, useMemo, useState } from 'react'
import { loadNews, type NewsItem } from '../../lib/fantasy/news'
import type { PlayerMap } from '../../lib/fantasy/types'

const NONE: Record<string, NewsItem[]> = {}

/**
 * ESPN's latest news for these players, newest first, by Sleeper id. Empty until it arrives and empty for good if
 * ESPN is blocked or down, so callers treat "no item" as "fall back to Sleeper's flag". Shared and cached for 20 minutes.
 */
export const useNews = (ids: string[], players: PlayerMap): Record<string, NewsItem[]> => {
  // Keyed by the ids and their ESPN ids so a new array of the same players does not refetch.
  const key = useMemo(() => ids.filter((id) => players[id]?.espnId).sort().join(','), [ids, players])
  const [news, setNews] = useState<Record<string, NewsItem[]>>(NONE)
  useEffect(() => {
    if (!key) return setNews(NONE)
    let live = true
    loadNews(key.split(','), players).then((n) => live && setNews(n))
    return () => {
      live = false
    }
    // `players` is read only to look up ESPN ids, and `key` already names the players that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return news
}
