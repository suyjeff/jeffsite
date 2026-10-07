import { describe, expect, it } from 'vitest'
import { startingSlots } from '../lineup'
import {
  applyTrade,
  averageStarter,
  findTargets,
  findTrades,
  horizonValues,
  isWaiverFill,
  makeHorizonEval,
  makeLineupEval,
  marketValues,
  projectedReplacement,
  rosterCapacity,
  scoreTrade,
  teamNeeds,
  type Horizon,
} from '../trades'
import type { PlayerMap } from '../types'

const P = (id: string, pos: string, fpos = [pos]): PlayerMap[string] => ({
  id,
  name: id,
  pos,
  fpos,
  team: null,
  status: null,
  injury: null,
  age: null,
  exp: null,
})

const ROSTER_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN']
const SLOTS = startingSlots(ROSTER_POSITIONS)

describe('horizonValues', () => {
  const horizon: Horizon = [
    { week: 1, pts: { a: 20, b: 10 } },
    { week: 2, pts: { a: 0, b: 10 } },
    { week: 3, pts: { a: 10, b: 10 } },
    { week: 4, pts: { b: 10 } },
  ]
  it('reads points per week and per week actually played', () => {
    const v = horizonValues(horizon)
    // a: 30 points over 4 weeks, but only 2 of them projected above zero.
    expect(v.perWeek.a).toBeCloseTo(7.5)
    expect(v.perActive.a).toBeCloseTo(15)
    expect(v.activeWeeks.a).toBe(2)
    // b never misses, so the two readings agree.
    expect(v.perWeek.b).toBeCloseTo(10)
    expect(v.perActive.b).toBeCloseTo(10)
  })
  it('counts a week missing from the payload as a zero, not as absent', () => {
    // Week 4 has no entry for a at all; it still divides by four weeks.
    expect(horizonValues(horizon).perWeek.a).toBeCloseTo(30 / 4)
  })
  it('survives an empty horizon', () => {
    expect(horizonValues([])).toEqual({ perWeek: {}, perActive: {}, activeWeeks: {}, weeks: 0 })
  })
})

describe('rosterCapacity', () => {
  it('counts starters and bench but not IR or taxi', () => {
    expect(rosterCapacity(['QB', 'RB', 'FLEX', 'BN', 'BN', 'IR', 'TAXI'])).toBe(5)
  })
})

describe('applyTrade', () => {
  const pts = { keep: 10, cheap: 1, mid: 5, in1: 9, in2: 8 }
  it('swaps players and leaves the roster alone when it fits', () => {
    const out = applyTrade(['keep', 'cheap', 'mid'], ['mid'], ['in1'], 5, pts)
    expect([...out].sort()).toEqual(['cheap', 'in1', 'keep'])
  })
  it('cuts the least useful body when a side takes back more than it sends', () => {
    // Capacity 3, sends one, receives two: one incumbent has to go, and it is
    // the cheapest one, never one of the incoming players.
    const out = applyTrade(['keep', 'cheap', 'mid'], ['mid'], ['in1', 'in2'], 3, pts)
    expect(out).toContain('in1')
    expect(out).toContain('in2')
    expect(out).toContain('keep')
    expect(out).not.toContain('cheap')
    expect(out).toHaveLength(3)
  })
  it('does not duplicate a player who is already on the roster', () => {
    expect(applyTrade(['a', 'b'], [], ['a'], 5, {})).toEqual(['a', 'b'])
  })
})

describe('waiver floor', () => {
  const players: PlayerMap = { qb1: P('qb1', 'QB'), rb1: P('rb1', 'RB'), rb2: P('rb2', 'RB'), wr1: P('wr1', 'WR') }
  const pts = { qb1: 20, rb1: 12, rb2: 8, wr1: 10 }

  it('leaves unfillable slots at zero when there is no floor', () => {
    const bare = makeLineupEval(SLOTS, players, pts)
    // QB 20 + RB 12 + RB 8 + WR 10 + WR (empty) + TE (empty) + FLEX (empty)
    expect(bare.total(['qb1', 'rb1', 'rb2', 'wr1'])).toBeCloseTo(50)
  })

  it('fills them at replacement level when there is one', () => {
    const floor = { QB: 15, RB: 5, WR: 6, TE: 4 }
    const withFa = makeLineupEval(SLOTS, players, pts, floor)
    // The empty WR, TE and FLEX each draw a free agent, one body per position:
    // +6 at WR, +4 at TE, and the flex takes the only one left, the RB, at +5.
    expect(withFa.total(['qb1', 'rb1', 'rb2', 'wr1'])).toBeCloseTo(65)
  })

  it('offers one body per position, not one per slot', () => {
    const floor = { RB: 5 }
    const ev = makeLineupEval(SLOTS, players, floor, { RB: 5 })
    const lineup = ev.assign([])
    const fills = lineup.assignments.filter((a) => a && isWaiverFill(a.id))
    expect(fills).toHaveLength(1)
  })

  it('never displaces a rostered player who outscores the floor', () => {
    const ev = makeLineupEval(SLOTS, players, pts, { QB: 15, RB: 5, WR: 6, TE: 4 })
    const starters = ev.assign(['qb1', 'rb1', 'rb2', 'wr1']).assignments
    expect(starters[0]?.id).toBe('qb1')
    expect(starters[1]?.id).toBe('rb1')
  })
})

