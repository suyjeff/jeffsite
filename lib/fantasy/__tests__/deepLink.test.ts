import { describe, expect, it } from 'vitest'
import { deepLinkUrl, parseDeepLink } from '../../../components/fantasy/useDeepLink'

describe('parseDeepLink', () => {
  it('reads a shared link: the league and the week', () => {
    expect(parseDeepLink('?league=1398004152843419648&reveal=5')).toEqual({ league: '1398004152843419648', season: null, week: 5 })
    expect(parseDeepLink('?league=abc&reveal=12')).toEqual({ league: 'abc', season: null, week: 12 })
    expect(parseDeepLink('?league=abc&season=2025&reveal=12')).toEqual({ league: 'abc', season: '2025', week: 12 })
    expect(parseDeepLink('?league=abc&season=nope&reveal=12')).toEqual({ league: 'abc', season: null, week: 12 })
  })
  it('keeps a bare reveal=1 as "the latest", and writes week 1 as 01', () => {
    expect(parseDeepLink('?reveal=1')).toEqual({ league: null, season: null, week: 'latest' })
    expect(parseDeepLink('?reveal=')).toEqual({ league: null, season: null, week: 'latest' })
    expect(parseDeepLink('?reveal=latest')).toEqual({ league: null, season: null, week: 'latest' })
    expect(parseDeepLink('?league=abc&reveal=01')).toEqual({ league: 'abc', season: null, week: 1 })
    expect(deepLinkUrl('abc', 1)).toBe('https://sujeff.com/fantasy?league=abc&reveal=01#power')
    expect(deepLinkUrl('abc', 7)).toBe('https://sujeff.com/fantasy?league=abc&reveal=7#power')
    expect(deepLinkUrl('abc', 7, '2026')).toBe('https://sujeff.com/fantasy?league=abc&season=2026&reveal=7#power')
  })
  it('takes a league alone, ignores a bad one, and finds nothing in other queries', () => {
    expect(parseDeepLink('?league=abc')).toEqual({ league: 'abc', season: null, week: null })
    expect(parseDeepLink('?league=a b&reveal=3')).toEqual({ league: null, season: null, week: 3 })
    expect(parseDeepLink('?x=1')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})
