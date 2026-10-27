import { useEffect, useMemo, useState } from 'react'
import { longPastByCalendar, readFeed } from '../../lib/fantasy/gameTime'
import type { Broadcast } from '../../lib/fantasy/nfl'
import type { Slate } from '../../lib/fantasy/slate'
import { getWeekActuals, type WeekActuals } from '../../lib/fantasy/sleeper'
import type { StatLine } from '../../lib/fantasy/types'
import { useFantasy } from './FantasyContext'
import { useBroadcasts, useLiveTick } from './useBroadcasts'
import { liveKey, useLiveWeekSnapshot } from './useLiveWeek'
import type { WeekState } from './ui'

// The week as it is being played, beside the week as it was expected: each player's game state, what he has
// scored, the clock where ESPN answers, and his box score from Sleeper's stats feed. Projections live in the slate;
// this is the other half, read only once a game of the week has kicked off.

/** One player's week as played so far, with what was expected of him. */
export type PlayerWeek = WeekState & {
  /** His box score, once his game has started and the feed has it. */
  line: StatLine | null
  /** His game: the opponent, where, and the score from his side when known. */
  game: { opp: string; home: boolean; us: number | null; them: number | null } | null
}

/** A scoreboard reading that is still current (lib/fantasy/gameTime): a feed gone quiet shows no clock or score. */
const fresh = (c: Broadcast | undefined, now: number) => (c?.state && c.at != null && readFeed({ state: c.state, at: c.at }, now) ? c : undefined)

// The week's stats when the live reads have none (a week outside the poll, another season's league): the cached load,
// one request per league and week whichever views ask at once.
const runs = new Map<string, Promise<WeekActuals | null>>()
const load = (leagueId: string, season: string, week: number, scoring: Record<string, number>, settled: boolean) => {
  const key = `${leagueId}:${season}:${week}:${settled}`
  let run = runs.get(key)
  if (!run) {
    run = getWeekActuals(leagueId, season, week, scoring, settled)
      .catch(() => null)
      .finally(() => runs.delete(key))
    runs.set(key, run)
  }
  return run
}

const n = (x?: number) => Math.round(x ?? 0)

/**
 * A box score as labelled parts, his main job first: Passing "18/27, 245 yd, 2 TD, 1 INT", Rushing "4 car, 22 yd".
 * Empty when he has nothing on the sheet.
 */
export const boxParts = (s: StatLine | null | undefined, pos: string): { label: string; text: string }[] => {
  if (!s) return []
  const td = (x?: number) => (x ? `, ${n(x)} TD` : '')
  if (pos === 'DEF') {
    const take = n(s.int) + n(s.fum_rec)
    const tds = n((s.def_td ?? 0) + (s.def_st_td ?? 0))
    return [
      { label: 'Allowed', text: `${n(s.pts_allow)} pts${s.yds_allow ? `, ${n(s.yds_allow)} yd` : ''}` },
      { label: 'Defense', text: [`${n(s.sack)} sk`, take && `${take} TO`, tds && `${tds} TD`, s.safe && `${n(s.safe)} safety`].filter(Boolean).join(', ') },
    ]
  }
  if (pos === 'K') {
    const out: { label: string; text: string }[] = []
    if (s.fga || s.fgm) out.push({ label: 'Field goals', text: `${n(s.fgm)}/${n(s.fga)}${s.fgm_lng ? `, long ${n(s.fgm_lng)}` : ''}` })
    if (s.xpa || s.xpm) out.push({ label: 'Extra points', text: `${n(s.xpm)}/${n(s.xpa)}` })
    return out
  }
  const pass = s.pass_att ? { label: 'Passing', text: `${n(s.pass_cmp)}/${n(s.pass_att)}, ${n(s.pass_yd)} yd${td(s.pass_td)}${s.pass_int ? `, ${n(s.pass_int)} INT` : ''}` } : null
  const rush = s.rush_att ? { label: 'Rushing', text: `${n(s.rush_att)} car, ${n(s.rush_yd)} yd${td(s.rush_td)}` } : null
  const rec = s.rec || s.rec_tgt ? { label: 'Receiving', text: `${n(s.rec)}/${n(s.rec_tgt)} rec, ${n(s.rec_yd)} yd${td(s.rec_td)}` } : null
  const idp =
    s.idp_tkl || s.idp_sack || s.idp_int
      ? { label: 'Defense', text: [s.idp_tkl && `${n(s.idp_tkl)} tkl`, s.idp_sack && `${s.idp_sack} sk`, s.idp_int && `${n(s.idp_int)} INT`].filter(Boolean).join(', ') }
      : null
  const order = pos === 'QB' ? [pass, rush, rec] : pos === 'RB' ? [rush, rec, pass] : [rec, rush, pass]
  const out = [...order, idp].filter((x): x is { label: string; text: string } => !!x)
  if (s.fum_lost) out.push({ label: 'Fumbles', text: `${n(s.fum_lost)} lost` })
  return out
}

