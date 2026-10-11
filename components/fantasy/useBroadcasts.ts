import { useEffect, useState } from 'react'
import { parseScoreboard, type Broadcast } from '../../lib/fantasy/nfl'

// Short, so a score or clock shown mid-game is never far behind (the live poll below asks every minute); networks do
// not change, but they come in the same payload.
const TTL = 45_000
const memory = new Map<string, { at: number; data: Record<string, Broadcast> }>()
// Several views ask for the same week at once (the scorecards read its clock): one request between them.
const inflight = new Map<string, Promise<Record<string, Broadcast> | null>>()

/**
 * A count that goes up once a minute while `active` (a game is under way) and the page is in view, and again when the
 * page comes back into view. Live readers put it in their effects' deps to read again; it never runs between games.
 */
export const useLiveTick = (active: boolean, every = 60_000) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const bump = () => document.visibilityState === 'visible' && setTick((t) => t + 1)
    const id = window.setInterval(bump, every)
    document.addEventListener('visibilitychange', bump)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [active, every])
  return tick
}

/**
 * Where to watch each NFL game of a week, from ESPN's public scoreboard, with the score and clock once it starts. It
 * is a nicety: if the request fails or is blocked, games simply show no network. Cached for 45 seconds in memory and
 * this tab’s session storage, and read again each time a sheet opens or `tick` (useLiveTick) moves.
 */
export const useBroadcasts = (season: string, week: number | null, tick = 0) => {
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
  }, [key, season, week, tick])
  return data
}
