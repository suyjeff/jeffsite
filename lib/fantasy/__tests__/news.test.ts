import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFantasyCache } from '../sleeper'
import { loadNews, mapNews, parsePlayerNews, parseSiteNews, stripHtml } from '../news'
import type { PlayerMap, TrimmedPlayer } from '../types'

// Written to the documented shapes of ESPN's fantasy player-news feed and its site news feed, not captured live.
const NOW = Date.parse('2026-10-10T18:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const fantasyFeed = {
  feed: [
    {
      id: 1001,
      headline: 'Chase (hip) misses practice',
      description: 'Short summary.',
      story: '<p>Ja&#39;Marr Chase did not practice Wednesday.</p><p>Watch for <b>Friday</b>&nbsp;updates &amp; more.</p>',
      published: hoursAgo(3),
      type: 'Rotowire',
      links: { web: { href: 'https://www.espn.com/nfl/player/news/_/id/1001' } },
      categories: [{ type: 'athlete', athleteId: 4362628 }, { type: 'team', teamId: 4 }],
    },
    { id: 1002, headline: 'Older note', published: hoursAgo(24 * 20), categories: [{ type: 'athlete', athleteId: 4362628 }] },
    { id: 1003, headline: '', published: hoursAgo(1), categories: [] },
    { id: 1004, headline: 'No date', categories: [] },
    null,
  ],
}

const siteFeed = {
  articles: [
    {
      headline: 'Chase (hip) misses practice',
      description: 'Same story, other feed.',
      published: hoursAgo(2.5),
      links: { web: { href: 'https://www.espn.com/nfl/story/_/id/9' } },
      categories: [{ type: 'athlete', athleteId: '4362628' }],
    },
    {
      headline: 'Burrow practices in full',
      description: 'Good sign.',
      published: hoursAgo(1),
      links: { web: { href: 'javascript:alert(1)' } },
      categories: [{ type: 'athlete', athleteId: 3915511 }, { type: 'athlete', athleteId: 4362628 }, { type: 'league' }],
    },
    { headline: 'League-wide piece', published: hoursAgo(5), categories: [{ type: 'league' }] },
  ],
}

const player = (id: string, espnId?: string): TrimmedPlayer => ({ id, name: id, pos: 'WR', fpos: ['WR'], team: 'CIN', status: 'Active', injury: null, age: 25, exp: 4, depth: 1, injuryBody: null, newsAt: null, ...(espnId ? { espnId } : {}) }) as TrimmedPlayer
const players: PlayerMap = { s1: player('s1', '4362628'), s2: player('s2', '3915511'), s3: player('s3') }

describe('stripHtml', () => {
  it('drops tags, decodes entities, collapses whitespace', () => {
    expect(stripHtml('<p>A &amp; B</p><p>C&nbsp;&nbsp;D &#39;e&#39; &#x2014;</p>')).toBe('A & B C D \'e\' —')
  })
  it('is safe on non-strings and leaves unknown entities alone', () => {
    expect(stripHtml(undefined)).toBe('')
    expect(stripHtml(42)).toBe('')
    expect(stripHtml('a &zzz; b')).toBe('a &zzz; b')
  })
  it('never leaves a tag behind', () => {
    expect(stripHtml('x<script>alert(1)</script>y')).toBe('xalert(1)y')
    expect(stripHtml('x<img src=x onerror=alert(1)>y')).toBe('xy')
  })
})