/** The same box score on one line, for a table row: "18/27, 245 yd, 2 TD · 4 car, 22 yd". */
export const boxScore = (s: StatLine | null | undefined, pos: string): string[] =>
  boxParts(s, pos).map((p) => (p.label === 'Allowed' ? `allowed ${p.text}` : p.label === 'Fumbles' ? `${p.text.replace(' lost', '')} fum lost` : pos === 'K' ? `${p.text.replace(/, long.*/, '')} ${p.label === 'Field goals' ? 'FG' : 'XP'}` : p.text))

/**
 * The week as played, for a slate already built (lib/fantasy/slate). `of(id)` reads any player, rostered or not:
 * a starter's points are his matchup's as the league scores them, anyone else's are his stat line in the league's
 * scoring. Null for a player with no game this week.
 */
export const useWeekNow = (slate: Slate, proj: Record<string, number>) => {
  const { data } = useFantasy()
  const { league, players } = data
  const started = slate.games.some((g) => g.final || g.live)
  const week = started ? slate.week : null
  // The box scores come from the week's live reads (useLiveWeek), which the slate keeps current: read each minute
  // while a game is on, again on Reload, and kept for a day once the week settles. The clock is read on the same poll.
  const fromLive = useLiveWeekSnapshot(week != null ? liveKey(league.league_id, league.season, week) : null)?.actuals?.data ?? null
  // Outside the live reads, the cached load: kept for a day once Sleeper calls every game complete (or the calendar
  // is a day past them all), else a short-lived copy.
  const settled = slate.games.length > 0 && slate.games.every((g) => g.status === 'complete' || (g.final && longPastByCalendar(g.date)))
  const [loaded, setLoaded] = useState<WeekActuals | null>(null)
  useEffect(() => {
    if (week == null || fromLive) return
    let current = true
    load(league.league_id, league.season, week, league.scoring_settings ?? {}, settled).then((x) => current && x && setLoaded(x))
    return () => {
      current = false
    }
  }, [league.league_id, league.season, league.scoring_settings, week, settled, !!fromLive]) // eslint-disable-line react-hooks/exhaustive-deps
  const actuals = fromLive ?? (week != null ? loaded : null)
  const tick = useLiveTick(slate.games.some((g) => g.live))
  const casts = useBroadcasts(league.season, week, tick)

  return useMemo(() => {
    const gameOf: Record<string, Slate['games'][number]> = {}
    for (const g of slate.games) gameOf[g.home] = gameOf[g.away] = g
    /** A game's clock while it is under way, when ESPN answers. */
    const now = Date.now()
    const clockOf = (g: { away: string; home: string }) => fresh(casts[`${g.away}@${g.home}`], now)?.clock ?? null
    /** The score of a game from one side: ESPN's once it has started, else Sleeper's, from each defense's points allowed. */
    const scoreOf = (team: string) => {
      const g = gameOf[team]
      if (!g || !(g.final || g.live)) return null
      const home = g.home === team
      const opp = home ? g.away : g.home
      const cast = fresh(casts[`${g.away}@${g.home}`], now)
      const espn = cast && (cast.state === 'in' || cast.state === 'post') && cast.home != null && cast.away != null
      const us = espn ? (home ? cast!.home! : cast!.away!) : (actuals?.lines[opp]?.pts_allow ?? null)
      const them = espn ? (home ? cast!.away! : cast!.home!) : (actuals?.lines[team]?.pts_allow ?? null)
      return { us, them }
    }
    const of = (id: string): PlayerWeek | null => {
      const p = players[id]
      const team = p?.team
      const g = team ? gameOf[team] : undefined
      if (!p || !team || !g) return null
      const sp = slate.byId[id]
      const expected = sp?.proj ?? proj[id] ?? 0
      const home = g.home === team
      const score = scoreOf(team)
      const game = { opp: home ? g.away : g.home, home, us: score?.us ?? null, them: score?.them ?? null }
      const state = slate.teamState[team]
      if (state !== 'final' && state !== 'live') return { kind: 'proj', value: expected, proj: expected, line: null, game }
      const line = actuals?.lines[id] ?? null
      const value = sp?.actual ?? sp?.live ?? actuals?.pts[id] ?? 0
      if (state === 'final') return { kind: 'final', value, proj: expected, line, game }
      // Where he is heading is the slate's own expectation (the same the win odds use), shown once the clock is known;
      // without it the slate assumes halftime, which is no reading worth showing.
      const elapsed = fresh(casts[`${g.away}@${g.home}`], now)?.elapsed
      const heading = elapsed != null ? (sp?.live != null ? sp.expect : value + expected * (1 - elapsed)) : null
      return { kind: 'live', value, proj: expected, clock: clockOf(g), heading, line, game }
    }
    return { started, of, clockOf, scoreFor: scoreOf, hasLines: !!actuals }
  }, [slate, proj, players, casts, actuals, started])
}

export type WeekNow = ReturnType<typeof useWeekNow>
