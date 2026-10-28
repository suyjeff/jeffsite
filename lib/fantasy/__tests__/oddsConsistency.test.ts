// Every playoff number the app shows is read off one simulation: the forecast's (Forecast.sim). Every scenario built on
// it (a result locked for the stakes and the simulator's what-ifs, a trade, the reveal's week taken back) replays the
// forecast's own seasons on the same draws, so with nothing changed it reproduces the forecast number for number, and
// with something changed it moves only where that change does. These are the invariants that keep the app consistent.
import { describe, expect, it } from 'vitest'
import {
  buildForecast,
  clinchStatus,
  lockedScores,
  lockKey,
  phi,
  phiInv,
  playoffRoundWeeks,
  rng,
  simNormal,
  simulateCounts,
  simulateSeason,
  tradeLeverage,
  weekStakes,
  addCounts,
  finishSim,
  type Forecast,
  type ForecastInput,
  type SimInput,
  type SimTeam,
} from '../forecast'
import { simInputFor, simulateOnce } from '../playoffSim'
import { recapOdds, recapOddsRuns, mergeSims, type Recap } from '../recap'
import { buildTeamSeasons, buildTeamWeeks } from '../power'
import { startingSlots } from '../lineup'
import type { PlayerMap, SleeperMatchup } from '../types'

const P = (id: string, pos: string): PlayerMap[string] => ({ id, name: id, pos, fpos: [pos], team: null, status: null, injury: null, age: null, exp: null })

/** Round-robin pairings for one week (circle method), rotated by `w`. */
const pairings = (ids: number[], w: number) => {
  const n = ids.length
  const rest = ids.slice(1)
  const rot = rest.map((_, i) => rest[(i + w) % rest.length])
  const order = [ids[0], ...rot]
  return Array.from({ length: n / 2 }, (_, i) => [order[i], order[n - 1 - i]] as [number, number])
}

/**
 * A league played through `played` weeks of a 14-week season, with a tie in week 3, scored from seeded draws, and
 * everything the model reads built the way the app builds it (records from the matchups, as the recap does too).
 */
const league = (opts: { teams: number; played: number; divisions?: boolean; playoffTeams?: number; seed?: number; roundType?: number }) => {
  const ids = Array.from({ length: opts.teams }, (_, i) => i + 1)
  const slots = startingSlots(['QB', 'RB', 'BN'])
  const players: PlayerMap = {}
  const roster: Record<number, string[]> = {}
  for (const t of ids) {
    roster[t] = [`qb${t}`, `rb${t}`, `bn${t}`]
    players[`qb${t}`] = P(`qb${t}`, 'QB')
    players[`rb${t}`] = P(`rb${t}`, 'RB')
    players[`bn${t}`] = P(`bn${t}`, 'RB')
  }
  const u = rng(opts.seed ?? 7)
  const strength = Object.fromEntries(ids.map((t) => [t, 90 + 30 * u()]))
  const regular = Array.from({ length: 14 }, (_, i) => i + 1)
  const playedWeeks = regular.slice(0, opts.played)
  const futureWeeks = regular.slice(opts.played)
  const matchupsByWeek: Record<number, SleeperMatchup[]> = {}
  for (const w of regular) {
    matchupsByWeek[w] = pairings(ids, w).flatMap(([a, b], m) =>
      [a, b].map((t) => {
        let pts = w <= opts.played ? Math.round((strength[t] + 25 * (u() - 0.5)) * 100) / 100 : 0
        if (w === 3 && m === 0 && w <= opts.played) pts = 111.11 // a tie
        return { roster_id: t, matchup_id: m + 1, points: pts, players: roster[t], starters: [`qb${t}`, `rb${t}`], players_points: { [`qb${t}`]: pts / 2, [`rb${t}`]: pts / 2, [`bn${t}`]: 0 } }
      }),
    )
  }
  const teamWeeks = buildTeamWeeks(matchupsByWeek, playedWeeks, slots, players)
  const record: ForecastInput['record'] = {}
  for (const s of buildTeamSeasons(ids, teamWeeks, playedWeeks, {})) record[s.rosterId] = { wins: s.wins, losses: s.losses, ties: s.ties, pf: s.pf }
  const playoffWeeks = [15, 16, 17]
  const playoffTeams = opts.playoffTeams ?? 6
  const horizon = [...futureWeeks, ...playoffWeeks].map((week) => ({
    week,
    pts: Object.fromEntries(ids.flatMap((t) => [[`qb${t}`, strength[t] * 0.55], [`rb${t}`, strength[t] * 0.45], [`bn${t}`, 5]])),
  }))
  const schedule = futureWeeks.flatMap((week) => pairings(ids, week).map(([a, b]) => ({ week, a: Math.min(a, b), b: Math.max(a, b) })))
  const input: ForecastInput = {
    slots,
    players,
    horizon,
    floor: {},
    teams: ids.map((t) => ({ rosterId: t, players: roster[t] })),
    teamWeeks,
    playedWeeks,
    pastProjections: {},
    schedule,
    record,
    playoffWeeks,
    playoffRounds: playoffRoundWeeks(15, playoffTeams, opts.roundType ?? 0),
    playoffTeams,
    elo: {},
    sigmaFallback: 22,
    weeksLeft: futureWeeks.length,
    divisions: opts.divisions ? Object.fromEntries(ids.map((t) => [t, (t % 2) + 1])) : undefined,
  }
  const f = buildForecast(input, 1500)
  return { ids, input, f, matchupsByWeek, playedWeeks, slots, players, roster }
}

