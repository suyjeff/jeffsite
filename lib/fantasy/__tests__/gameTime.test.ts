import { describe, expect, it } from 'vitest'
import { etDay, FEED_TTL, gameIsFinal, gameIsLive, longPastByCalendar, pastByCalendar, readFeed } from '../gameTime'

// Sunday Oct 25 2026 is in daylight time (UTC−4); Sunday Nov 8 2026 is in standard time (UTC−5).
const at = (iso: string) => Date.parse(iso)

describe('etDay', () => {
  it('reads the Eastern date, not the UTC one', () => {
    // 8:27 PM Sunday Eastern is already Monday in UTC.
    expect(etDay(at('2026-10-26T00:27:00Z'))).toBe('2026-10-25')
    expect(etDay(at('2026-11-09T01:30:00Z'))).toBe('2026-11-08')
    // Zero-padded, whatever the month.
    expect(etDay(at('2027-01-05T17:00:00Z'))).toBe('2027-01-05')
  })
})

describe('pastByCalendar', () => {
  const sunday = '2026-10-25'
  it('keeps Sunday games open through Sunday night Eastern', () => {
    expect(pastByCalendar(sunday, at('2026-10-26T00:27:00Z'))).toBe(false) // 8:27 PM ET, the reported bug
    expect(pastByCalendar(sunday, at('2026-10-26T04:30:00Z'))).toBe(false) // 12:30 AM ET, a night game in overtime
    expect(pastByCalendar(sunday, at('2026-10-26T07:59:00Z'))).toBe(false) // 3:59 AM ET
  })
  it('closes them at 4 AM Eastern the next day', () => {
    expect(pastByCalendar(sunday, at('2026-10-26T08:01:00Z'))).toBe(true)
  })
  it('follows standard time too', () => {
    expect(pastByCalendar('2026-11-08', at('2026-11-09T08:59:00Z'))).toBe(false) // 3:59 AM EST
    expect(pastByCalendar('2026-11-08', at('2026-11-09T09:01:00Z'))).toBe(true)
  })
  it('needs a date', () => {
    expect(pastByCalendar(undefined, at('2027-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('gameIsFinal', () => {
  const sundayNight = at('2026-10-26T00:27:00Z')
  const game = (status: string) => ({ status, date: '2026-10-25' })
  const fresh = (state: 'pre' | 'in' | 'post') => ({ state, at: sundayNight - 60_000 })
  const stale = (state: 'pre' | 'in' | 'post') => ({ state, at: sundayNight - FEED_TTL - 60_000 })
  it('never calls a game final while it is on', () => {
    expect(gameIsFinal(game('pre_game'), undefined, sundayNight)).toBe(false)
    expect(gameIsFinal(game('in_game'), undefined, at('2026-10-26T12:00:00Z'))).toBe(false)
    expect(gameIsFinal(game('complete'), fresh('in'), sundayNight)).toBe(false)
  })
  it('lets a feed that has gone quiet fall back to Sleeper and the calendar', () => {
    expect(readFeed(stale('in'), sundayNight)).toBeUndefined()
    expect(gameIsFinal(game('complete'), stale('in'), sundayNight)).toBe(true)
    expect(gameIsFinal(game('pre_game'), stale('in'), at('2026-10-26T12:00:00Z'))).toBe(true)
    expect(gameIsLive(game('pre_game'), stale('in'), sundayNight)).toBe(false)
  })
  it('holds a postponed game open while ESPN reads it not started, however old its date', () => {
    const later = at('2026-10-28T12:00:00Z')
    expect(gameIsFinal(game('pre_game'), { state: 'pre', at: later - 60_000 }, later)).toBe(false)
  })
  it('lets the calendar close a game a day past its close even if Sleeper still says in_game', () => {
    expect(longPastByCalendar('2026-10-25', at('2026-10-27T07:59:00Z'))).toBe(false)
    expect(gameIsFinal(game('in_game'), undefined, at('2026-10-27T07:59:00Z'))).toBe(false)
    expect(gameIsFinal(game('in_game'), undefined, at('2026-10-27T08:01:00Z'))).toBe(true)
    expect(gameIsLive(game('in_game'), undefined, at('2026-10-27T08:01:00Z'))).toBe(false)
  })
  it('takes ESPN, then Sleeper, then the calendar', () => {
    expect(gameIsFinal(game('pre_game'), 'post', sundayNight)).toBe(true)
    expect(gameIsFinal(game('complete'), undefined, sundayNight)).toBe(true)
    expect(gameIsFinal(game('pre_game'), undefined, at('2026-10-26T12:00:00Z'))).toBe(true)
  })
})

describe('gameIsLive', () => {
  it('reads either feed, and ESPN over a lagging Sleeper', () => {
    expect(gameIsLive({ status: 'pre_game' }, 'in')).toBe(true)
    expect(gameIsLive({ status: 'in_game' }, undefined)).toBe(true)
    expect(gameIsLive({ status: 'in_game' }, 'post')).toBe(false)
    expect(gameIsLive({ status: 'pre_game' }, undefined)).toBe(false)
  })
})
