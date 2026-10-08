// Why a team is good or bad, in the few facts that explain most of it.
//
// Each fact is measured in points per week where it can be (so they rank
// against each other), and only the ones big enough to matter are kept:
//
//   Position groups  The lineup ahead, slot by slot, against the league's
//                    average lineup. A room two points a week better than
//                    average at each of two slots is a four-point strength.
//   Lineup calls     Points scored per point of the best projected lineup,
//                    against the league's rate, applied to this lineup.
//   Injuries         Points a week the expected absences cost the lineup ahead.
//   Luck             Wins against what the team's scores would earn if it
//                    played every team every week (all-play).
//   Schedule         How tough the remaining opponents are, by power score.

import type { Analysis } from './analysis'
import type { Models } from './models'
import { makeHorizonEval } from './trades'
import type { LeagueData } from './useLeagueData'

export type ScoutFact = {
  key: string
  /** Short heading: "RB room", "Luck". */
  label: string
  /** Signed size, in `unit`. */
  value: number
  unit: '/wk' | 'wins' | 'rank'
  /** One line of evidence: who, or against what. */
  detail: string
  /** Points-per-week equivalent, for ranking facts of different units together. */
  weight: number
}

export type Scouting = { strengths: ScoutFact[]; weaknesses: ScoutFact[]; summary: string | null }

/** How much each kind of fact must move the needle before it is worth a line. */
const MIN = { slot: 0.75, efficiency: 1, injury: 1.5, luck: 0.6 }
/** A win is worth roughly this many points a week over a season, for ranking luck beside points. */
const PTS_PER_WIN = 4

/** The surname, skipping a generational suffix: Marvin Harrison Jr. → Harrison. */
export const surname = (full: string) => {
  const parts = full.split(' ').filter(Boolean)
  while (parts.length > 1 && /^(jr|sr|ii|iii|iv|v)\.?$/i.test(parts[parts.length - 1])) parts.pop()
  return parts[parts.length - 1] ?? full
}

/**
 * Points a week a lineup gains or loses from what the adjusted horizon prices
 * in beyond Sleeper's own projection: expected absences, plus the work that
 * passes to a player when a teammate is out. Your own reads apply to both
 * sides, so they cancel.
 */
const dragCache = new WeakMap<Analysis, Map<string, number>>()
export const availabilityDrag = (data: LeagueData, analysis: Analysis, ids: string[]) => {
  if (!data.horizon.length || !data.rawHorizon.length) return 0
  // Solved once per analysis and roster: My team's headline and its scouting report read the same number.
  let byRoster = dragCache.get(analysis)
  if (!byRoster) dragCache.set(analysis, (byRoster = new Map()))
  const key = [...ids].sort().join(',')
  const hit = byRoster.get(key)
  if (hit !== undefined) return hit
  const raw = makeHorizonEval(analysis.slots, data.players, data.rawHorizon, analysis.horizonReplacement).total(ids)
  const adjusted = makeHorizonEval(analysis.slots, data.players, data.horizon, analysis.horizonReplacement).total(ids)
  byRoster.set(key, adjusted - raw)
  return adjusted - raw
}

const GROUP: Record<string, string> = { SUPER_FLEX: 'Superflex', FLEX: 'Flex', REC_FLEX: 'Flex', WRRB_FLEX: 'Flex' }

