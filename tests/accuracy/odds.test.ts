// Live check of the playoff odds' consistency (npm run test:accuracy). Not part of the default suite: it loads the real
// leagues in leagues.json through the app's own pipeline (lib/fantasy/useLeagueData loadLeagueData, analyze,
// buildModels) and checks, on this week's real numbers, the invariants lib/fantasy/__tests__/oddsConsistency.test.ts
// proves on made-up ones:
//
//   one source   the playoff simulator untouched, and the reveal's after-odds for the latest settled week, equal the
//                forecast (models.forecast.sim) number for number
//   stakes       for every team playing this week, the odds with a loss <= the odds now <= the odds with a win
//   adds up      playoff odds sum to the playoff spots, seeds to one, clinched reads 100% and eliminated 0%
//   inputs       the forecast's records are the matchups' (ties and points for included), the weeks it counts are
//                the settled ones (Sleeper's last_scored_leg), and its schedule is exactly the weeks still to settle
import { beforeAll, describe, expect, it } from 'vitest'
import { analyze } from '../../lib/fantasy/analysis'
import { clinchStatus, simulateSeason, weekStakes } from '../../lib/fantasy/forecast'
import { buildModels, type Models } from '../../lib/fantasy/models'
import { simInputFor } from '../../lib/fantasy/playoffSim'
import { DEFAULT_POWER_WEIGHTS, buildTeamSeasons, buildTeamWeeks } from '../../lib/fantasy/power'
import { recapOdds, type Recap } from '../../lib/fantasy/recap'
import { loadLeagueData, type LeagueData } from '../../lib/fantasy/useLeagueData'
import { DEFAULT_MODEL } from '../../lib/fantasy/war'
import type { Analysis } from '../../lib/fantasy/analysis'
import config from './leagues.json'

const USERNAME = 'thejeffanator'
const loaded: Record<string, { data: LeagueData; analysis: Analysis; models: Models }> = {}

beforeAll(async () => {
  for (const l of config.leagues) {
    const data = await loadLeagueData({ provider: 'sleeper', username: USERNAME, leagueId: l.id })
    const analysis = analyze(data, DEFAULT_MODEL, DEFAULT_POWER_WEIGHTS)
    loaded[l.id] = { data, analysis, models: buildModels(data, analysis) }
  }
}, 300_000)

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe.each(config.leagues)('$name', ({ id }) => {
  it('counts the settled weeks and simulates exactly the rest', () => {
    const { data, models } = loaded[id]
    const input = models.forecastInput
    const lastScored = data.league.settings?.last_scored_leg
    if (typeof lastScored === 'number' && data.state.season_type === 'regular') expect(Math.max(0, ...data.regularWeeks)).toBeLessThanOrEqual(lastScored)
    // No week is both counted and simulated, and no week left to play is missing.
    const simulated = [...new Set(input.schedule.map((g) => g.week))]
    for (const w of simulated) expect(data.regularWeeks).not.toContain(w)
    expect(simulated.sort((a, b) => a - b)).toEqual(data.futureWeeks.filter((w) => (data.matchupsByWeek[w] ?? []).some((m) => m.matchup_id != null)))
    expect(input.weeksLeft).toBe(data.futureWeeks.length)
    // Records are the matchups' own, ties as half a win.
    const teamWeeks = buildTeamWeeks(data.matchupsByWeek, data.regularWeeks, input.slots, data.players)
    for (const s of buildTeamSeasons(Object.keys(input.record).map(Number), teamWeeks, data.regularWeeks, {})) {
      const r = input.record[s.rosterId]
      expect([r.wins, r.losses, r.ties]).toEqual([s.wins, s.losses, s.ties])
      expect(r.pf).toBeCloseTo(s.pf, 6)
    }
    // Divisions only when the league has them.
    const divs = Number(data.league.settings?.divisions ?? 0)
    expect(input.divisions == null).toBe(!(divs >= 2))
  })

  it('adds up, and reads settled races as settled', () => {
    const { data, models } = loaded[id]
    const f = models.forecast
    // In season with weeks left, the odds exist: every check below would otherwise pass on nothing.
    if (data.state.season_type === 'regular' && data.futureWeeks.length) expect(f).not.toBeNull()
    if (!f) return
    const input = models.forecastInput
    const ids = Object.keys(f.sim).map(Number)
    const n = ids.length
    const spots = Math.min(input.playoffTeams, n)
    expect(Math.abs(sum(ids.map((t) => f.sim[t].playoffs)) - spots)).toBeLessThanOrEqual(n * 0.0005)
    expect(Math.abs(sum(ids.map((t) => f.sim[t].title)) - 1)).toBeLessThanOrEqual(n * 0.0005)
    for (const t of ids) expect(Math.abs(sum(f.sim[t].seeds) - 1)).toBeLessThanOrEqual(n * 0.0005)
    const settled = clinchStatus(ids, input.record, input.schedule, spots, input.weeksLeft, input.divisions)
    for (const t of ids) {
      expect(f.sim[t].clinch).toBe(settled[t])
      if (settled[t] === 'in') expect(f.sim[t].playoffs).toBe(1)
      if (settled[t] === 'out') expect(f.sim[t].playoffs).toBe(0)
    }
  })

  it('shows one number everywhere: the simulator untouched and the reveal after the latest week are the forecast', () => {
    const { data, analysis, models } = loaded[id]
    const f = models.forecast
    if (!f) return
    expect(simulateSeason(simInputFor(models.forecastInput, f))).toEqual(f.sim)
    const week = Math.max(...data.regularWeeks)
    const ms = data.matchupsByWeek[week] ?? []
    const games = ms
      .filter((m) => m.matchup_id != null)
      .flatMap((m) => {
        const o = ms.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id)
        return o && m.roster_id < o.roster_id ? [{ a: m.roster_id, b: o.roster_id }] : []
      })
    const odds = recapOdds({
      recap: { week, games } as unknown as Recap,
      priorWeeks: data.regularWeeks.filter((w) => w < week),
      matchupsByWeek: data.matchupsByWeek,
      slots: analysis.slots,
      players: data.players,
      rosterIds: analysis.teams.map((t) => t.rosterId),
      forecast: f,
      schedule: models.forecastInput.schedule,
      weeksLeft: data.futureWeeks.filter((w) => w > week).length,
    })
    for (const t of analysis.teams) expect(odds[t.rosterId].after).toEqual(f.sim[t.rosterId])
  })

  it("brackets the odds with this week's stakes: a loss, now, a win", () => {
    const { models } = loaded[id]
    const f = models.forecast
    if (!f) return
    const stakes = weekStakes(models.forecastInput, f)
    for (const g of f.nextWeek)
      for (const t of [g.a, g.b]) {
        expect(stakes[t].loss.playoffs).toBeLessThanOrEqual(f.sim[t].playoffs)
        expect(f.sim[t].playoffs).toBeLessThanOrEqual(stakes[t].win.playoffs)
        expect(stakes[t].loss.bye!).toBeLessThanOrEqual(f.sim[t].bye)
        expect(f.sim[t].bye).toBeLessThanOrEqual(stakes[t].win.bye!)
      }
  })
})