describe('makeHorizonEval', () => {
  const players: PlayerMap = { star: P('star', 'QB'), backup: P('backup', 'QB'), rb: P('rb', 'RB') }
  const horizon: Horizon = [
    { week: 1, pts: { star: 24, backup: 10, rb: 12 } },
    { week: 2, pts: { star: 0, backup: 10, rb: 12 } }, // star on bye
  ]
  const slots = startingSlots(['QB', 'RB', 'BN', 'BN'])

  it('solves each week separately rather than averaging first', () => {
    const ev = makeHorizonEval(slots, players, horizon)
    // Week 1 starts the star (24 + 12), week 2 falls back to the backup (10 + 12).
    expect(ev.perWeek(['star', 'backup', 'rb'])).toEqual([36, 22])
    expect(ev.total(['star', 'backup', 'rb'])).toBeCloseTo(29)
  })

  it('prices the backup at what he saves in the bye week alone', () => {
    const ev = makeHorizonEval(slots, players, horizon)
    const withBackup = ev.total(['star', 'backup', 'rb'])
    const without = ev.total(['star', 'rb'])
    // Without him week 2 has no quarterback at all: (36 + 12) / 2 = 24.
    expect(without).toBeCloseTo(24)
    expect(withBackup - without).toBeCloseTo(5)
  })

  it('prices him far lower once the waiver wire can cover the bye', () => {
    const ev = makeHorizonEval(slots, players, horizon, { QB: 9, RB: 4 })
    const gain = ev.total(['star', 'backup', 'rb']) - ev.total(['star', 'rb'])
    expect(gain).toBeCloseTo(0.5)
  })

  it('differs from solving one lineup on averaged projections', () => {
    const avg = horizonValues(horizon).perWeek
    const flat = makeLineupEval(slots, players, avg)
    const exact = makeHorizonEval(slots, players, horizon)
    // Averaging first hides the bye: it thinks the star is a 12-point QB every
    // week and the backup never plays.
    expect(flat.total(['star', 'backup', 'rb'])).toBeCloseTo(24)
    expect(exact.total(['star', 'backup', 'rb'])).toBeCloseTo(29)
  })
})

describe('replacement level and market value', () => {
  const players: PlayerMap = {}
  const pts: Record<string, number> = {}
  // 30 running backs scoring 30 down to 1.
  for (let i = 1; i <= 30; i++) {
    players[`rb${i}`] = P(`rb${i}`, 'RB')
    pts[`rb${i}`] = 31 - i
  }
  it('sets the line past the last starter by the bench factor', () => {
    // 4 teams x (2 RB + 0.45 FLEX) = 9.8 starters; x1.6 -> rank 16.
    const repl = projectedReplacement(pts, players, ROSTER_POSITIONS, 4, 0.6)
    expect(repl.RB).toBeCloseTo(15) // mean of ranks 15, 16, 17 -> 16, 15, 14
  })
  it('raises the line as the bench factor grows', () => {
    const shallow = projectedReplacement(pts, players, ROSTER_POSITIONS, 4, 0)
    const deep = projectedReplacement(pts, players, ROSTER_POSITIONS, 4, 1)
    expect(shallow.RB).toBeGreaterThan(deep.RB)
  })
  it('averages the top starters for the average-starter line', () => {
    const avg = averageStarter(pts, players, ROSTER_POSITIONS, 4)
    // Top 10 of 30, 21 through 30.
    expect(avg.RB).toBeCloseTo(25.5)
  })
  it('prices players against their own position', () => {
    const market = marketValues(pts, players, { RB: 15 })
    expect(market.rb1).toBeCloseTo(15)
    expect(market.rb16).toBeCloseTo(0)
  })
})

// ---------- A league built so the right answer is known in advance ----------

