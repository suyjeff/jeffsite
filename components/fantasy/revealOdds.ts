import { useEffect, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Models } from '../../lib/fantasy/models'
import { joinOdds, mergeSims, RECAP_SIMS, RECAP_SLICE, recapOddsRuns, type Odds, type Recap } from '../../lib/fantasy/recap'
import type { SimTeam } from '../../lib/fantasy/forecast'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import type { RevealSource } from './useReveal'

// The reveal's playoff odds, before and after the week: thousands of simulated seasons, run a slice at a time in the
// page's idle moments so they never hold up a frame. They start as soon as the week's recap exists (the banner's
// load), so by the time anyone opens the reveal they are usually done; one cache per recap serves every caller.

type Entry = { value: Record<number, Odds> | null; done: Promise<Record<number, Odds>>; /** Someone is waiting: run between frames, not only when idle. */ urgent: boolean }
const cache = new WeakMap<Recap, Entry>()

// In the background, a slice runs only when the page is idle. Once the reveal is open and waiting, slices run between
// frames instead: each is a few milliseconds, so the animation keeps its frames and the odds land within a second.
const next = (e: Entry, f: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (!e.urgent && w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 250 })
  else window.setTimeout(f, e.urgent ? 0 : 16)
}

/** Start (or find) the odds for a recap. Null when the league has no season model to simulate with. */
export const revealOdds = (source: RevealSource, data: LeagueData, analysis: Analysis, models: Models): Entry | null => {
  const f = models.forecast
  if (!f) return null
  const hit = cache.get(source.recap)
  if (hit) return hit
  const rosterIds = analysis.teams.map((t) => t.rosterId)
  const runs = recapOddsRuns({
    recap: source.recap,
    priorWeeks: source.priorWeeks,
    matchupsByWeek: source.matchupsByWeek,
    slots: analysis.slots,
    players: data.players,
    rosterIds,
    forecast: f,
    schedule: models.forecastInput.schedule,
    playoffWeeks: models.forecastInput.playoffWeeks,
    playoffTeams: models.forecastInput.playoffTeams,
    divisions: models.forecastInput.divisions,
    weeksLeft: data.futureWeeks.filter((w) => w > source.recap.week).length,
  })
  const slices = Math.ceil(RECAP_SIMS / RECAP_SLICE)
  const before: Record<number, SimTeam>[] = []
  const after: Record<number, SimTeam>[] = []
  const entry = { value: null, urgent: false } as Entry
  entry.done = new Promise((resolve) => {
    // Each turn runs slices for about 6ms, always at least one, then waits for the next turn.
    const step = () => {
      const t0 = performance.now()
      do {
        const k = after.length
        if (before.length === k) before.push(runs.before(k, RECAP_SLICE))
        else after.push(runs.after(k, RECAP_SLICE))
      } while (after.length < slices && performance.now() - t0 < 6)
      if (after.length < slices) return next(entry, step)
      entry.value = joinOdds(rosterIds, mergeSims(before), mergeSims(after))
      resolve(entry.value)
    }
    next(entry, step)
  })
  cache.set(source.recap, entry)
  return entry
}

/** The odds for the reveal on screen: null until they land. */
export const useRevealOdds = (source: RevealSource, data: LeagueData, analysis: Analysis, models: Models) => {
  const [odds, setOdds] = useState<Record<number, Odds> | null>(() => cache.get(source.recap)?.value ?? null)
  useEffect(() => {
    const e = revealOdds(source, data, analysis, models)
    if (!e) return
    if (e.value) return setOdds(e.value)
    e.urgent = true
    let live = true
    e.done.then((v) => live && setOdds(v))
    return () => {
      live = false
    }
  }, [source, data, analysis, models])
  return odds
}
