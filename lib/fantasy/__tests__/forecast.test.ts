import { describe, expect, it } from 'vitest'
import { acceptRead, leagueBehavior } from '../behavior'
import { matchConsensus, normName, parseCsv, perceivedValues, reduceConsensusCsv } from '../consensus'
import { deadStarters, startingSlots } from '../lineup'
import type { TeamWeek } from '../power'
import { backtest, bracketOrder, clinchStatus, eloWinProb, gamesFrom, managedPoints, persistMean, phi, preseasonElo, runElo, simulateSeason, ELO } from '../forecast'
import { applyAdjustments, liveAdjustments } from '../adjust'
import type { Analysis } from '../analysis'
import type { Models } from '../models'
import { scoutTeam, surname } from '../scout'
import { ATTACHMENT, starValue, tradeCurrency, tradeValue } from '../currency'
import type { TradeIdea } from '../trades'
import type { LeagueData } from '../useLeagueData'
import type { PlayerMap, SleeperTransaction } from '../types'

const P = (id: string, name: string, pos: string, team: string | null = null): PlayerMap[string] => ({ id, name, pos, fpos: [pos], team, status: null, injury: null, age: null, exp: null })

describe('phi', () => {
  it('is the standard normal CDF', () => {
    expect(phi(0)).toBeCloseTo(0.5, 6)
    expect(phi(1.96)).toBeCloseTo(0.975, 3)
    expect(phi(-1)).toBeCloseTo(0.1587, 3)
  })
})

describe('elo', () => {
  it('is zero-sum and moves the winner up', () => {
    const games = [{ week: 1, a: 1, b: 2, pa: 130, pb: 100 }]
    const run = runElo(games, [1, 2])
    expect(run.final[1] + run.final[2]).toBeCloseTo(2 * ELO.base, 6)
    expect(run.final[1]).toBeGreaterThan(ELO.base)
    expect(run.before[1][1]).toBe(ELO.base)
  })
  it('moves further on a blowout than a squeaker', () => {
    const close = runElo([{ week: 1, a: 1, b: 2, pa: 101, pb: 100 }], [1, 2]).final[1]
    const rout = runElo([{ week: 1, a: 1, b: 2, pa: 160, pb: 100 }], [1, 2]).final[1]
    expect(rout).toBeGreaterThan(close)
  })
  it('regresses last season a third of the way back', () => {
    expect(preseasonElo({ 1: 1590 })[1]).toBeCloseTo(1560)
    expect(eloWinProb(0)).toBe(0.5)
  })
})

describe('bracketOrder', () => {
  it('keeps the top seeds apart until the final', () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3])
  })
})

describe('simulateSeason', () => {
  const teams = [1, 2, 3, 4, 5, 6]
  const schedule = [5, 6, 7].flatMap((week) => [
    { week, a: 1, b: 2 },
    { week, a: 3, b: 4 },
    { week, a: 5, b: 6 },
  ])
  const record = Object.fromEntries(teams.map((t) => [t, { wins: 0, losses: 0, ties: 0, pf: 0 }]))
  const base = { teams, schedule, record, playoffWeeks: [15, 16], playoffTeams: 4, sigma: 20, tau: 0, sims: 3000 }
  it('gives identical teams identical odds', () => {
    const out = simulateSeason({ ...base, mean: () => 100 })
    for (const t of teams) {
      expect(out[t].playoffs).toBeCloseTo(4 / 6, 1)
      expect(out[t].title).toBeCloseTo(1 / 6, 1)
    }
    const seedSum = out[1].seeds.reduce((a, b) => a + b, 0)
    expect(seedSum).toBeCloseTo(1, 2)
  })
  it('favours the stronger team and is repeatable with a seed', () => {
    const mean = (t: number) => (t === 1 ? 140 : 100)
    const a = simulateSeason({ ...base, mean, seed: 5 })
    const b = simulateSeason({ ...base, mean, seed: 5 })
    expect(a[1].title).toBeGreaterThan(0.4)
    expect(a).toEqual(b)
  })
  it('counts both finalists in a two-team bracket', () => {
    const out = simulateSeason({ ...base, playoffTeams: 2, mean: () => 100 })
    const finals = teams.reduce((a, t) => a + out[t].final, 0)
    const titles = teams.reduce((a, t) => a + out[t].title, 0)
    expect(finals).toBeCloseTo(2, 2)
    expect(titles).toBeCloseTo(1, 2)
  })
  it('hands byes to the top seeds when the bracket is not a power of two', () => {
    const out = simulateSeason({ ...base, playoffTeams: 3, mean: (t: number) => 100 + t })
    const byes = teams.reduce((a, t) => a + out[t].bye, 0)
    expect(byes).toBeCloseTo(1, 2)
  })
})

