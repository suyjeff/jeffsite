import { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { weekStakes, type Forecast, type ForecastInput, type Stakes } from '../../lib/fantasy/forecast'
import { buildSlate, positionCV, type Slate } from '../../lib/fantasy/slate'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { impliedTotals, type TeamTotal } from '../../lib/fantasy/waivers'
import { etDay, gameIsLive, pastByCalendar, type FeedState } from '../../lib/fantasy/gameTime'
import type { Broadcast } from '../../lib/fantasy/nfl'
import { useFantasy } from './FantasyContext'
import { useBroadcasts, useLiveTick } from './useBroadcasts'
import { useStatLines } from './useStatLines'

// Most views ask for the slate (the dashboard alone, several times over): it is built once per load and set of
// inputs, and every caller reads the same one. Keyed by the league data, so a reload starts fresh.
type Built = { deps: unknown[]; slate: Slate; totals: Record<string, TeamTotal> }
const built = new WeakMap<LeagueData, Built>()
const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/**
 * From ESPN's scoreboard: each game's state (pre, in, post), which overrides Sleeper's lagging status, and the share of
 * regulation played in each game under way. The key changes only when one of them does.
 */
const clockOf = (casts: Record<string, Broadcast>) => {
  const elapsed: Record<string, number> = {}
  const feed: Record<string, FeedState> = {}
  for (const [k, c] of Object.entries(casts)) {
    if (c.state) feed[k] = c.state
    if (c.state === 'in' && c.elapsed != null) elapsed[k] = c.elapsed
  }
  const sig = Object.keys(feed)
    .sort()
    .map((k) => `${k}:${feed[k]}${elapsed[k] != null ? `:${elapsed[k].toFixed(3)}` : ''}`)
    .join('|')
  return { elapsed, feed, sig }
}

// The stakes simulation runs once per forecast, whichever view asks first: one shared run, a game at a time,
// yielding to the page between games so a dozen matchups never lock the main thread in one long task.
const STAKES_SIMS = 1000
const stakesCache = new WeakMap<Forecast, Record<number, Stakes>>()
const stakesRuns = new WeakMap<Forecast, Promise<Record<number, Stakes>>>()
const pause = () => new Promise<void>((r) => window.setTimeout(r, 0))
const stakesFor = (input: ForecastInput, f: Forecast) => {
  let run = stakesRuns.get(f)
  if (!run) {
    run = (async () => {
      const out: Record<number, Stakes> = {}
      for (const g of f.nextWeek) {
        await pause()
        Object.assign(out, weekStakes(input, { ...f, nextWeek: [g] }, STAKES_SIMS))
      }
      stakesCache.set(f, out)
      return out
    })()
    stakesRuns.set(f, run)
  }
  return run
}

/** This week's slate for the league (lib/fantasy/slate), with what a win is worth simulated in the background. */
export const useSlate = (data: LeagueData, analysis: Analysis) => {
  const { models } = useFantasy()
  const players = data.players
  const live = data.state.season_type === 'regular' && data.league.season === data.state.season
  const week = data.state.week

  // This week's projections, in league scoring.
  const proj = useMemo(() => {
    if (data.projections && data.projectionWeek === week) return data.projections
    return data.horizon.find((h) => h.week === week)?.pts ?? {}
  }, [data.projections, data.projectionWeek, data.horizon, week])
  const lines = useStatLines(data.league.season, live ? [week] : [])
  const statLines = lines[week] ?? null
  // The clock of any game under way, so a player's expected finish counts the time actually left; read again each
  // minute while a game is on. Sleeper's status can lag a kickoff, so any game day with a game not yet over by the
  // calendar counts too: ESPN then says which games are on and which are over.
  const today = etDay(Date.now())
  const playing =
    live &&
    (data.schedule?.games ?? []).some(
      (g) => g.week === week && g.status !== 'canceled' && (gameIsLive(g, undefined) || (g.status !== 'complete' && !!g.date && g.date <= today && !pastByCalendar(g.date))),
    )
  const tick = useLiveTick(playing)
  const clock = clockOf(useBroadcasts(data.league.season, playing ? week : null, tick))

  // What a win is worth, simulated after the page has drawn.
  const [stakes, setStakes] = useState<Record<number, Stakes> | null>(() => (models.forecast ? (stakesCache.get(models.forecast) ?? null) : null))
  useEffect(() => {
    const f = models.forecast
    if (!f || f.nextWeek[0]?.week !== week) return setStakes(null)
    const hit = stakesCache.get(f)
    if (hit) return setStakes(hit)
    setStakes(null)
    let current = true
    stakesFor(models.forecastInput, f).then((x) => current && setStakes(x))
    return () => {
      current = false
    }
  }, [models, week])

  const { slate, totals } = useMemo(() => {
    const deps = [analysis, models, stakes, statLines, proj, clock.sig]
    const hit = built.get(data)
    if (hit && sameDeps(hit.deps, deps)) return hit
    const lineups: Record<number, string[]> = {}
    if (data.horizon[0]?.week === week)
      for (const t of analysis.teams) lineups[t.rosterId] = (analysis.needs[t.rosterId]?.slots.map((s) => s.starter).filter(Boolean) as string[]) ?? []
    const totals = impliedTotals({ week, schedule: data.schedule, statLines, market: data.market, players })
    const slate = buildSlate({
      week,
      games: data.schedule?.games ?? [],
      players,
      matchups: data.matchupsByWeek[week] ?? [],
      lineups,
      proj,
      cv: positionCV(data.weekPoints, data.valueWeeks, players),
      sigma: models.forecast?.sigma ?? models.forecastInput.sigmaFallback,
      totals,
      stakes,
      elapsed: clock.elapsed,
      feed: clock.feed,
    })
    const out = { deps, slate, totals }
    built.set(data, out)
    return out
  }, [data, analysis, models, stakes, statLines, proj, week, players, clock.sig]) // eslint-disable-line react-hooks/exhaustive-deps

  return { slate, live, week, proj, totals }
}
