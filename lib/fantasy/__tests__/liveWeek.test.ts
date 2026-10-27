import { describe, expect, it } from 'vitest'
import { FEED_TTL } from '../gameTime'
import { calendarSig, feedFrom, freshGames, freshMatchups, shouldPoll, weekGames, weekOn, weekSettled } from '../liveWeek'
import { parseScoreboard, type Broadcast } from '../nfl'
import { buildSlate, DEFAULT_CV } from '../slate'
import type { PlayerMap, SleeperMatchup } from '../types'

// Sunday Oct 25 2026 (Eastern daylight time, UTC−4). DET@ARI kicks off at 1 PM ET; BAL@ATL is the night game at 8:20.
const at = (iso: string) => Date.parse(iso)
const KICK_EARLY = at('2026-10-25T17:00:00Z')
const KICK_NIGHT = at('2026-10-26T00:20:00Z')
const PAGE_LOAD = at('2026-10-25T16:00:00Z') // noon ET, before anything kicked off
const NIGHT = at('2026-10-26T00:27:00Z') // 8:27 PM ET: the reported bug, UTC already Monday

const P = (id: string, pos: string, team: string) => ({ id, name: id, pos, fpos: [pos], team, status: null, injury: null, age: null, exp: null })
const players = { a1: P('a1', 'QB', 'DET'), a2: P('a2', 'WR', 'BAL'), b1: P('b1', 'QB', 'BAL'), b2: P('b2', 'RB', 'DET') } as unknown as PlayerMap
// Sleeper's schedule as the page loaded it: nothing started yet.
const schedule = [
  { week: 7, home: 'ARI', away: 'DET', status: 'pre_game', date: '2026-10-25' },
  { week: 7, home: 'ATL', away: 'BAL', status: 'pre_game', date: '2026-10-25' },
]
const m = (roster_id: number, starters: string[], pts: Record<string, number> = {}): SleeperMatchup => ({ roster_id, matchup_id: 1, points: 0, players: starters, starters, players_points: pts })
const pageMatchups = [m(1, ['a1', 'a2']), m(2, ['b1', 'b2'])]
const liveMatchups = [m(1, ['a1', 'a2'], { a1: 24, a2: 3 }), m(2, ['b1', 'b2'], { b1: 6, b2: 11 })]

// ESPN's scoreboard at 8:26 PM ET, stamped as the reader stamps it: the early game over, the night game in its first quarter.
const espnAt = (t: number): Record<string, Broadcast> => ({
  'DET@ARI': { networks: [], state: 'post', start: KICK_EARLY, at: t, ended: Math.min(t, KICK_EARLY + 5 * 3600_000), away: 27, home: 20 },
  'BAL@ATL': { networks: [], state: 'in', start: KICK_NIGHT, at: t, clock: 'Q1 8:00', elapsed: 7 / 60, away: 3, home: 0 },
})

const base = {
  week: 7,
  players,
  lineups: {},
  proj: { a1: 20, a2: 14, b1: 18, b2: 12 },
  cv: DEFAULT_CV,
  sigma: 20,
  totals: {},
  stakes: null,
}

/** What useSlate does with the live reads, as one function of the clock. */
const slateAt = (now: number, reads: { casts?: Record<string, Broadcast>; live?: { matchups: SleeperMatchup[]; at: number } | null; games?: typeof schedule | null; actuals?: { pts: Record<string, number>; at: number } | null }) => {
  const games = freshGames(weekGames(schedule, 7), reads.games ?? null)
  const clock = feedFrom(reads.casts ?? {}, now)
  const points = freshMatchups(pageMatchups, reads.live ?? null, PAGE_LOAD)
  return buildSlate({ ...base, games, matchups: points.matchups, pointsAt: points.at, actuals: reads.actuals ?? null, feed: clock.feed, elapsed: clock.elapsed, now })
}

