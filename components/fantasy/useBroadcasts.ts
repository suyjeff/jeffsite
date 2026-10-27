import { useEffect, useState } from 'react'
import { GAME_SPAN } from '../../lib/fantasy/liveWeek'
import { parseScoreboard, type Broadcast } from '../../lib/fantasy/nfl'

// Short, so a score or clock shown mid-game is never far behind (the live poll below asks every minute); networks do
// not change, but they come in the same payload.
const TTL = 45_000
const memory = new Map<string, { at: number; data: Record<string, Broadcast> }>()
// Several views ask for the same week at once (the scorecards read its clock): one request between them.
const inflight = new Map<string, Promise<Record<string, Broadcast> | null>>()
// When a reading first saw each game over, by week and game: the slate settles a game only on points read after.
const firstPost = new Map<string, number>()

/** Each game's reading stamped with when it was fetched, and the latest it can have ended. */
const stamp = (key: string, parsed: Record<string, Broadcast>, at: number) => {
  const out: Record<string, Broadcast> = {}
  for (const [k, b] of Object.entries(parsed)) {
    let ended: number | undefined
    if (b.state === 'post') {
      const seen = firstPost.get(`${key}:${k}`) ?? at
      firstPost.set(`${key}:${k}`, seen)
      ended = b.start != null ? Math.min(seen, b.start + GAME_SPAN) : seen
    }
    out[k] = { ...b, at, ...(ended != null ? { ended } : {}) }
  }
  return out
}

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
 * The hour, re-rendering when it turns: for readings that change with the clock alone, like the calendar closing a
 * game day at 4 AM Eastern with no feed or poll to say so.
 */
export const useHourTick = () => {
  const HOUR = 3600_000
  const [hour, setHour] = useState(() => Math.floor(Date.now() / HOUR))
  useEffect(() => {
    const id = window.setTimeout(() => setHour(Math.floor(Date.now() / HOUR)), Math.max(1000, (hour + 1) * HOUR - Date.now() + 1000))
    return () => window.clearTimeout(id)
  }, [hour])
  return hour
}

/**
 * Where to watch each NFL game of a week, from ESPN's public scoreboard, with the score and clock once it starts. It
 * is a nicety: if the request fails or is blocked, games simply show no network. Each reading carries when it was
 * fetched (`at`), so a reader can tell a feed that has gone quiet from one that is current (lib/fantasy/gameTime).
 * Cached for 45 seconds in memory and this tab’s session storage, and read again each time a sheet opens or `tick`
 * (useLiveTick) moves.
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
          const at = Date.now()
          const parsed = stamp(key, parseScoreboard(json), at)
          const entry = { at, data: parsed }
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