const LEAGUES = {
  'ten teams, no divisions': league({ teams: 10, played: 7 }),
  'twelve teams, two divisions': league({ teams: 12, played: 7, divisions: true, seed: 11 }),
  'late season, races settled': league({ teams: 10, played: 12, seed: 3, playoffTeams: 4 }),
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
// Each probability is rounded to 0.001, so a sum over n of them can be off by n × 0.0005.
const near = (x: number, y: number, n: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(n * 0.0005 + 1e-9)

describe.each(Object.entries(LEAGUES))('odds are one simulation: %s', (name, L) => {
  const { ids, input, f } = L
  const n = ids.length
  const nPlayoff = Math.min(input.playoffTeams, n)
  const size = 2 ** Math.ceil(Math.log2(nPlayoff))

  it('adds up: playoff spots, byes, finalists, champions and seeds', () => {
    const s = Object.values(f.sim)
    near(sum(s.map((t) => t.playoffs)), nPlayoff, n)
    near(sum(s.map((t) => t.bye)), size - nPlayoff, n)
    near(sum(s.map((t) => t.final)), 2, n)
    near(sum(s.map((t) => t.title)), 1, n)
    for (const t of s) near(sum(t.seeds), 1, n)
    for (let k = 1; k <= n; k++) near(sum(s.map((t) => t.seeds[k])), 1, n)
    for (const t of s) {
      // Seeds above the line are the playoff odds; the top ones the byes.
      near(sum(t.seeds.slice(1, nPlayoff + 1)), t.playoffs, nPlayoff)
      near(sum(t.seeds.slice(1, size - nPlayoff + 1)), t.bye, size - nPlayoff)
      expect(t.title).toBeLessThanOrEqual(t.final)
      expect(t.final).toBeLessThanOrEqual(t.playoffs)
      expect(t.bye).toBeLessThanOrEqual(t.playoffs)
    }
  })

  it('reads clinched as certain and eliminated as impossible, and nothing else as either', () => {
    const settled = clinchStatus(ids, input.record, input.schedule, nPlayoff, input.weeksLeft, input.divisions)
    // The late-season league has races the arithmetic has settled, so the check bites.
    if (name.startsWith('late')) expect(ids.some((t) => settled[t] !== null)).toBe(true)
    for (const t of ids) {
      expect(f.sim[t].clinch).toBe(settled[t])
      if (settled[t] === 'in') expect(f.sim[t].playoffs).toBe(1)
      if (settled[t] === 'out') expect(f.sim[t].playoffs).toBe(0)
    }
  })

  it('is the playoff simulator untouched, number for number', () => {
    expect(simulateSeason(simInputFor(input, f))).toEqual(f.sim)
    expect(simulateSeason(f.simInput)).toEqual(f.sim)
  })

  it('adds simulated slices up to the whole run exactly', () => {
    const half = f.sims / 2
    expect(finishSim(addCounts([simulateCounts({ ...f.simInput, sims: half }), simulateCounts({ ...f.simInput, sims: half, from: half })]))).toEqual(f.sim)
  })

  it('stakes bracket the odds: a loss, the odds now and a win, in that order, for every team this week', () => {
    const stakes = weekStakes(input, f)
    for (const g of f.nextWeek)
      for (const t of [g.a, g.b]) {
        const st = stakes[t]
        expect(st.loss.playoffs).toBeLessThanOrEqual(f.sim[t].playoffs)
        expect(f.sim[t].playoffs).toBeLessThanOrEqual(st.win.playoffs)
        expect(st.loss.bye!).toBeLessThanOrEqual(f.sim[t].bye)
        expect(f.sim[t].bye).toBeLessThanOrEqual(st.win.bye!)
        if (f.sim[t].clinch === 'in') expect([st.win.clinch, st.loss.clinch]).toEqual(['in', 'in'])
        if (st.win.clinch === 'in') expect(st.win.playoffs).toBe(1)
        if (st.loss.clinch === 'out') expect(st.loss.playoffs).toBe(0)
      }
  })

  it('stakes are the simulator with that result picked', () => {
    const stakes = weekStakes(input, f)
    const g = f.nextWeek[0]
    const aWins = simulateSeason(simInputFor(input, f, { locks: { [lockKey(g)]: g.a } }))
    expect(stakes[g.a].win.playoffs).toBe(aWins[g.a].playoffs)
    expect(stakes[g.b].loss.playoffs).toBe(aWins[g.b].playoffs)
  })

  it("the reveal's after-odds for the latest settled week are the forecast's", () => {
    const week = L.playedWeeks[L.playedWeeks.length - 1]
    const recap = { week, games: (L.matchupsByWeek[week] ?? []).filter((m, i, ms) => ms.findIndex((x) => x.matchup_id === m.matchup_id) === i).map((m) => ({ a: m.roster_id, b: L.matchupsByWeek[week].find((x) => x.matchup_id === m.matchup_id && x.roster_id !== m.roster_id)!.roster_id })) } as unknown as Recap
    const opts = { recap, priorWeeks: L.playedWeeks.slice(0, -1), matchupsByWeek: L.matchupsByWeek, slots: L.slots, players: L.players, rosterIds: ids, forecast: f, schedule: input.schedule, weeksLeft: input.weeksLeft! }
    const odds = recapOdds(opts)
    for (const t of ids) expect(odds[t].after).toEqual(f.sim[t])
    // In slices, as the reveal runs it in idle time.
    const runs = recapOddsRuns(opts)
    const k = f.sims / 4
    expect(mergeSims([0, 1, 2, 3].map((i) => runs.after(i, k)))).toEqual(f.sim)
    // Before the week is the same seasons with the week still to play: its odds add up the same way.
    near(sum(ids.map((t) => odds[t].before.playoffs)), nPlayoff, n)
  })

  it('a trade that changes nothing changes nothing', () => {
    const me = ids[0]
    const partner = ids[1]
    const lev = tradeLeverage(input, f, { me, partner, myRoster: L.roster[me], theirRoster: L.roster[partner] })!
    expect(lev.me).toEqual({ playoffs: 0, title: 0, wins: 0 })
    expect(lev.partner).toEqual({ playoffs: 0, title: 0, wins: 0 })
    expect(lev.after.me).toEqual(f.sim[me])
  })

  it('a trade that makes a team better never lowers its odds by more than the dice', () => {
    const me = ids[n - 1]
    const partner = ids[0]
    // Swap benches only: my bench player for theirs is no change; then my QB for theirs is a straight upgrade if theirs is better.
    const better = f.byId[partner].rating > f.byId[me].rating ? partner : ids[1]
    const lev = tradeLeverage(input, f, { me, partner: better, myRoster: [`qb${better}`, `rb${me}`, `bn${me}`], theirRoster: [`qb${me}`, `rb${better}`, `bn${better}`] })!
    if (f.byId[better].rating > f.byId[me].rating) expect(lev.me.playoffs).toBeGreaterThanOrEqual(0)
  })

  it('one simulated season is exactly that season of the run', () => {
    const t = simulateOnce(f.simInput, 17)
    // Count season 17 alone: its standings are the trace's.
    const one = simulateSeason({ ...f.simInput, sims: 1, from: 17 })
    t.standings.forEach((r, i) => expect(one[r.rosterId].seeds[i + 1]).toBe(1))
    if (t.champion != null) expect(one[t.champion].title).toBe(1)
  })
})

describe('locked results', () => {
  const { f } = LEAGUES['ten teams, no divisions']
  const g = f.nextWeek[0]
  const k = lockKey(g)

  it('keep every season where the game went that way anyway, and move only the locked game in the rest', () => {
    for (let s = 0; s < 60; s++) {
      const free = simulateOnce(f.simInput, s)
      const game = free.regular.find((x) => lockKey(x) === k)!
      const winner = game.sa > game.sb ? game.a : game.b
      const loser = winner === game.a ? game.b : game.a
      const keep = simulateOnce({ ...f.simInput, locks: { [k]: winner } }, s)
      // Identical but for the pick's own mark.
      expect({ ...keep, regular: keep.regular.map((x) => ({ ...x, locked: false })) }).toEqual(free)
      const flip = simulateOnce({ ...f.simInput, locks: { [k]: loser } }, s)
      flip.regular.forEach((x, i) => {
        if (lockKey(x) !== k) return expect(x).toEqual(free.regular[i])
        // The locked winner scores more than drawn, the loser less, and the pair's total stands.
        const up = x.a === loser ? x.sa : x.sb
        const down = x.a === loser ? x.sb : x.sa
        expect(up).toBeGreaterThan(down)
        expect(up).toBeGreaterThanOrEqual(x.a === loser ? free.regular[i].sa : free.regular[i].sb)
        expect(x.sa + x.sb).toBeCloseTo(free.regular[i].sa + free.regular[i].sb, 9)
      })
    }
  })

  it('draw a locked margin from its distribution given the result', () => {
    // An underdog by 15 with σ√2 = 30: given it wins, the margin's mean is sd·φ(c)/(1 − Φ(c)) + μ, c = −μ/sd.
    const mu = -15
    const sd = 30
    const z = (() => {
      const u = rng(1)
      return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u())
    })()
    let total = 0
    const N = 40000
    for (let i = 0; i < N; i++) {
      const sa = 100 + mu + (sd / Math.SQRT2) * z()
      const sb = 100 + (sd / Math.SQRT2) * z()
      const [a, b] = lockedScores(true, sa, sb, mu, sd)
      expect(a).toBeGreaterThan(b)
      total += a - b
    }
    const c = -mu / sd
    const pdf = Math.exp((-c * c) / 2) / Math.sqrt(2 * Math.PI)
    expect(total / N).toBeCloseTo(mu + (sd * pdf) / (1 - phi(c)), 0)
  })

  it('settle a race the arithmetic settles', () => {
    // Two spots, four teams, one game left each: lock team 1's win and it is in, whatever else happens.
    const input: SimInput = {
      teams: [1, 2, 3, 4],
      record: { 1: { wins: 9, losses: 4, ties: 0, pf: 0 }, 2: { wins: 12, losses: 1, ties: 0, pf: 0 }, 3: { wins: 9, losses: 4, ties: 0, pf: 0 }, 4: { wins: 2, losses: 11, ties: 0, pf: 0 } },
      schedule: [
        { week: 14, a: 1, b: 4 },
        { week: 14, a: 2, b: 3 },
      ],
      playoffWeeks: [15],
      playoffTeams: 2,
      mean: () => 100,
      sigma: 20,
      tau: 0,
      sims: 400,
      weeksLeft: 1,
    }
    expect(simulateSeason(input)[1].clinch).toBeNull()
    const won = simulateSeason({ ...input, locks: { [lockKey(input.schedule[0])]: 1 }, schedule: input.schedule })
    // Team 1 at 10 wins can still be caught by 3 on points, so it stays open; team 4 is out either way.
    expect(won[4].clinch).toBe('out')
    expect(won[4].playoffs).toBe(0)
    const both = simulateSeason({ ...input, locks: { [lockKey(input.schedule[0])]: 1, [lockKey(input.schedule[1])]: 2 } })
    expect(both[1].clinch).toBe('in')
    expect(both[1].playoffs).toBe(1)
    expect(both[3].clinch).toBe('out')
  })
})

describe('the random stream', () => {
  it('is standard normal and independent across seasons, weeks and teams', () => {
    const xs: number[] = []
    for (let s = 0; s < 2000; s++) for (let w = 1; w <= 5; w++) for (let t = 1; t <= 4; t++) xs.push(simNormal(20240917, s, w, t))
    const m = sum(xs) / xs.length
    const v = sum(xs.map((x) => (x - m) ** 2)) / xs.length
    expect(Math.abs(m)).toBeLessThan(0.02)
    expect(Math.abs(v - 1)).toBeLessThan(0.03)
    // Neighbours (the next team, the next week) are uncorrelated.
    let c = 0
    for (let i = 0; i + 1 < xs.length; i++) c += xs[i] * xs[i + 1]
    expect(Math.abs(c / xs.length)).toBeLessThan(0.02)
    // Tails as a normal's: about 4.6% beyond ±2.
    expect(xs.filter((x) => Math.abs(x) > 2).length / xs.length).toBeCloseTo(0.0455, 2)
  })

  it('inverts the normal CDF', () => {
    for (const p of [1e-6, 0.001, 0.02, 0.2, 0.5, 0.8, 0.975, 0.999999]) expect(phi(phiInv(p))).toBeCloseTo(p, 6)
  })

  it('does not depend on the order the schedule is listed in', () => {
    const { f } = LEAGUES['ten teams, no divisions']
    expect(simulateSeason({ ...f.simInput, schedule: [...f.simInput.schedule].reverse() })).toEqual(f.sim)
  })
})

describe('playoff rounds', () => {
  it('reads each round as one week, a two-week final, or two weeks a round', () => {
    expect(playoffRoundWeeks(15, 6)).toEqual([[15], [16], [17]])
    expect(playoffRoundWeeks(15, 6, 1)).toEqual([[15], [16], [17, 18]])
    expect(playoffRoundWeeks(15, 4, 2)).toEqual([
      [15, 16],
      [17, 18],
    ])
    // Past the NFL's last week a round comes back empty; the simulation still plays it, on a placeholder week.
    expect(playoffRoundWeeks(16, 6, 2, 18)).toEqual([[16, 17], [18], []])
    const s = simulateSeason({ teams: [1, 2, 3, 4, 5, 6], record: {}, schedule: [], playoffWeeks: [16, 17, 18], playoffRounds: [[16, 17], [18], []], playoffTeams: 6, mean: (t) => 100 + t, sigma: 20, tau: 5, sims: 500 })
    expect(Object.values(s).reduce((a, t) => a + t.title, 0)).toBeCloseTo(1, 2)
    expect(s[6].title).toBeLessThan(0.9)
    const trace = simulateOnce({ teams: [1, 2, 3, 4, 5, 6], record: {}, schedule: [], playoffWeeks: [16, 17, 18], playoffRounds: [[16, 17], [18], []], playoffTeams: 6, mean: (t) => 100 + t, sigma: 20, tau: 5, sims: 1 }, 3)
    expect(trace.rounds.map((r) => r.week)).toEqual([17, 18, null])
  })

  it('a two-week round favours the stronger team more than a one-week one', () => {
    const base: SimInput = { teams: [1, 2], record: {}, schedule: [], playoffWeeks: [15, 16], playoffTeams: 2, mean: (t) => (t === 1 ? 110 : 100), sigma: 25, tau: 0, sims: 4000 }
    const one = simulateSeason({ ...base, playoffRounds: [[15]] })
    const two = simulateSeason({ ...base, playoffRounds: [[15, 16]] })
    // Analytically Φ(10/(25√2)) = 0.61 and Φ(20/(25·2)) = 0.66.
    expect(one[1].title).toBeCloseTo(phi(10 / (25 * Math.SQRT2)), 1)
    expect(two[1].title).toBeCloseTo(phi(20 / 50), 1)
    expect(two[1].title).toBeGreaterThan(one[1].title)
  })
})

describe('calibration of a single game', () => {
  it("matches the forecast's own win probability when the season is one game", () => {
    const f = LEAGUES['ten teams, no divisions'].f as Forecast
    const g = f.nextWeek[0]
    // One game, no season drift, no persistence: the share of seasons team a wins it is winProb.
    const input: SimInput = { teams: [g.a, g.b], record: {}, schedule: [{ week: g.week, a: g.a, b: g.b }], playoffWeeks: [], playoffTeams: 1, mean: f.mean, sigma: f.sigma, tau: 0, sims: 20000 }
    const s = simulateSeason(input) as Record<number, SimTeam>
    expect(s[g.a].seeds[1]).toBeCloseTo(g.pA, 1)
  })
})