describe('backtest', () => {
  const tw = (week: number, rosterId: number, points: number, opp: number, oppPts: number): TeamWeek => ({
    week,
    rosterId,
    points,
    opponentId: opp,
    opponentPoints: oppPts,
    result: points > oppPts ? 'W' : points < oppPts ? 'L' : 'T',
    optimalPoints: points + 5,
    starters: [],
    players: [],
    playersPoints: {},
  })
  const teamWeeks: Record<number, TeamWeek[]> = {}
  // Team 1 always scores 130, team 2 always 90.
  for (const w of [1, 2, 3, 4]) teamWeeks[w] = [tw(w, 1, 130, 2, 90), tw(w, 2, 90, 1, 130)]
  const ctx = { slots: startingSlots(['QB']), players: {}, floor: {}, sigma: 20, powerMargin: () => ({}) }
  it('never grades a model on a week it has seen', () => {
    const a = backtest([{ season: '2026', teamWeeks, weeks: [1, 2, 3, 4] }], ctx)
    const flipped = { ...teamWeeks, 4: [tw(4, 1, 50, 2, 160), tw(4, 2, 160, 1, 50)] }
    const b = backtest([{ season: '2026', teamWeeks: flipped, weeks: [1, 2, 3, 4] }], ctx)
    const w4 = (r: typeof a) => r.preds.find((p) => p.week === 4)!.p
    expect(w4(a)).toEqual(w4(b))
  })
  it('scores a consistent favourite better than a coin', () => {
    const r = backtest([{ season: '2026', teamWeeks, weeks: [1, 2, 3, 4] }], ctx)
    const ppg = r.scores.find((s) => s.model === 'ppg')!
    const coin = r.scores.find((s) => s.model === 'coin')!
    expect(ppg.brier).toBeLessThan(coin.brier)
    expect(coin.brier).toBeCloseTo(0.25)
    expect(gamesFrom(teamWeeks, [1])).toHaveLength(1)
  })
})

describe('consensus', () => {
  const csv = 'page_type,player,pos,team,ecr,sd,best,worst,scrape_date\n' +
    'redraft-overall,"Kenneth Walker III",RB,KC,5.5,2.1,3,9,2026-10-02\n' +
    'redraft-rb,"Kenneth Walker III",RB,KC,4,1,2,6,2026-10-02\n' +
    'weekly-rb,"Kenneth Walker III",RB,KC,3.6,1,1,5,2026-10-02\n' +
    'redraft-overall,Baltimore Ravens,DST,BAL,120,4,110,130,2026-10-02\n' +
    'dynasty-overall,"Kenneth Walker III",RB,KC,40,1,1,1,2026-10-02\n' +
    'redraft-overall,"Nobody, Jr.",WR,XXX,90,1,1,1,2026-10-02\n'
  const players: PlayerMap = { '1': P('1', 'Kenneth Walker', 'RB', 'KC'), BAL: P('BAL', 'Baltimore Ravens', 'DEF', 'BAL') }
  it('parses quoted CSV and drops pages it does not use', () => {
    expect(parseCsv('a,"b,c",d\n1,"x ""y""",3')[1]).toEqual(['1', 'x "y"', '3'])
    expect(reduceConsensusCsv(csv).map((r) => r.page)).not.toContain('dynasty-overall')
  })
  it('matches names across suffixes, and defenses by team', () => {
    expect(normName("Ja'Marr Chase Jr.")).toBe('jamarr chase')
    const c = matchConsensus(reduceConsensusCsv(csv), players)
    expect(c.byId['1']).toMatchObject({ rank: 5.5, posRank: 4, weekRank: 3.6, sd: 2.1 })
    expect(c.byId.BAL.rank).toBe(120)
    expect(c.unmatched).toBe(1)
  })
  it('prices consensus rank on the model’s own value curve', () => {
    const c = matchConsensus(reduceConsensusCsv(csv), players)
    const market = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`m${i}`, 200 - i]))
    const v = perceivedValues(c, market)
    expect(v['1']).toBeCloseTo((196 + 195) / 2)
  })
})

