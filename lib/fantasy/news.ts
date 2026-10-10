import { cached } from './sleeper'
import type { PlayerMap } from './types'

/**
 * Player news with words in it. Sleeper only says when news landed; ESPN's public site API carries the headline and
 * the write-up. It is a nicety: every request here may be blocked or change shape, and a failure means no item, so
 * callers fall back to the Sleeper flag.
 */

export type NewsItem = {
  id: string
  headline: string
  /** Plain text: the write-up, or the summary when there is no write-up. May be empty. */
  body: string
  /** Published (ms since epoch). */
  at: number
  url: string | null
  source: string
}

/** A parsed ESPN entry before it is tied to a Sleeper player. */
export type RawNews = NewsItem & { espnIds: string[] }

const SOURCE = 'ESPN'
const BASE = 'https://site.api.espn.com/apis'
const MINUTE = 60_000
export const NEWS_TTL = 20 * MINUTE
/** ESPN keeps old stories on a player's feed; a week old is history, not news. */
export const NEWS_MAX_AGE = 7 * 24 * 3600_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' }

/** Plain text from a string that may carry HTML. Never rendered as markup, so this only has to read well. */
export const stripHtml = (s: unknown): string => {
  if (typeof s !== 'string') return ''
  return s
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const when = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : 0
}

/** Only web links to ESPN are kept, so a malformed or hostile href never becomes a clickable link. */
const webUrl = (v: unknown): string | null => {
  const href = str((v as { web?: { href?: unknown } } | undefined)?.web?.href)
  return /^https?:\/\/([a-z0-9-]+\.)*espn\.com(\/|$)/i.test(href) ? href : null
}

const athletes = (categories: unknown): string[] => {
  if (!Array.isArray(categories)) return []
  const out: string[] = []
  for (const c of categories as { type?: unknown; athleteId?: unknown; athlete?: { id?: unknown } }[]) {
    if (!c || c.type !== 'athlete') continue
    const id = c.athleteId ?? c.athlete?.id
    if ((typeof id === 'number' || typeof id === 'string') && String(id)) out.push(String(id))
  }
  return out
}

const entry = (e: Record<string, unknown>): RawNews | null => {
  const headline = stripHtml(e.headline)
  const at = when(e.published) || when(e.lastModified)
  if (!headline || !at) return null
  // The fantasy feed puts the write-up in `story`; the site feed has only a one-line `description`.
  const body = stripHtml(e.story) || stripHtml(e.description)
  // The site feed has no ids; a story is told apart by what it says and when.
  const id = e.id != null && String(e.id) ? String(e.id) : `${at}:${headline}`
  return { id, headline, body, at, url: webUrl(e.links), source: SOURCE, espnIds: athletes(e.categories) }
}

/** The fantasy player-news feed: `{ feed: [...] }`. */
export const parsePlayerNews = (json: unknown): RawNews[] => {
  const feed = (json as { feed?: unknown } | null)?.feed
  if (!Array.isArray(feed)) return []
  return feed.flatMap((e) => {
    const r = e && typeof e === 'object' ? entry(e as Record<string, unknown>) : null
    return r ? [r] : []
  })
}

/** The general NFL news feed: `{ articles: [...] }`. */
export const parseSiteNews = (json: unknown): RawNews[] => {
  const articles = (json as { articles?: unknown } | null)?.articles
  if (!Array.isArray(articles)) return []
  return articles.flatMap((e) => {
    const r = e && typeof e === 'object' ? entry(e as Record<string, unknown>) : null
    return r ? [r] : []
  })
}

/**
 * Raw ESPN items tied to Sleeper players through `espnId`, newest first and without repeats. `espnIds` limits
 * who can match: an item naming three players lands on each of them that is asked about.
 */
export const mapNews = (raw: RawNews[], players: PlayerMap, now = Date.now()): Record<string, NewsItem[]> => {
  const byEspn = new Map<string, string>()
  for (const p of Object.values(players)) if (p.espnId) byEspn.set(p.espnId, p.id)
  const out: Record<string, NewsItem[]> = {}
  const seen = new Set<string>()
  for (const r of raw) {
    if (now - r.at > NEWS_MAX_AGE) continue
    const { espnIds, ...item } = r
    for (const e of espnIds) {
      const sid = byEspn.get(e)
      if (!sid) continue
      // The same story can come from both feeds under different ids, so the headline counts too.
      const k = `${sid}:${item.headline.toLowerCase()}`
      if (seen.has(k) || seen.has(`${sid}:#${item.id}`)) continue
      seen.add(k)
      seen.add(`${sid}:#${item.id}`)
      ;(out[sid] ??= []).push(item)
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.at - a.at)
  return out
}

// ---------- Fetching ----------

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return res.json()
}

// Three views can ask for the same feed at once (Overview, Moves, a player's sheet), so they share one request.
// It is not abortable for the same reason: one view leaving must not cancel another's.
const inflight = new Map<string, Promise<RawNews[]>>()
const once = (key: string, load: () => Promise<RawNews[]>) => {
  let p = inflight.get(key)
  if (!p) {
    p = cached<RawNews[]>(key, NEWS_TTL, load).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/** One player's feed from the fantasy API. Throws on failure, so a failure is never cached as "no news". */
const loadPlayerFeed = (espnId: string) =>
  once(
    `news:p:${espnId}`,
    async () => parsePlayerNews(await getJson(`${BASE}/fantasy/v2/games/ffl/news/players?limit=50&playerId=${encodeURIComponent(espnId)}`)),
  )

/** The league-wide feed, which also catches players the per-player feed lags on. */
const loadSiteFeed = () =>
  once(`news:site`, async () => parseSiteNews(await getJson(`${BASE}/site/v2/sports/football/nfl/news?limit=50`)))

/** Run `fn` over `xs`, at most `limit` at a time. Each result is its own (a failure becomes null). */
const pool = async <T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<(R | null)[]> => {
  const out: (R | null)[] = new Array(xs.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < xs.length) {
      const i = next++
      try {
        out[i] = await fn(xs[i])
      } catch {
        out[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker))
  return out
}

/**
 * Latest ESPN news for these Sleeper players, by Sleeper id. A player with no ESPN id, or whose request failed, is
 * simply absent. Resolves with whatever arrived; never rejects. An item counts for a player only when ESPN tags him
 * on it, so a feed that ignores the player filter cannot hand one player another's news.
 */
export const loadNews = async (ids: string[], players: PlayerMap): Promise<Record<string, NewsItem[]>> => {
  const asked = ids.filter((id) => players[id]?.espnId)
  if (!asked.length) return {}
  const [site, feeds] = await Promise.all([
    loadSiteFeed().catch(() => [] as RawNews[]),
    pool(asked, 6, (id) => loadPlayerFeed(players[id].espnId as string)),
  ])
  const wanted: PlayerMap = {}
  for (const id of asked) wanted[id] = players[id]
  return mapNews([...site, ...feeds.flatMap((f) => f ?? [])], wanted)
}