describe('parsePlayerNews', () => {
  const items = parsePlayerNews(fantasyFeed)
  it('keeps entries with a headline and a date, as plain text', () => {
    expect(items.map((i) => i.id)).toEqual(['1001', '1002'])
    expect(items[0]).toMatchObject({
      headline: 'Chase (hip) misses practice',
      body: "Ja'Marr Chase did not practice Wednesday. Watch for Friday updates & more.",
      at: Date.parse(hoursAgo(3)),
      url: 'https://www.espn.com/nfl/player/news/_/id/1001',
      source: 'ESPN',
      espnIds: ['4362628'],
    })
  })
  it('falls back to the description when there is no story', () => {
    expect(parsePlayerNews({ feed: [{ id: 1, headline: 'H', description: '<i>Just this.</i>', published: hoursAgo(1) }] })[0].body).toBe('Just this.')
  })
  it('returns nothing for a payload of the wrong shape', () => {
    for (const bad of [null, undefined, 'x', 3, {}, { feed: 'no' }, { feed: {} }]) expect(parsePlayerNews(bad)).toEqual([])
  })
})

describe('parseSiteNews', () => {
  const items = parseSiteNews(siteFeed)
  it('reads articles, tags athletes of either id type, and drops a non-ESPN link', () => {
    expect(items).toHaveLength(3)
    expect(items[0].espnIds).toEqual(['4362628'])
    expect(items[1].espnIds).toEqual(['3915511', '4362628'])
    expect(items[1].url).toBeNull()
    expect(items[2].espnIds).toEqual([])
  })
  it('returns nothing for a payload of the wrong shape', () => {
    for (const bad of [null, {}, { articles: 'x' }, []]) expect(parseSiteNews(bad)).toEqual([])
  })
})

describe('mapNews', () => {
  const raw = [...parsePlayerNews(fantasyFeed), ...parseSiteNews(siteFeed)]
  const out = mapNews(raw, players, NOW)
  it('maps by ESPN id to Sleeper id, newest first, one item per story', () => {
    expect(out.s1.map((i) => i.headline)).toEqual(['Burrow practices in full', 'Chase (hip) misses practice'])
    expect(out.s1[1].id).toBe('1001') // the first copy of a repeated headline wins
    expect(out.s2.map((i) => i.headline)).toEqual(['Burrow practices in full'])
  })
  it('drops stale items, untagged items and players with no ESPN id', () => {
    expect(out.s1.some((i) => i.id === '1002')).toBe(false)
    expect(out.s3).toBeUndefined()
    expect(Object.keys(out).sort()).toEqual(['s1', 's2'])
  })
})

describe('loadNews', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => clearFantasyCache())
  const stubFetch = (handler: (url: string) => { ok: boolean; body?: unknown } | Promise<never>) =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const r = await handler(url)
      return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body }
    }))

  // The fixtures are dated against NOW; loadNews reads the real clock, so re-stamp them as an hour old.
  const restamp = (f: unknown) => JSON.parse(JSON.stringify(f).replace(/"published":"[^"]+"/g, `"published":"${new Date(Date.now() - 3600_000).toISOString()}"`))

  it('merges the per-player and general feeds, asking ESPN per player', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      return { ok: true, body: restamp(url.includes('/fantasy/') ? fantasyFeed : siteFeed) }
    })
    const out = await loadNews(['s1', 's3'], players)
    expect(Object.keys(out)).toEqual(['s1'])
    expect(out.s1.map((i) => i.headline).sort()).toEqual(['Burrow practices in full', 'Chase (hip) misses practice', 'Older note'])
    expect(urls.filter((u) => u.includes('playerId=4362628'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('playerId=')).length).toBe(1) // s3 has no ESPN id, so no request for him
  })

  it('shares one request between callers and serves repeats from cache', async () => {
    const f = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => restamp(fantasyFeed) }))
    vi.stubGlobal('fetch', f)
    await Promise.all([loadNews(['s1'], players), loadNews(['s1'], players)])
    await loadNews(['s1'], players)
    expect(f.mock.calls.filter(([u]) => String(u).includes('/fantasy/'))).toHaveLength(1)
  })

  it('resolves empty, never rejects, when ESPN is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('blocked')) as Promise<never>)
    expect(await loadNews(['s2'], players)).toEqual({})
    stubFetch(() => ({ ok: false }))
    expect(await loadNews(['s2'], players)).toEqual({})
  })
})