describe('behavior', () => {
  const tx = (type: string, adds: Record<string, number>, roster_ids: number[], leg = 3): SleeperTransaction => ({ type, status: 'complete', roster_ids, adds, drops: null, picks: 0, created: 0, leg })
  const players: PlayerMap = { a: P('a', 'A', 'RB'), b: P('b', 'B', 'WR'), c: P('c', 'C', 'WR') }
  const b = leagueBehavior({
    rosterIds: [1, 2, 3],
    season: '2026',
    transactions: [tx('free_agent', { x: 1 }, [1]), tx('waiver', { y: 1 }, [1]), tx('free_agent', { z: 2 }, [2]), tx('trade', { a: 1, b: 2, c: 2 }, [1, 2])],
    history: null,
    players,
    market: { a: 6, b: 2, c: 1 },
  })
  it('counts moves, trades, partners and shapes', () => {
    expect(b.teams[1].moves).toBe(2)
    expect(b.teams[3].engagement).toBe(0)
    expect(b.teams[1].engagement).toBe(1)
    expect(b.teams[1].partners[2]).toBe(1)
    expect(b.shapes['2-for-1']).toBe(1)
    expect(b.medianGap).toBe(3)
    expect(b.teams[2].bought.WR).toBe(2)
  })
  it('reads an offer as likelier when it helps them and comes from an active trader', () => {
    const idea = { partnerId: 1, give: ['g'], get: ['t'], theirGain: 1, valueAsk: 0 } as unknown as TradeIdea
    const active = acceptRead(idea, 2, b, null)
    const quiet = acceptRead({ ...idea, partnerId: 3 }, 2, b, null)
    expect(active.index).toBeGreaterThan(quiet.index)
    expect(active.reasons).toContain('has traded with you before')
    const overpay = acceptRead(idea, 2, b, { t: 8, g: 1 })
    expect(overpay.index).toBeLessThan(active.index)
    expect(overpay.perceivedAsk).toBeCloseTo(starValue(8) - starValue(1), 2)
  })
})

describe('unset lineups', () => {
  const slots = startingSlots(['QB', 'RB', 'FLEX'])
  it('finds empty slots and starters who cannot score', () => {
    const dead = deadStarters(slots, ['q', '0', 'r'], { q: 20, r: 0 }, { r: 0 })
    expect(dead.map((d) => [d.slot.name, d.id])).toEqual([
      ['RB', null],
      ['FLEX', 'r'],
    ])
    // A starter projected for nothing who scored anyway was not dead.
    expect(deadStarters(slots, ['q', 'b', 'r'], { q: 20, b: 10 }, { r: 6 })).toEqual([])
  })
  it('gives a forgotten bye a replacement body when measuring efficiency', () => {
    const tw = { week: 1, rosterId: 1, points: 30, slotted: ['q', '0', 'r'], playersPoints: { q: 30 } } as unknown as TeamWeek
    // RB floor 8; FLEX takes the best of RB/WR/TE floors (9).
    expect(managedPoints(tw, slots, { q: 20 }, { RB: 8, WR: 9, TE: 5 })).toBe(30 + 8 + 9)
    // No projections for the week: nothing to judge by, points stand.
    expect(managedPoints(tw, slots, undefined, { RB: 8 })).toBe(30)
  })
})

describe('clinching and persistence', () => {
  it('settles a spot only when the win arithmetic does', () => {
    // Four teams, two spots, one game left each (1v2, 3v4).
    const schedule = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    const rec = (wins: number) => ({ wins, losses: 0, ties: 0 })
    const s = clinchStatus([1, 2, 3, 4], { 1: rec(5), 2: rec(3), 3: rec(3), 4: rec(1) }, schedule, 2)
    // Team 1 at 5 wins: only team 2 or 3 (max 4) could follow, never two above it.
    expect(s[1]).toBe('in')
    // Team 4 can reach 2; teams 1, 2 and 3 already have more.
    expect(s[4]).toBe('out')
    expect(s[2]).toBeNull()
    expect(s[3]).toBeNull()
    // A week missing from the schedule (failed fetch) still counts as a week to play.
    const gap = clinchStatus([1, 2, 3, 4], { 1: rec(5), 2: rec(4), 3: rec(3), 4: rec(3) }, [], 2, 2)
    expect(gap[1]).toBeNull()
  })
  it('settles the cut line by points-for once the season is over', () => {
    const r = (wins: number, pf: number) => ({ wins, losses: 0, ties: 0, pf })
    const s = clinchStatus([1, 2, 3], { 1: r(9, 1500), 2: r(8, 1400), 3: r(8, 1350) }, [], 2, 0)
    expect([s[1], s[2], s[3]]).toEqual(['in', 'in', 'out'])
  })
  it('pulls ratings toward the week average', () => {
    const m = persistMean((t) => (t === 1 ? 120 : 100), [1, 2], 0.5)
    expect(m(1, 5)).toBeCloseTo(115)
    expect(m(2, 5)).toBeCloseTo(105)
  })
})