describe('Sunday night, 8:27 PM Eastern, with the night game on', () => {
  it('settles the early game on fresh points and keeps the night game live with its projection', () => {
    const s = slateAt(NIGHT, { casts: espnAt(NIGHT - 60_000), live: { matchups: liveMatchups, at: NIGHT - 30_000 }, games: schedule })
    const early = s.games.find((g) => g.home === 'ARI')!
    const night = s.games.find((g) => g.home === 'ATL')!
    expect(early.final).toBe(true)
    expect(night.final).toBe(false)
    expect(night.live).toBe(true)
    expect(s.byId.a1.actual).toBe(24)
    expect(s.byId.b2.actual).toBe(11)
    expect(s.byId.a2.live).toBe(3)
    // The night game's points so far plus what is left of its projection, by the clock: 7 minutes of 60 played.
    expect(s.byId.a2.expect).toBeCloseTo(3 + 14 * (53 / 60), 6)
    expect(s.matchups[0].a.left).toBe(1)
    expect(s.matchups[0].pA).toBeGreaterThan(0.01)
    expect(s.matchups[0].pA).toBeLessThan(0.99)
  })

  it('does not settle a finished game on points read before it ended', () => {
    // The live reads failed all day: only the page's noon copy, all zeros.
    const s = slateAt(NIGHT, { casts: espnAt(NIGHT - 60_000), live: null })
    const early = s.games.find((g) => g.home === 'ARI')!
    expect(early.final).toBe(false)
    expect(early.live).toBe(true)
    expect(s.byId.a1.actual).toBeNull()
    // Still counted at his projection's worth, not a zero.
    expect(s.byId.a1.expect).toBeGreaterThan(0)
    expect(s.matchups[0].pA).toBeGreaterThan(0.01)
    expect(s.matchups[0].pA).toBeLessThan(0.99)
  })

  it('takes the stats feed when it is fresher than the matchups', () => {
    const s = slateAt(NIGHT, { casts: espnAt(NIGHT - 60_000), live: { matchups: liveMatchups, at: NIGHT - 90_000 }, actuals: { pts: { a1: 25.5 }, at: NIGHT - 10_000 } })
    expect(s.byId.a1.actual).toBe(25.5)
    expect(s.byId.b2.actual).toBe(11)
  })

  it('ignores a feed that has gone quiet, and Sleeper and the calendar decide', () => {
    const quiet = espnAt(NIGHT - FEED_TTL - 60_000)
    expect(feedFrom(quiet, NIGHT).sig).toBe('')
    const s = slateAt(NIGHT, { casts: quiet, live: { matchups: liveMatchups, at: NIGHT - 30_000 } })
    // Sleeper still says pre_game and the calendar keeps Sunday open: nothing final, both games on by their points.
    expect(s.games.some((g) => g.final)).toBe(false)
    expect(s.byId.a1.live).toBe(24)
    // With Sleeper's fresh schedule calling the early game complete, it settles.
    const done = slateAt(NIGHT, { casts: quiet, live: { matchups: liveMatchups, at: NIGHT - 30_000 }, games: [{ ...schedule[0], status: 'complete' }, { ...schedule[1], status: 'in_game' }] })
    expect(done.games.find((g) => g.home === 'ARI')!.final).toBe(true)
    expect(done.games.find((g) => g.home === 'ATL')!.live).toBe(true)
  })

  it('closes the day at 4 AM Eastern with no feed and no change in the reads', () => {
    const before = at('2026-10-26T07:59:00Z')
    const after = at('2026-10-26T08:01:00Z')
    const games = weekGames(schedule, 7)
    expect(calendarSig(games, before)).not.toBe(calendarSig(games, after))
    const reads = { live: { matchups: liveMatchups, at: NIGHT } }
    expect(slateAt(before, reads).games.every((g) => g.final)).toBe(false)
    expect(slateAt(after, reads).games.every((g) => g.final)).toBe(true)
  })

  it('lets the calendar close a game Sleeper has left in_game, a day after', () => {
    const stuck = [schedule[0], { ...schedule[1], status: 'in_game' }]
    const reads = { live: { matchups: liveMatchups, at: NIGHT }, games: stuck }
    expect(slateAt(at('2026-10-26T12:00:00Z'), reads).games.find((g) => g.home === 'ATL')!.final).toBe(false)
    expect(slateAt(at('2026-10-27T08:05:00Z'), reads).games.find((g) => g.home === 'ATL')!.final).toBe(true)
  })
})

