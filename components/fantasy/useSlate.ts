import { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import { weekStakes, type Forecast, type ForecastInput, type Stakes } from '../../lib/fantasy/forecast'
import { buildSlate, positionCV } from '../../lib/fantasy/slate'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { impliedTotals } from '../../lib/fantasy/waivers'
import { useFantasy } from './FantasyContext'
import { useStatLines } from './useStatLines'

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
  const cv = useMemo(() => positionCV(data.weekPoints, data.valueWeeks, players), [data.weekPoints, data.valueWeeks, players])
  const lines = useStatLines(data.league.season, live ? [week] : [])
  const totals = useMemo(
    () => impliedTotals({ week, schedule: data.schedule, statLines: lines[week] ?? null, market: data.market, players }),
    [week, data.schedule, lines, data.market, players],
  )

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

  const lineups = useMemo(() => {
    const out: Record<number, string[]> = {}
    if (data.horizon[0]?.week !== week) return out
    for (const t of analysis.teams) out[t.rosterId] = (analysis.needs[t.rosterId]?.slots.map((s) => s.starter).filter(Boolean) as string[]) ?? []
    return out
  }, [analysis, data.horizon, week])

  const slate = useMemo(
    () =>
      buildSlate({
        week,
        games: data.schedule?.games ?? [],
        players,
        matchups: data.matchupsByWeek[week] ?? [],
        lineups,
        proj,
        cv,
        sigma: models.forecast?.sigma ?? models.forecastInput.sigmaFallback,
        totals,
        stakes,
      }),
    [week, data.schedule, players, data.matchupsByWeek, lineups, proj, cv, models, totals, stakes],
  )

  return { slate, live, week, proj, totals }
}
