import { useEffect, useState } from 'react'
import { parseScoreboard, type Broadcast } from '../../lib/fantasy/nfl'

const TTL = 20 * 60_000
const memory = new Map<string, { at: number; data: Record<string, Broadcast> }>()

/**
 * Where to watch each NFL game of a week, from ESPN's public scoreboard. It is a nicety: if the request fails or is
 * blocked, games simply show no network. Cached for 20 minutes in memory and this tab's session storage.
 */
export const useBroadcasts = (season: string, week: number | null) => {
  const key = `ff:espn:${season}:${week}`
  const [data, setData] = useState<Record<string, Broadcast>>(() => memory.get(key)?.data ?? {})
  useEffect(() => {
    if (week == null) return
    const hit = memory.get(key)
    if (hit && Date.now() - hit.at < TTL) return setData(hit.data)
    try {
      const raw = window.sessionStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as { at: number; data: Record<string, Broadcast> }
        if (Date.now() - saved.at < TTL) {
          memory.set(key, saved)
          return setData(saved.data)
        }
      }
    } catch {
      // Storage blocked: fetch instead.
    }
    let live = true
    const ctrl = new AbortController()
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!live || !json) return
        const parsed = parseScoreboard(json)
        const entry = { at: Date.now(), data: parsed }
        memory.set(key, entry)
        try {
          window.sessionStorage.setItem(key, JSON.stringify(entry))
        } catch {
          // Storage blocked or full: memory is enough.
        }
        setData(parsed)
      })
      .catch(() => {
        // Blocked or offline: no networks, and nothing else changes.
      })
    return () => {
      live = false
      ctrl.abort()
    }
  }, [key, season, week])
  return data
}
