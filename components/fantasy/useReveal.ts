import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Models } from '../../lib/fantasy/models'
import type { PowerWeights } from '../../lib/fantasy/power'
import { buildRecap, revealGate, revealSeenKey, revealWeek, weekFinal, weeksBefore, type Recap } from '../../lib/fantasy/recap'
import type { SleeperMatchup } from '../../lib/fantasy/types'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'

/**
 * A "Preview reveal (dev)" button beside the reveal banner that plays the current week now, estimated where it is
 * still being played. Temporary: set false (or delete the button) once the real Tuesday reveal has been seen live.
 */
export const REVEAL_DEV_PREVIEW = true

/** What the reveal reads: the recap, and the weeks it was built from (the playoff odds rerun on them). */
export type RevealSource = {
  recap: Recap
  priorWeeks: number[]
  matchupsByWeek: Record<number, SleeperMatchup[]>
}

/** What a reveal is showing: a week's real recap, or the dev preview of the week under way. */
export type RevealOpen = { preview: boolean; /** Bumped to play it again from the start. */ run: number }

const playoffStartOf = (data: LeagueData) => Number(data.league.settings?.playoff_week_start ?? 15)

/** Each player's pre-game projection for a week: the one kept for a settled week, else the live one. */
export const weekProjections = (data: LeagueData, week: number) =>
  data.pastProjections[week] ?? (data.projectionWeek === week ? data.projections : null) ?? data.horizon.find((h) => h.week === week)?.pts ?? null

/** The recap for a week, from the league's matchups (or a stand-in set of them, for the preview). */
export const recapSource = (
  data: LeagueData,
  analysis: Analysis,
  models: Models,
  weights: PowerWeights,
  week: number,
  opts: { matchups?: SleeperMatchup[]; estimated?: boolean } = {},
): RevealSource => {
  const matchupsByWeek = opts.matchups ? { ...data.matchupsByWeek, [week]: opts.matchups } : data.matchupsByWeek
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
    weights,
    sigma: analysis.sigma,
    proj: weekProjections(data, week),
    expected,
    estimated: opts.estimated,
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

/**
 * The weekly reveal: which week it is for, whether it is due, and opening it. It opens by itself once per league per
 * week, on the first load at or after Tuesday 6am following the week's last game, whatever page is open, unless
 * something else (onboarding, the tour) has the screen. `?reveal=1` in the address forces the real one; `?reveal=preview`
 * forces the dev preview.
 */
export const useReveal = ({
  data,
  analysis,
  models,
  weights,
  blocked,
}: {
  data: LeagueData | null
  analysis: Analysis | null
  models: Models | null
  weights: PowerWeights | null
  blocked: boolean
}) => {
  const week = useMemo(() => {
    if (!data || data.league.season !== data.state.season || data.state.season_type !== 'regular') {
      // A finished or past season still has its last week to replay.
      return data?.regularWeeks.length ? Math.max(...data.regularWeeks) : null
    }
    return revealWeek({ regularWeeks: data.regularWeeks, matchupsByWeek: data.matchupsByWeek, games: data.schedule?.games, week: data.state.week, playoffStart: playoffStartOf(data) })
  }, [data])

  const source = useMemo(() => (data && analysis && models && weights && week != null ? recapSource(data, analysis, models, weights, week) : null), [data, analysis, models, weights, week])

  // The week under way, for the dev preview: the current week while its games are being played.
  const previewWeek = useMemo(() => {
    if (!data || data.state.season_type !== 'regular' || data.league.season !== data.state.season) return null
    const w = data.state.week
    return w < playoffStartOf(data) && (data.matchupsByWeek[w] ?? []).length ? w : null
  }, [data])
  const previewEstimated = !!data && previewWeek != null && !weekFinal(data.schedule?.games, previewWeek)

  const [open, setOpen] = useState<RevealOpen | null>(null)
  const show = useCallback((preview = false) => setOpen((o) => ({ preview, run: (o?.run ?? 0) + 1 })), [])
  const close = useCallback(() => setOpen(null), [])

  const leagueId = data?.league.league_id
  const season = data?.league.season

  // Forced from the address, for testing: once, then the parameter is cleared so a reload does not repeat it.
  useEffect(() => {
    if (!source || blocked) return
    const q = new URLSearchParams(window.location.search)
    const v = q.get('reveal')
    if (v == null) return
    q.delete('reveal')
    const rest = q.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    show(v === 'preview' && REVEAL_DEV_PREVIEW)
  }, [source, blocked, show])

  // On its own: the first load after the gate, once per league and week. Marked seen as it opens, so a reload
  // halfway through never plays it twice.
  useEffect(() => {
    if (!source || blocked || !leagueId || !season || week == null || !data) return
    if (data.league.season !== data.state.season) return
    const key = revealSeenKey(leagueId, season, week)
    if (readSeen(key)) return
    const gate = revealGate(data.schedule?.games, week)
    if (gate && Date.now() < gate.getTime()) return
    writeSeen(key)
    setOpen((o) => o ?? { preview: false, run: 1 })
  }, [source, blocked, leagueId, season, week, data])

  return { week, source, open, show, close, preview: REVEAL_DEV_PREVIEW && previewWeek != null ? { week: previewWeek, estimated: previewEstimated } : null }
}

export type RevealApi = ReturnType<typeof useReveal>