/**
 * Two teams, mirror images. A is four deep at running back and starts nobody
 * worth starting at receiver; B is exactly the reverse. Each holds surplus the
 * other needs, so the right answer is knowable in advance: a receiver for a
 * running back, and both lineups improve.
 */
const buildLeague = () => {
  const players: PlayerMap = {}
  const pts: Record<string, number> = {}
  const add = (id: string, pos: string, v: number) => {
    players[id] = P(id, pos)
    pts[id] = v
  }
  add('a_qb', 'QB', 18)
  add('a_rb1', 'RB', 16)
  add('a_rb2', 'RB', 14)
  add('a_rb3', 'RB', 13)
  add('a_rb4', 'RB', 11)
  add('a_wr1', 'WR', 8)
  add('a_wr2', 'WR', 6)
  add('a_te', 'TE', 9)
  add('a_spare', 'RB', 5)

  add('b_qb', 'QB', 18)
  add('b_wr1', 'WR', 16)
  add('b_wr2', 'WR', 14)
  add('b_wr3', 'WR', 13)
  add('b_wr4', 'WR', 12)
  add('b_rb1', 'RB', 8)
  add('b_rb2', 'RB', 6)
  add('b_te', 'TE', 9)
  add('b_spare', 'WR', 5)

  const horizon: Horizon = [
    { week: 1, pts },
    { week: 2, pts },
  ]
  const A = { rosterId: 1, players: ['a_qb', 'a_rb1', 'a_rb2', 'a_rb3', 'a_rb4', 'a_wr1', 'a_wr2', 'a_te', 'a_spare'] }
  const B = { rosterId: 2, players: ['b_qb', 'b_wr1', 'b_wr2', 'b_wr3', 'b_wr4', 'b_rb1', 'b_rb2', 'b_te', 'b_spare'] }
  const rosteredBy: Record<string, number> = {}
  A.players.forEach((id) => (rosteredBy[id] = 1))
  B.players.forEach((id) => (rosteredBy[id] = 2))
  const values = horizonValues(horizon)
  const replacement = projectedReplacement(values.perActive, players, ROSTER_POSITIONS, 2)
  return {
    players,
    pts,
    horizon,
    A,
    B,
    rosteredBy,
    replacement,
    starters: averageStarter(values.perActive, players, ROSTER_POSITIONS, 2),
    market: marketValues(values.perActive, players, replacement),
  }
}

describe('teamNeeds', () => {
  const { players, horizon, A, B, starters } = buildLeague()
  const needs = teamNeeds([A, B], SLOTS, players, horizon, starters, ROSTER_POSITIONS, 2)

  it('names the position each team is actually short at', () => {
    expect(needs[1].worstPos).toBe('WR')
    expect(needs[2].worstPos).toBe('RB')
  })
  it('does not call a position a hole just because the flex covers it', () => {
    // Team A already starts three running backs; a fourth would only displace
    // one of them, so the flex has absorbed most of what another would be worth.
    expect(needs[1].byPos.RB).toBeLessThan(needs[1].byPos.WR)
    expect(needs[2].byPos.WR).toBeLessThan(needs[2].byPos.RB)
  })
  it('reports slot production against the league average', () => {
    const wr2 = needs[1].slots.filter((s) => s.slot === 'WR')[1]
    expect(wr2.pts).toBeLessThan(wr2.leagueAvg)
    expect(wr2.gap).toBeLessThan(0)
  })
  it('adds the slot averages back up to the lineup total', () => {
    const sum = needs[1].slots.reduce((a, s) => a + s.pts, 0)
    expect(sum).toBeCloseTo(needs[1].lineup, 1)
  })
  it('returns nothing rather than guessing when there is no horizon', () => {
    expect(teamNeeds([A, B], SLOTS, players, [], starters, ROSTER_POSITIONS, 2)).toEqual({})
  })
})