describe('adjustments', () => {
  const data = {
    horizon: [
      { week: 5, pts: { a: 10, b: 8 } },
      { week: 6, pts: { a: 12, b: 0 } },
    ],
    rawHorizon: [{ week: 5, pts: { a: 10, b: 8 } }],
    projections: { a: 10, b: 8 },
    projectionWeek: 5,
  } as unknown as LeagueData
  it('scales one week or every week ahead, and leaves byes at zero', () => {
    const out = applyAdjustments(data, { a: { pct: -0.25, scope: 'week', week: 5 }, b: { pct: 0.5, scope: 'season', week: 5 } })
    expect(out.horizon[0].pts).toEqual({ a: 7.5, b: 12 })
    expect(out.horizon[1].pts).toEqual({ a: 12, b: 0 })
    expect(out.projections).toEqual({ a: 7.5, b: 12 })
    // Nothing to apply: the same object back, so nothing downstream recomputes.
    expect(applyAdjustments(data, {})).toBe(data)
  })
  it('drops a one-week read once that week has passed', () => {
    const live = liveAdjustments({ a: { pct: -0.25, scope: 'week', week: 4 }, b: { pct: 0.1, scope: 'season', week: 4 }, c: { pct: 0, scope: 'season', week: 5 } }, 5)
    expect(Object.keys(live)).toEqual(['b'])
  })
})

describe('trade currency', () => {
  const P = (id: string, pos: string) => ({ id, name: id, pos, fpos: [pos], team: 'KC', status: null, injury: null, age: null, exp: null })
  const players = { q1: P('q1', 'QB'), q2: P('q2', 'QB'), q3: P('q3', 'QB'), d: P('d', 'DEF'), w: P('w', 'WR') }
  const market = { q1: 6, q2: 4, q3: 2, d: 1.5, w: 5 }
  const cur = tradeCurrency({
    players,
    market,
    rosterPositions: ['QB', 'WR', 'DEF'],
    numTeams: 2,
    rosters: [
      { rosterId: 1, players: ['q1', 'w', 'd'] },
      { rosterId: 2, players: ['q2', 'q3'] },
    ],
    transactions: [{ type: 'free_agent', status: 'complete', roster_ids: [1], adds: { d: 1 }, drops: null, picks: 0, created: 1, leg: 1 }],
  })
  it('prices streamers low and drafted players dear', () => {
    // Two QB starters: q3 (third) is past the line by a full half again.
    expect(cur.factor.q3).toBeCloseTo(0.35)
    expect(cur.factor.q1).toBeUndefined()
    expect(cur.factor.d).toBeCloseTo(0.1)
    // Picked up this season: no attachment. Drafted: attached.
    expect(cur.attached.has('d')).toBe(false)
    expect(cur.attached.has('w')).toBe(true)
    expect(tradeValue(['w'], market, cur, true)).toBeCloseTo(5 * ATTACHMENT)
    expect(tradeValue(['q3', 'd'], market, cur, false)).toBeCloseTo(starValue(2) * 0.35 + starValue(1.5) * 0.1)
  })
})

describe('scouting report', () => {
  const analysis = {
    slots: [],
    teams: [1, 2, 3, 4, 5, 6].map((rosterId) => ({ rosterId, players: [] })),
    teamById: {},
    needs: {
      1: {
        slots: [
          { slot: 'RB', starter: 'a', gap: 2.5 },
          { slot: 'RB', starter: 'b', gap: 1 },
          { slot: 'WR', starter: 'c', gap: -0.5 },
          { slot: 'WR', starter: null, gap: -1 },
        ],
      },
    },
    seasonById: { 1: { games: 4, wins: 1, losses: 3, luck: -1.2, expectedWins: 2.2 } },
    powerById: Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, { sos: 40 + id }])),
    horizonReplacement: {},
  } as unknown as Analysis
  const data = { players: { a: { name: 'A One' }, b: { name: 'B Two' }, c: { name: 'C Three' } }, horizon: [], rawHorizon: [], context: {} } as unknown as LeagueData
  it('groups rooms, flags luck and schedule, and ranks by size', () => {
    const s = scoutTeam(data, analysis, { forecast: null } as unknown as Models, 1)
    expect(s.strengths.map((f) => f.key)).toEqual(['pos:RB', 'schedule'])
    expect(s.strengths[0].value).toBeCloseTo(3.5)
    expect(s.strengths[0].detail).toBe('One, Two')
    // Luck (1.2 wins ≈ 4.8 pts) outranks a 1.5-point WR hole.
    expect(s.weaknesses.map((f) => f.key)).toEqual(['luck', 'pos:WR'])
    expect(s.summary).toBe('Built on RB (+3.5/wk); held back by bad luck (−1.2 wins).')
  })
})

describe('surname', () => {
  it('skips generational suffixes', () => {
    expect(surname('Marvin Harrison Jr.')).toBe('Harrison')
    expect(surname('Kenneth Walker III')).toBe('Walker')
    expect(surname('Puka Nacua')).toBe('Nacua')
  })
})
