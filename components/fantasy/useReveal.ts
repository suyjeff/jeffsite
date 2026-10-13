import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Models } from '../../lib/fantasy/models'
import type { PowerWeights } from '../../lib/fantasy/power'
import { buildRecap, revealSeenKey, revealStale, revealState, weeksBefore, type Recap } from '../../lib/fantasy/recap'
import type { SleeperMatchup } from '../../lib/fantasy/types'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import { revealOdds } from './revealOdds'
import { playerValues, replacementLevels, rosterStrength, type ModelConfig } from '../../lib/fantasy/war'

/** What the reveal reads: the recap, and the weeks it was built from (the playoff odds rerun on them). */
export type RevealSource = {
  recap: Recap
  priorWeeks: number[]
  matchupsByWeek: Record<number, SleeperMatchup[]>
}

/** A reveal on screen. `run` is bumped to play it again from the start. */
export type RevealOpen = { run: number }

const playoffStartOf = (data: LeagueData) => Number(data.league.settings?.playoff_week_start ?? 15)

/** Each player's pre-game projection for a week: the one kept for a settled week, else the live one. */
export const weekProjections = (data: LeagueData, week: number) =>
  data.pastProjections[week] ?? (data.projectionWeek === week ? data.projections : null) ?? data.horizon.find((h) => h.week === week)?.pts ?? null

/**
 * Roster strength going into a week: each roster as it was set for that week, its players valued on the weeks
 * before it, the same way the analysis values them today. Null when the player model reads another season.
 */
const strengthGoingInto = (data: LeagueData, analysis: Analysis, model: ModelConfig, week: number) => {
  if (data.valueSeason !== data.league.season) return null
  const weeks = data.valueWeeks.filter((w) => w < week)
  if (!weeks.length) return null
  const positions = data.league.roster_positions ?? []
  const levels = replacementLevels(data.weekPoints, weeks, data.players, positions, data.league.total_rosters || analysis.teams.length, model.benchFactor)
  const values = playerValues(data.weekPoints, weeks, data.players, levels, analysis.sigma, model)
  const out: Record<number, number> = {}
  for (const t of analysis.teams) {
    const set = data.matchupsByWeek[week]?.find((m) => m.roster_id === t.rosterId)?.players
    out[t.rosterId] = rosterStrength(analysis.slots, set?.length ? set : t.players, data.players, values)
  }
  return out
}

// Strength going into a week reads only the league, the rosters and the player model, never the power weights, and
// it is the costly part (every player valued again). Kept per league load, so a weight slider's every tick re-ranks
// without revaluing anyone.
const strengthCache = new WeakMap<LeagueData, Map<string, { teams: Analysis['teams']; value: Record<number, number> | null }>>()
const strengthBefore = (data: LeagueData, analysis: Analysis, model: ModelConfig, week: number) => {
  const byKey = strengthCache.get(data) ?? new Map()
  strengthCache.set(data, byKey)
  const key = `${week}:${model.benchFactor}:${model.halfLife}:${model.riskAversion}`
  const hit = byKey.get(key)
  if (hit && hit.teams === analysis.teams) return hit.value
  const value = strengthGoingInto(data, analysis, model, week)
  byKey.set(key, { teams: analysis.teams, value })
  return value
}

/** The recap for a week, from the league's matchups. */
export const recapSource = (data: LeagueData, analysis: Analysis, models: Models, prefs: { weights: PowerWeights; model: ModelConfig }, week: number): RevealSource => {
  const { weights } = prefs
  const matchupsByWeek = data.matchupsByWeek
  const priorWeeks = weeksBefore(matchupsByWeek, week, playoffStartOf(data))
  const expected: Record<number, number> = {}
  for (const t of analysis.teams) {
    const e = models.expectedPast[t.rosterId]?.[week]
    if (e != null) expected[t.rosterId] = e
  }
  const recap = buildRecap({
    week,
    priorWeeks,
    matchupsByWeek,
    slots: analysis.slots,
    players: data.players,
    rosterIds: analysis.teams.map((t) => t.rosterId),
    strength: analysis.strength,
    strengthBefore: strengthBefore(data, analysis, prefs.model, week),
    weights,
    sigma: analysis.sigma,
    proj: weekProjections(data, week),
    expected,
  })
  return { recap, priorWeeks, matchupsByWeek }
}

const readSeen = (key: string) => {
  try {
    return window.localStorage.getItem(key) != null
  } catch {
    // Storage blocked: count it seen, rather than show it on every load.
    return true
  }
}
const writeSeen = (key: string) => {
  try {
    window.localStorage.setItem(key, String(Date.now()))
  } catch {
    // ignore
  }
}