describe('findTargets', () => {
  const { players, pts, horizon, A, B, rosteredBy, market } = buildLeague()
  const targets = findTargets({
    slots: SLOTS,
    players,
    horizon,
    pts,
    me: A,
    others: [B],
    rosteredBy,
    capacity: 9,
    market,
  })

  it('ranks their players by what they would add to my lineup', () => {
    expect(targets[0].id).toBe('b_wr1')
    expect(targets.map((t) => t.add)).toEqual([...targets.map((t) => t.add)].sort((a, b) => b - a))
  })
  it('leaves out players who could not crack my lineup', () => {
    expect(targets.map((t) => t.id)).not.toContain('b_spare')
    expect(targets.map((t) => t.id)).not.toContain('b_qb')
  })
  it('charges less for a player his owner only benches', () => {
    const byId = Object.fromEntries(targets.map((t) => [t.id, t]))
    // Their WR1 starts; their WR4 does not, so losing him costs them nothing.
    expect(byId.b_wr1.ownerCost).toBeGreaterThan(byId.b_wr4.ownerCost)
    expect(byId.b_wr4.ownerCost).toBe(0)
  })
  it('shows positive surplus for players worth more to me than to their owner', () => {
    for (const t of targets) expect(t.surplus).toBeGreaterThan(0)
  })
  it('names the slot the player would take over', () => {
    expect(targets.find((t) => t.id === 'b_wr1')!.slot).toBe('WR')
  })
  it('returns nothing rather than throwing when there is no horizon', () => {
    expect(findTargets({ slots: SLOTS, players, horizon: [], pts, me: A, others: [B], rosteredBy, capacity: 9, market })).toEqual([])
  })
})

describe('findTrades', () => {
  const { players, pts, horizon, A, B, market, replacement } = buildLeague()
  const base = { slots: SLOTS, players, horizon, pts, me: A, others: [B], capacity: 9, market }

  it('finds the swap that improves both lineups', () => {
    const ideas = findTrades(base)
    expect(ideas.length).toBeGreaterThan(0)
    for (const idea of ideas) {
      expect(idea.myGain).toBeGreaterThan(0)
      expect(idea.theirGain).toBeGreaterThan(0)
    }
    // Each side sends what its lineup cannot use and takes back what it can.
    const top = ideas[0]
    expect(top.get.some((id) => players[id].pos === 'WR')).toBe(true)
    expect(top.give.some((id) => players[id].pos === 'RB')).toBe(true)
    expect(
      ideas.some((i) => i.shape === 'one-for-one' && players[i.give[0]].pos === 'RB' && players[i.get[0]].pos === 'WR'),
    ).toBe(true)
  })

  it('says which of their slots the deal plugs', () => {
    const top = findTrades(base)[0]
    expect(top.fills?.slot).toBe('RB')
    expect(top.fills!.after).toBeGreaterThan(top.fills!.before)
  })

  it('reports what leaves separately from the net gain', () => {
    const ideas = findTrades(base)
    const cheap = ideas.find((i) => i.give.includes('a_rb4'))!
    // Their fourth running back never started, so sending him costs nothing
    // even though the deal itself is worth several points a week.
    expect(cheap.myCost).toBe(0)
    expect(cheap.myGain).toBeGreaterThan(0)
  })

  it('counts how many weeks the deal actually helps', () => {
    const top = findTrades(base)[0]
    expect(top.weeks).toBe(2)
    expect(top.weeksBetter).toBe(2)
    expect(top.perWeek.map((w) => w.week)).toEqual([1, 2])
  })

  it('trades off my gain against theirs across the results', () => {
    const ideas = findTrades(base)
    const best = [...ideas].sort((a, b) => b.myGain - a.myGain)[0]
    const easiest = [...ideas].sort((a, b) => b.theirGain - a.theirGain)[0]
    expect(best.myGain).toBeGreaterThan(easiest.myGain)
    expect(easiest.theirGain).toBeGreaterThan(best.theirGain)
  })

  it('refuses deals the other side would not take', () => {
    expect(findTrades({ ...base, config: { minTheirGain: 50 } })).toEqual([])
  })

  it('surfaces the one-sided ones once the bar for the other side drops', () => {
    const fair = findTrades(base)[0]
    const generous = findTrades({ ...base, config: { minTheirGain: -50, maxValueAsk: 99 } })[0]
    expect(generous.myGain).toBeGreaterThan(fair.myGain)
    expect(generous.theirGain).toBeLessThan(fair.theirGain)
  })

  it('drops lowballs when the premium asked is capped', () => {
    for (const idea of findTrades({ ...base, config: { minTheirGain: -50, maxValueAsk: 0 } })) {
      expect(idea.valueAsk).toBeLessThanOrEqual(0)
    }
  })

  it('respects the size caps on each side', () => {
    for (const idea of findTrades({ ...base, config: { maxGive: 1, maxGet: 1, minTheirGain: -50 } })) {
      expect(idea.shape).toBe('one-for-one')
    }
    for (const idea of findTrades({ ...base, config: { maxGive: 3, maxGet: 2, maxPlayers: 4, minTheirGain: -50 } })) {
      expect(idea.give.length).toBeLessThanOrEqual(3)
      expect(idea.get.length).toBeLessThanOrEqual(2)
      expect(idea.give.length + idea.get.length).toBeLessThanOrEqual(4)
    }
  })

  it('grows uneven deals when the extra piece earns its place', () => {
    // Their WR1 for your RB4 alone asks for more value than the cap allows;
    // adding a second piece is what makes it a fair offer.
    const shapes = new Set(findTrades({ ...base, config: { perPartner: 40 } }).map((i) => i.shape))
    expect(shapes.has('one-for-one')).toBe(true)
    expect(shapes.has('consolidate')).toBe(true)
    expect(shapes.has('swap')).toBe(true)
  })

  it('names who the side taking more bodies has to cut', () => {
    const ideas = findTrades({ ...base, config: { perPartner: 40 } })
    for (const i of ideas) {
      const theyTakeMore = i.give.length - i.get.length
      expect(i.theirCuts.length).toBe(Math.max(0, theyTakeMore))
      expect(i.myCuts.length).toBe(Math.max(0, -theyTakeMore))
      for (const id of i.theirCuts) expect(B.players).toContain(id)
    }
    const uneven = ideas.find((i) => i.give.length !== i.get.length)
    expect(uneven).toBeDefined()
  })

  it('does not pad a deal with bodies worth nothing to either side', () => {
    // b_spare is below replacement: asking for him only games the value check.
    for (const idea of findTrades({ ...base, config: { minTheirGain: -50 } })) {
      expect(idea.get).not.toContain('b_spare')
    }
  })

  it('only trades players the two rosters actually hold', () => {
    for (const idea of findTrades({ ...base, config: { maxGet: 2, minTheirGain: -50 } })) {
      for (const id of idea.get) expect(B.players).toContain(id)
      for (const id of idea.give) expect(A.players).toContain(id)
      expect(idea.get.some((id) => idea.give.includes(id))).toBe(false)
    }
  })

  it('charges a thin roster far less for a starter once waivers can cover the slot', () => {
    // Exactly enough players to fill the lineup, so losing one empties a slot.
    const thin = { rosterId: 3, players: ['b_qb', 'b_wr1', 'b_wr2', 'b_wr3', 'b_rb1', 'b_rb2', 'b_te'] }
    const rosteredBy = Object.fromEntries(thin.players.map((id) => [id, 3]))
    const ask = (floor?: Record<string, number>) =>
      findTargets({ slots: SLOTS, players, horizon, pts, me: A, others: [thin], rosteredBy, capacity: 9, market, floor })
        .find((t) => t.id === 'b_wr3')!.ownerCost
    // Their flex goes empty without him unless somebody can be picked up.
    expect(ask()).toBeGreaterThan(ask(replacement) * 2)
  })

  it('reports an empty list rather than throwing when there is nothing to project', () => {
    expect(findTrades({ ...base, horizon: [] })).toEqual([])
  })

  it('reports how many candidates each filter removed', () => {
    let seen: { combinations: number; scored: number } | null = null
    findTrades({ ...base, onFunnel: (f) => (seen = f) })
    expect(seen).not.toBeNull()
    expect(seen!.combinations).toBeGreaterThan(0)
    expect(seen!.scored).toBeGreaterThan(0)
  })
})

