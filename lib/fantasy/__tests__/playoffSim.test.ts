import { describe, expect, it } from 'vitest'
import { lockKey, simulateSeason, type SimInput } from '../forecast'
import { roundName, seasonStories, simulateOnce } from '../playoffSim'

// Six teams, two weeks left, four make the playoffs. Team 1 is far better than team 6.
const teams = [1, 2, 3, 4, 5, 6]
const base: SimInput = {
  teams,
  record: Object.fromEntries(teams.map((t) => [t, { wins: 6 - t, losses: t - 1, ties: 0, pf: 1000 - t * 10 }])),
  schedule: [
    { week: 12, a: 1, b: 6 },
    { week: 12, a: 2, b: 5 },
    { week: 12, a: 3, b: 4 },
    { week: 13, a: 1, b: 5 },
    { week: 13, a: 2, b: 4 },
    { week: 13, a: 3, b: 6 },
  ],
  playoffWeeks: [14, 15, 16],
  playoffTeams: 4,
  mean: (t) => 130 - t * 5,
  sigma: 20,
  tau: 6,
  sims: 3000,
  seed: 7,
}

describe('locked results', () => {
  it('a locked upset always happens and moves the odds', () => {
    const key = lockKey({ week: 12, a: 1, b: 6 })
    const free = simulateSeason(base)
    const locked = simulateSeason({ ...base, locks: { [key]: 6 } })
    expect(locked[6].wins).toBeGreaterThan(free[6].wins)
    expect(locked[1].wins).toBeLessThan(free[1].wins)
    // Every simulated week-12 game between them goes team 6's way.
    for (let s = 0; s < 40; s++) {
      const t = simulateOnce({ ...base, locks: { [key]: 6 } }, s)
      const g = t.regular.find((x) => x.week === 12 && x.a === 1)!
      expect(g.sb).toBeGreaterThan(g.sa)
      expect(g.locked).toBe(true)
    }
  })

  it('a pick changes only its own game: every other game keeps its draws', () => {
    // Redraws come from their own stream, so forcing the other result leaves the rest of the season's dice alone.
    for (let seed = 0; seed < 20; seed++) {
      const free = simulateOnce(base, seed)
      const g = free.regular[0]
      const flipped = simulateOnce({ ...base, locks: { [lockKey(g)]: g.sa > g.sb ? g.b : g.a } }, seed)
      expect(flipped.regular[0].sa > flipped.regular[0].sb).toBe(g.sb >= g.sa)
      expect(flipped.regular.slice(1)).toEqual(free.regular.slice(1))
    }
  })

  it('the key is the same whichever side is listed first', () => {
    expect(lockKey({ week: 3, a: 9, b: 2 })).toBe(lockKey({ week: 3, a: 2, b: 9 }))
  })
})

describe('one season, kept whole', () => {
  it('is reproducible from its seed and adds up', () => {
    const a = simulateOnce(base, 42)
    const b = simulateOnce(base, 42)
    expect(a).toEqual(b)
    // Every remaining game is played once: two weeks, three games each, a win and a loss per game.
    expect(a.regular).toHaveLength(6)
    const games = a.standings.reduce((n, r) => n + r.wins + r.losses, 0)
    expect(games).toBe(teams.length * 5 + 12)
    // Seeds run 1..n in standings order.
    expect(a.standings.map((r) => r.seed)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('plays a bracket from the top four to one champion', () => {
    const t = simulateOnce(base, 3)
    expect(t.rounds.map((r) => r.name)).toEqual(['Semifinals', 'Final'])
    expect(t.rounds[0].games.map((g) => [g.seedA, g.seedB])).toEqual([
      [1, 4],
      [2, 3],
    ])
    expect(t.champion).not.toBeNull()
    expect(t.runnerUp).not.toBe(t.champion)
    expect(t.rounds[1].games[0].winner).toBe(t.champion)
  })

  it('names rounds by teams left', () => {
    expect(roundName(8)).toBe('Quarterfinals')
    expect(roundName(4)).toBe('Semifinals')
    expect(roundName(2)).toBe('Final')
  })
})

describe('stories', () => {
  it('always tells the title and where you finished, within the limit, in order', () => {
    for (let s = 0; s < 25; s++) {
      const t = simulateOnce(base, s)
      const st = seasonStories(t, 5, 5)
      expect(st.length).toBeLessThanOrEqual(5)
      expect(st.some((x) => x.kind === 'title')).toBe(true)
      expect(st.some((x) => x.kind === 'you')).toBe(true)
      expect(st.map((x) => x.order)).toEqual([...st.map((x) => x.order)].sort((a, b) => a - b))
      // Every team mentioned is a real team.
      for (const x of st) for (const p of x.parts) if (typeof p !== 'string') expect(teams).toContain(p.team)
    }
  })
})
