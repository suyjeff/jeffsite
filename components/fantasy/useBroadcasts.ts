import { useEffect, useState } from 'react'
import { parseScoreboard, type Broadcast } from '../../lib/fantasy/nfl'

// Short, so a score shown mid-game is never far behind; networks do not change, but they come in the same payload.
const TTL = 90_000
const memory = new Map<string, { at: number; data: Record<string, Broadcast> }>()
// Several views ask for the same week at once (the scorecards read its clock): one request between them.
const inflight = new Map<string, Promise<Record<string, Broadcast> | null>>()

/**
 * Where to watch each NFL game of a week, from ESPN's public scoreboard. It is a nicety: if the request fails or is
 * blocked, games simply show no network. Cached for 90 seconds in memory and this tab’s session storage, and read again each time a sheet opens.
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
    let run = inflight.get(key)
    if (!run) {
      run = fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return null
          const parsed = parseScoreboard(json)
          const entry = { at: Date.now(), data: parsed }
          memory.set(key, entry)
          try {
            window.sessionStorage.setItem(key, JSON.stringify(entry))
          } catch {
            // Storage blocked or full: memory is enough.
          }
          return parsed
        })
        // Blocked or offline: no networks, and nothing else changes.
        .catch(() => null)
        .finally(() => inflight.delete(key))
      inflight.set(key, run)
    }
    run.then((parsed) => live && parsed && setData(parsed))
    return () => {
      live = false
    }
  }, [key, season, week])
  return data
}