/** The time, read again every `ms` while `on`: for a banner's countdown, so only the banner re-renders. */
export const useNow = (ms = 30000, on = true) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms, on])
  return now
}

/**
 * The weekly reveal: which week it shows, which is on its way, and opening it. A week unlocks at 6:00 AM Eastern on
 * the Tuesday after its last game (lib/fantasy/recap revealGate), for everyone at once. From then it opens by itself
 * once per league per week, on the first load, whatever page is open, unless something else (onboarding, the tour) has
 * the screen or the next week has already kicked off. Before then nothing about that week is built: the banners only
 * say when it drops. `?reveal=1` in the address replays the latest unlocked week.
 */
export const useReveal = ({
  data,
  analysis,
  models,
  prefs,
  blocked,
  quiet,
}: {
  data: LeagueData | null
  analysis: Analysis | null
  models: Models | null
  prefs: { weights: PowerWeights; model: ModelConfig } | null
  blocked: boolean
  /** Count this week's reveal seen without showing it (a first visit, which has had the tour instead). */
  quiet?: boolean
}) => {
  // The page's own clock moves rarely: every five minutes (a week can start between reloads) and once at the gate
  // (below), so the whole page does not re-render on a countdown's beat.
  const now = useNow(5 * 60_000)
  const [gateTick, setGateTick] = useState(0)
  const state = useMemo(() => {
    if (!data) return { revealed: null, pending: null }
    return revealState({
      regularWeeks: data.regularWeeks,
      matchupsByWeek: data.matchupsByWeek,
      games: data.schedule?.games,
      week: data.state.week,
      playoffStart: playoffStartOf(data),
      current: data.league.season === data.state.season && data.state.season_type === 'regular',
      now: Math.max(now, gateTick),
    })
  }, [data, now, gateTick])
  const week = state.revealed
  const pendingWeek = state.pending?.week ?? null
  const pendingGate = state.pending?.gate.getTime() ?? null
  const pending = useMemo(() => (pendingWeek != null && pendingGate != null ? { week: pendingWeek, gate: new Date(pendingGate) } : null), [pendingWeek, pendingGate])

  // Wake exactly when the pending week unlocks, so it opens at 6 AM ET without waiting for the next five-minute read.
  useEffect(() => {
    if (pendingGate == null) return
    const wait = pendingGate - Date.now() + 500
    if (wait <= 0 || wait > 2 ** 31 - 1) return
    const id = window.setTimeout(() => setGateTick(Date.now()), wait)
    return () => window.clearTimeout(id)
  }, [pendingGate])

  const source = useMemo(() => (data && analysis && models && prefs && week != null ? recapSource(data, analysis, models, prefs, week) : null), [data, analysis, models, prefs, week])

  // Start the reveal's playoff simulation in idle time once the page has settled, so it is ready before it opens.
  useEffect(() => {
    if (!source || !data || !analysis || !models) return
    const id = window.setTimeout(() => revealOdds(source, data, analysis, models), 1500)
    return () => window.clearTimeout(id)
  }, [source, data, analysis, models])

  const [open, setOpen] = useState<RevealOpen | null>(null)
  const show = useCallback(() => setOpen((o) => ({ run: (o?.run ?? 0) + 1 })), [])
  const close = useCallback(() => setOpen(null), [])

  const leagueId = data?.league.league_id
  const season = data?.league.season

  // `?reveal=1`: replay the latest unlocked week, once, then clear the parameter so a reload does not repeat it.
  useEffect(() => {
    if (!source || blocked) return
    const q = new URLSearchParams(window.location.search)
    if (q.get('reveal') == null) return
    q.delete('reveal')
    const rest = q.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    show()
  }, [source, blocked, show])

  // On its own: the first load after the gate, once per league and week. Marked seen as it opens, so a reload
  // halfway through never plays it twice.
  useEffect(() => {
    if (!source || blocked || !leagueId || !season || week == null || !data) return
    if (data.league.season !== data.state.season) return
    const key = revealSeenKey(leagueId, season, week)
    if (readSeen(key)) return
    // A week whose successor has already kicked off is old news: no surprise for it, only the replay.
    const stale = revealStale(data.schedule?.games, week)
    if (stale && Date.now() >= stale.getTime()) return
    writeSeen(key)
    if (!quiet) setOpen((o) => o ?? { run: 1 })
  }, [source, blocked, quiet, leagueId, season, week, data])

  return { week, source, pending, open, show, close }
}

export type RevealApi = ReturnType<typeof useReveal>