export const scoutTeam = (data: LeagueData, analysis: Analysis, models: Models, rosterId: number): Scouting => {
  const facts: ScoutFact[] = []
  const players = data.players
  const name = (id: string | null) => (id ? (players[id] ? surname(players[id].name) : id) : 'waiver fill')

  // Position groups, from the lineup ahead.
  const need = analysis.needs[rosterId]
  if (need) {
    const groups = new Map<string, { gap: number; starters: string[] }>()
    for (const s of need.slots) {
      const g = GROUP[s.slot] ?? s.slot
      const cur = groups.get(g) ?? { gap: 0, starters: [] }
      cur.gap += s.gap
      cur.starters.push(name(s.starter))
      groups.set(g, cur)
    }
    for (const [g, v] of groups) {
      if (Math.abs(v.gap) < MIN.slot) continue
      facts.push({
        key: `pos:${g}`,
        label: g === 'DEF' ? 'Defense' : g === 'K' ? 'Kicker' : g === 'Flex' || g === 'Superflex' ? g : `${g} room`,
        value: v.gap,
        unit: '/wk',
        detail: v.starters.join(', '),
        weight: Math.abs(v.gap),
      })
    }
  }

  // Lineup calls, against the league's own rate.
  const rating = models.forecast?.byId[rosterId]
  if (rating && models.forecast) {
    const edge = (rating.efficiency - models.forecast.leagueEff) * rating.projected
    if (Math.abs(edge) >= MIN.efficiency) {
      facts.push({
        key: 'efficiency',
        label: 'Lineup calls',
        value: edge,
        unit: '/wk',
        detail: `scores ${Math.round(rating.efficiency * 100)}% of the projected best lineup, league ${Math.round(models.forecast.leagueEff * 100)}%`,
        weight: Math.abs(edge),
      })
    }
  }

  // Availability ahead: expected absences, net of work passed on from injured teammates.
  const team = analysis.teamById[rosterId]
  if (team) {
    const drag = availabilityDrag(data, analysis, team.players)
    if (Math.abs(drag) >= MIN.injury) {
      const key = drag < 0 ? 'lost' : 'gained'
      const who = team.players
        .filter((id) => (data.context[id]?.[key] ?? 0) >= 0.5)
        .sort((a, b) => (data.context[b]?.[key] ?? 0) - (data.context[a]?.[key] ?? 0))
        .slice(0, 3)
      // The rooms above are measured after this, so it overlaps them rather than adding to them.
      facts.push({
        key: 'availability',
        label: drag < 0 ? 'Injuries' : 'Covering injuries',
        value: drag,
        unit: '/wk',
        detail: `${who.length ? who.map(name).join(', ') : drag < 0 ? 'expected absences' : 'teammates out'} · already in the rooms`,
        weight: Math.abs(drag),
      })
    }
  }

  // Luck: wins against what the scores earned.
  const season = analysis.seasonById[rosterId]
  if (season && season.games >= 2 && Math.abs(season.luck) >= MIN.luck) {
    facts.push({
      key: 'luck',
      label: 'Luck',
      value: season.luck,
      unit: 'wins',
      detail: `${season.wins}-${season.losses}${season.ties ? `-${season.ties}` : ''} on scores that earn ${season.expectedWins.toFixed(1)} wins against everyone`,
      weight: Math.abs(season.luck) * PTS_PER_WIN,
    })
  }

  // Schedule ahead, by remaining opponents' power.
  const sos = analysis.powerById[rosterId]?.sos
  if (sos != null) {
    const ranked = analysis.teams
      .map((t) => ({ id: t.rosterId, sos: analysis.powerById[t.rosterId]?.sos }))
      .filter((t): t is { id: number; sos: number } => t.sos != null)
      .sort((a, b) => b.sos - a.sos)
    const rank = ranked.findIndex((t) => t.id === rosterId) + 1
    const n = ranked.length
    if (n >= 6 && (rank <= 2 || rank > n - 2)) {
      const hard = rank <= 2
      facts.push({
        key: 'schedule',
        label: 'Schedule ahead',
        value: hard ? -rank : n + 1 - rank,
        unit: 'rank',
        detail: `${hard ? `${rank === 1 ? 'hardest' : '2nd hardest'}` : `${rank === n ? 'easiest' : '2nd easiest'}`} of ${n}`,
        weight: 1,
      })
    }
  }

  const strengths = facts.filter((f) => f.value > 0).sort((a, b) => b.weight - a.weight)
  const weaknesses = facts.filter((f) => f.value < 0).sort((a, b) => b.weight - a.weight)
  const signed = (x: number) => `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`
  // Mid-sentence: position rooms keep their abbreviation (RB), everything else reads as plain words.
  const phrase = (f: ScoutFact) => (f.key.startsWith('pos:') && /^[A-Z]{1,3}$/.test(f.key.slice(4)) ? f.key.slice(4) : f.label.toLowerCase())
  const lead = (f: ScoutFact | undefined) => {
    if (!f) return null
    if (f.key === 'luck') return `${f.value > 0 ? 'good' : 'bad'} luck (${signed(f.value)} wins)`
    if (f.key === 'schedule') return f.value > 0 ? 'an easy schedule ahead' : 'a hard schedule ahead'
    return `${phrase(f)} (${signed(f.value)}/wk)`
  }
  const s = lead(strengths[0])
  const w = lead(weaknesses[0])
  const summary = s && w ? `Built on ${s}; held back by ${w}.` : s ? `Built on ${s}, with no real hole.` : w ? `Held back by ${w}.` : null
  return { strengths, weaknesses, summary }
}