describe('when to read the week again', () => {
  const games = weekGames(schedule, 7)
  it('polls through the game day and stops once every game is over', () => {
    expect(shouldPoll(games, {}, at('2026-10-25T16:50:00Z'))).toBe(true) // game day, Sleeper's date
    expect(shouldPoll(games, espnAt(NIGHT), NIGHT)).toBe(true) // the night game is on
    const over = espnAt(at('2026-10-26T03:40:00Z'))
    over['BAL@ATL'] = { ...over['BAL@ATL'], state: 'post', clock: undefined, elapsed: undefined }
    expect(shouldPoll(games, over, at('2026-10-26T03:41:00Z'))).toBe(false)
    expect(shouldPoll(games, {}, at('2026-10-23T16:00:00Z'))).toBe(false) // a Friday
  })
  it('keeps polling a game ESPN has rescheduled, around its new kickoff', () => {
    const moved = at('2026-10-27T23:00:00Z') // Tuesday night
    const casts: Record<string, Broadcast> = { 'BAL@ATL': { networks: [], state: 'pre', start: moved, at: moved - 20 * 60_000 } }
    expect(shouldPoll([games[1]], casts, moved - 10 * 60_000)).toBe(true)
    expect(shouldPoll([games[1]], casts, moved - 3 * 3600_000)).toBe(false)
  })
  it('asks at all once the week has a game today or one played', () => {
    expect(weekOn(games, {}, at('2026-10-23T16:00:00Z'))).toBe(false)
    expect(weekOn(games, {}, at('2026-10-25T12:00:00Z'))).toBe(true)
    expect(weekOn(games, {}, at('2026-10-28T12:00:00Z'))).toBe(true) // the week is over; its box scores still load
  })
  it('keeps the week as final only once Sleeper agrees, or two hours after ESPN saw the last game end', () => {
    const end = at('2026-10-26T03:40:00Z')
    const over = espnAt(end)
    over['BAL@ATL'] = { ...over['BAL@ATL'], state: 'post', ended: end }
    expect(weekSettled(games, over, end + 30 * 60_000)).toBe(false)
    expect(weekSettled(games, { ...over, 'BAL@ATL': { ...over['BAL@ATL'], at: end + 2 * 3600_000 }, 'DET@ARI': { ...over['DET@ARI'], at: end + 2 * 3600_000 } }, end + 2 * 3600_000 + 60_000)).toBe(true)
    expect(weekSettled(games.map((g) => ({ ...g, status: 'complete' })), {}, end)).toBe(true)
  })
  it('only lets a newer read of the matchups replace the page copy', () => {
    expect(freshMatchups(pageMatchups, { matchups: liveMatchups, at: PAGE_LOAD - 1 }, PAGE_LOAD).matchups).toBe(pageMatchups)
    expect(freshMatchups(pageMatchups, { matchups: liveMatchups, at: PAGE_LOAD + 1 }, PAGE_LOAD).matchups).toBe(liveMatchups)
  })
})

describe('ESPN scoreboard states', () => {
  const event = (type: Record<string, unknown>) => ({
    date: '2026-10-25T17:00Z',
    competitions: [{ competitors: [{ homeAway: 'home', score: '0', team: { abbreviation: 'ARI' } }, { homeAway: 'away', score: '0', team: { abbreviation: 'DET' } }], status: { type } }],
  })
  it('reads a game as over only when ESPN calls it complete', () => {
    expect(parseScoreboard({ events: [event({ state: 'post', name: 'STATUS_FINAL', completed: true })] })['DET@ARI'].state).toBe('post')
    expect(parseScoreboard({ events: [event({ state: 'post', name: 'STATUS_FINAL_OVERTIME' })] })['DET@ARI'].state).toBe('post')
    expect(parseScoreboard({ events: [event({ state: 'post', name: 'STATUS_POSTPONED', completed: false })] })['DET@ARI'].state).toBe('pre')
    expect(parseScoreboard({ events: [event({ state: 'post', name: 'STATUS_CANCELED', completed: false })] })['DET@ARI'].state).toBe('pre')
    expect(parseScoreboard({ events: [event({ state: 'post', name: 'STATUS_FINAL', completed: true })] })['DET@ARI'].start).toBe(KICK_EARLY)
  })
})
