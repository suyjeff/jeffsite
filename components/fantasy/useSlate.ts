import { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { weekStakes, type Forecast, type ForecastInput, type Stakes } from '../../lib/fantasy/forecast'
import { buildSlate, positionCV, type Slate } from '../../lib/fantasy/slate'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { impliedTotals, type TeamTotal } from '../../lib/fantasy/waivers'
import { calendarSig, endsFrom, feedFrom, freshGames, freshMatchups, nextWindow, pendingSettle, shouldPoll, weekGames, weekOn, weekSettled } from '../../lib/fantasy/liveWeek'
import { useFantasy } from './FantasyContext'
import { useBroadcasts, useHourTick, useLiveTick } from './useBroadcasts'
import { liveKey, recordEnds, stickySettled, useLiveWeekRefresh, useLiveWeekSnapshot } from './useLiveWeek'
import { useStatLines } from './useStatLines'

// Most views ask for the slate (the dashboard alone, several times over): it is built once per load and set of
// inputs, and every caller reads the same one. Keyed by the league data, so a reload starts fresh.
type Built = { deps: unknown[]; slate: Slate; totals: Record<string, TeamTotal> }
const built = new WeakMap<LeagueData, Built>()
const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

// The stakes simulation runs once per forecast, whichever view asks first: one shared run, a game at a time,
// yielding to the page between games so a dozen matchups never lock the main thread in one long task. Each side of
// a game is the forecast's own seasons with that result locked, so a win and a loss bracket the odds shown everywhere.
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
        Object.assign(out, weekStakes(input, { ...f, nextWeek: [g] }))
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

  // This week's projections: Sleeper's, in league scoring (the model's horizon only if Sleeper has none for the week).
  const proj = useMemo(() => {
    if (data.projections && data.projectionWeek === week) return data.projections
    return data.projectionsByWeek[week] ?? data.horizon.find((h) => h.week === week)?.pts ?? {}
  }, [data.projections, data.projectionWeek, data.projectionsByWeek, data.horizon, week])
  const lines = useStatLines(data.league.season, live ? [week] : [])
  const statLines = lines[week] ?? null
  // The week as it is being played. The page's copy of the matchups and schedule is read again on the live poll, with
  // ESPN's scoreboard for each game's state and clock; lib/fantasy/liveWeek says when to ask and what to believe.
  const now = Date.now()
  const hour = useHourTick()
  const leagueId = data.league.league_id
  const key = live ? liveKey(leagueId, data.league.season, week) : null
  const snap = useLiveWeekSnapshot(key)
  const games = useMemo(() => freshGames(weekGames(data.schedule?.games, week), snap?.games?.games ?? null), [data.schedule, week, snap?.games])
  const on = live && weekOn(games, {}, now)
  // Polling follows the games: under way by ESPN or Sleeper, in a kickoff window, or over with points read before the
  // end. A render behind, since the scoreboard it reads is itself read on the poll; a timer wakes it for the next
  // kickoff window.
  const [playing, setPlaying] = useState(false)
  const [wakeAt, setWakeAt] = useState<number | null>(null)
  const tick = useLiveTick(playing, wakeAt)
  const casts = useBroadcasts(data.league.season, on ? week : null, tick)
  // Each game's end as first seen, kept for the week (useLiveWeek), and whether the week has settled, for good.
  const ends = recordEnds(key, endsFrom(casts))
  const settled = stickySettled(key, weekSettled(games, ends, now))
  // The page's copy of the matchups may be minutes old from its cache: it counts as read before any end, so a game
  // over settles on a live read.
  const points = freshMatchups(data.matchupsByWeek[week] ?? [], snap?.matchups ?? null, 0)
  const actuals = snap?.actuals ? { pts: snap.actuals.data.pts, at: snap.actuals.at } : null
  const pointsAt = Math.max(points.at, actuals?.at ?? 0)
  const poll = on && (shouldPoll(games, casts, now) || pendingSettle(casts, pointsAt, now))
  const wake = on ? nextWindow(games, casts, now) : null
  useEffect(() => setPlaying(poll), [poll])
  useEffect(() => setWakeAt(wake), [wake])
  useLiveWeekRefresh(
    key ? { leagueId, season: data.league.season, week, scoring: data.league.scoring_settings ?? {}, sleeper: data.provider !== 'espn', settled } : null,
    poll,
    tick,
    data,
  )
  const clock = feedFrom(casts, now)
  const cal = calendarSig(games, now)

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
    const deps = [analysis, models, stakes, statLines, proj, clock.sig, cal, points.at, snap?.games?.at, actuals?.at, hour]
    const hit = built.get(data)
    if (hit && sameDeps(hit.deps, deps)) return hit
    const lineups: Record<number, string[]> = {}
    if (data.horizon[0]?.week === week)
      for (const t of analysis.teams) lineups[t.rosterId] = (analysis.needs[t.rosterId]?.slots.map((s) => s.starter).filter(Boolean) as string[]) ?? []
    const totals = impliedTotals({ week, schedule: data.schedule, statLines, market: data.market, players })
    const slate = buildSlate({
      week,
      games,
      players,
      matchups: points.matchups,
      lineups,
      proj,
      cv: positionCV(data.weekPoints, data.valueWeeks, players),
      sigma: models.forecast?.sigma ?? models.forecastInput.sigmaFallback,
      totals,
      stakes,
      elapsed: clock.elapsed,
      feed: clock.feed,
      pointsAt: points.at,
      actuals,
      now,
    })
    const out = { deps, slate, totals }
    built.set(data, out)
    return out
  }, [data, analysis, models, stakes, statLines, proj, week, players, clock.sig, cal, points.at, snap?.games?.at, actuals?.at, hour]) // eslint-disable-line react-hooks/exhaustive-deps

  return { slate, live, week, proj, totals, settled }
}
