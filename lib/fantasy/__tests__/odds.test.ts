import { describe, expect, it } from 'vitest'
import { odds, pct, simOdds } from '../../../components/fantasy/ui'
import { clinchStatus, divisionsOf, seedOrder, simulateSeason } from '../forecast'

describe('percent display', () => {
  it('is always a whole number', () => {
    expect(pct(0.4567)).toBe('46%')
    expect(pct(0.0784, 1)).toBe('8%')
    expect(odds(0.0784, 1)).toBe('8%')
  })
  it('never rounds a share to a certainty', () => {
    expect(pct(0.996)).toBe('>99%')
    expect(pct(0.004)).toBe('<1%')
    expect(pct(1)).toBe('100%')
    expect(pct(0)).toBe('0%')
  })
  it('reads a simulated probability as certain only when it is settled', () => {
    // Every simulated season made it, but nothing has clinched: still not 100%.
    expect(odds(1)).toBe('>99%')
    expect(odds(0.999)).toBe('>99%')
    expect(odds(0)).toBe('<1%')
    expect(odds(0.999, 0, 'in')).toBe('100%')
    expect(odds(0.001, 0, 'out')).toBe('0%')
    expect(simOdds({ playoffs: 1, bye: 0.8, final: 0.5, title: 0.3, clinch: null }, 'playoffs')).toBe('>99%')
  })
})

describe('division seeding', () => {
  const rows = [
    { id: 1, w: 10, pf: 1500, d: 1 },
    { id: 2, w: 9, pf: 1400, d: 1 },
    { id: 3, w: 8, pf: 1300, d: 1 },
    { id: 4, w: 5, pf: 1100, d: 2 },
    { id: 5, w: 4, pf: 1200, d: 2 },
  ]
  it('puts each division winner on top, then everyone by record', () => {
    const order = seedOrder(rows, (r) => r.w, (r) => r.pf, (r) => r.d).map((r) => r.id)
    expect(order).toEqual([1, 4, 2, 3, 5])
  })
  it('is plain standings without divisions', () => {
    expect(seedOrder(rows, (r) => r.w, (r) => r.pf).map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
  })
  it('reads divisions from rosters only when the league has two or more', () => {
    const rosters = [
      { roster_id: 1, settings: { division: 1 } },
      { roster_id: 2, settings: { division: 2 } },
    ]
    expect(divisionsOf(rosters, 2)).toEqual({ 1: 1, 2: 2 })
    expect(divisionsOf(rosters, 0)).toBeUndefined()
    expect(divisionsOf(rosters, undefined)).toEqual({ 1: 1, 2: 2 })
    expect(divisionsOf([{ roster_id: 1, settings: { division: 1 } }, { roster_id: 2, settings: { division: 1 } }])).toBeUndefined()
  })
})

describe('clinching with divisions', () => {
  const rec = (wins: number) => ({ wins, losses: 0, ties: 0, pf: 0 })
  const teams = [1, 2, 3, 4, 5, 6]
  const divisions = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 }
  it('never calls a team out while it can still win its division', () => {
    // Team 6 trails three teams it cannot catch, but its own division is still open.
    const record = { 1: rec(9), 2: rec(9), 3: rec(9), 4: rec(3), 5: rec(3), 6: rec(2) }
    const plain = clinchStatus(teams, record, [], 3, 2)
    const split = clinchStatus(teams, record, [], 3, 2, divisions)
    expect(plain[6]).toBe('out')
    expect(split[6]).toBeNull()
  })
  it('puts a team in once it has won its division', () => {
    const record = { 1: rec(10), 2: rec(4), 3: rec(4), 4: rec(9), 5: rec(9), 6: rec(9) }
    expect(clinchStatus(teams, record, [], 2, 2, divisions)[1]).toBe('in')
  })
  it('settles final standings by division seeding', () => {
    const record = { 1: rec(10), 2: rec(9), 3: rec(8), 4: rec(5), 5: rec(4), 6: rec(3) }
    const s = clinchStatus(teams, record, [], 2, 0, divisions)
    expect(s[1]).toBe('in')
    expect(s[4]).toBe('in')
    expect(s[2]).toBe('out')
  })
  it('gives a weak division winner its spot in the simulation', () => {
    // Team 4 leads a weak division by a mile in wins it already has, so it makes the playoffs every season.
    const record = { 1: rec(9), 2: rec(9), 3: rec(9), 4: rec(6), 5: rec(0), 6: rec(0) }
    const schedule = [
      { week: 13, a: 1, b: 2 },
      { week: 13, a: 3, b: 4 },
      { week: 13, a: 5, b: 6 },
    ]
    const sim = simulateSeason({ teams, record: Object.fromEntries(teams.map((t) => [t, { ...record[t as 1], losses: 0, ties: 0, pf: 0 }])), schedule, playoffWeeks: [14], playoffTeams: 2, mean: () => 100, sigma: 20, tau: 0, sims: 500, divisions })
    expect(sim[4].playoffs).toBe(1)
    expect(sim[4].clinch).toBe('in')
  })
})