describe('scoreTrade', () => {
  const { players, pts, horizon, A, B, market } = buildLeague()
  const base = { slots: SLOTS, players, horizon, pts, me: A, partner: B, capacity: 9, market }
  it('prices a hand-built deal the same way the search does', () => {
    const idea = findTrades({ slots: SLOTS, players, horizon, pts, me: A, others: [B], capacity: 9, market })[0]
    const scored = scoreTrade({ ...base, give: idea.give, get: idea.get })!
    expect(scored.myGain).toBeCloseTo(idea.myGain, 2)
    expect(scored.theirGain).toBeCloseTo(idea.theirGain, 2)
    expect(scored.perWeek).toEqual(idea.perWeek)
  })
  it('scores lopsided offers honestly instead of filtering them', () => {
    const scored = scoreTrade({ ...base, give: ['a_spare'], get: ['b_wr1'] })!
    expect(scored.myGain).toBeGreaterThan(0)
    expect(scored.theirGain).toBeLessThan(0)
  })
  it('names the cut when a side takes back more bodies than it sends', () => {
    const scored = scoreTrade({ ...base, give: ['a_rb3'], get: ['b_wr3', 'b_wr4'] })!
    expect(scored.shape).toBe('depth')
    expect(scored.myCuts).toHaveLength(1)
  })
  it('returns nothing for an empty deal', () => {
    expect(scoreTrade({ ...base, give: [], get: [] })).toBeNull()
  })
})
