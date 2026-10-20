import { describe, expect, it } from 'vitest'
import { deepLinkUrl, parseDeepLink } from '../../../components/fantasy/useDeepLink'

describe('parseDeepLink', () => {
  it('reads a shared link: the league and the week', () => {
    expect(parseDeepLink('?league=1398004152843419648&reveal=5')).toEqual({ league: '1398004152843419648', week: 5 })
    expect(parseDeepLink('?league=abc&reveal=12')).toEqual({ league: 'abc', week: 12 })
  })
  it('keeps a bare reveal=1 as "the latest", and writes week 1 as 01', () => {
    expect(parseDeepLink('?reveal=1')).toEqual({ league: null, week: 'latest' })
    expect(parseDeepLink('?reveal=')).toEqual({ league: null, week: 'latest' })
    expect(parseDeepLink('?reveal=latest')).toEqual({ league: null, week: 'latest' })
    expect(parseDeepLink('?league=abc&reveal=01')).toEqual({ league: 'abc', week: 1 })
    expect(deepLinkUrl('abc', 1)).toBe('https://sujeff.com/fantasy?league=abc&reveal=01#power')
    expect(deepLinkUrl('abc', 7)).toBe('https://sujeff.com/fantasy?league=abc&reveal=7#power')
  })
  it('takes a league alone, ignores a bad one, and finds nothing in other queries', () => {
    expect(parseDeepLink('?league=abc')).toEqual({ league: 'abc', week: null })
    expect(parseDeepLink('?league=a b&reveal=3')).toEqual({ league: null, week: 3 })
    expect(parseDeepLink('?x=1')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})
