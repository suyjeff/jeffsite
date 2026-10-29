// localStorage, kept inside its quota.
//
// A browser gives a site about five million characters of localStorage, and the API cache (lib/fantasy/sleeper) is
// nearly all of what this page keeps: the player database alone is a million and a half, and every week of stats
// half a million more. Unchecked, by week 7 the cache had filled the quota, and every later write failed without a
// word: settings went unsaved and a reveal never stayed seen, so it opened again on every load. So the cache keeps to
// a budget, dropping its oldest responses first, and a write that matters makes room by dropping cache if it has to.

const CACHE = /^ff:v\d+:/

/** What the cache may hold, in characters (keys included): the rest of the quota stays free for everything else. */
export const CACHE_BUDGET = 3_000_000

type Entry = { size: number; t: number }
// Each cached response's size and age, read from storage once and kept up to date here, so a write does not read
// megabytes back to decide what to drop.
let index: Map<string, Entry> | null = null

const store = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** The time a cache entry was written: every entry starts `{"t":<ms>`. */
const stamp = (raw: string) => Number(/^\{"t":(\d+)/.exec(raw)?.[1] ?? 0)

const cacheIndex = (s: Storage) => {
  if (index) return index
  const out = new Map<string, Entry>()
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (!k || !CACHE.test(k)) continue
    const raw = s.getItem(k) ?? ''
    out.set(k, { size: k.length + raw.length, t: stamp(raw) })
  }
  index = out
  return out
}

const cacheTotal = (idx: Map<string, Entry>) => {
  let n = 0
  for (const e of idx.values()) n += e.size
  return n
}

/** Drops the oldest cached response (never `keep`); false when there is none left to drop. */
const dropOldest = (s: Storage, keep?: string) => {
  const idx = cacheIndex(s)
  let oldest: string | null = null
  for (const [k, e] of idx) if (k !== keep && (oldest == null || e.t < idx.get(oldest)!.t)) oldest = k
  if (oldest == null) return false
  s.removeItem(oldest)
  idx.delete(oldest)
  return true
}

/** Drops the oldest cached responses until the cache, with `extra` more characters, fits its budget. */
export const trimCache = (extra = 0, keep?: string) => {
  const s = store()
  if (!s) return
  try {
    const idx = cacheIndex(s)
    while (cacheTotal(idx) + extra > CACHE_BUDGET && dropOldest(s, keep));
  } catch {
    // Storage blocked: nothing to trim.
  }
}

/** Removes every key that matches (a whole cache version, say). */
export const removeStored = (match: (key: string) => boolean) => {
  const s = store()
  if (!s) return
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && match(k)) keys.push(k)
    }
    for (const k of keys) {
      s.removeItem(k)
      index?.delete(k)
    }
  } catch {
    // ignore
  }
}

/**
 * Keeps a cached response, within the cache's budget: older responses make way for it, and one too big for the budget
 * is not kept at all (it stays in memory for the visit). False when it was not kept.
 */
export const writeCached = (key: string, value: string) => {
  const s = store()
  if (!s) return false
  const size = key.length + value.length
  if (size > CACHE_BUDGET) return false
  try {
    const idx = cacheIndex(s)
    const had = idx.get(key)?.size ?? 0
    while (cacheTotal(idx) - had + size > CACHE_BUDGET && dropOldest(s, key));
    for (;;) {
      try {
        s.setItem(key, value)
        break
      } catch {
        // Over the browser's quota anyway (other keys, a smaller quota): drop more, or give up.
        if (!dropOldest(s, key)) return false
      }
    }
    idx.set(key, { size, t: stamp(value) || Date.now() })
    return true
  } catch {
    return false
  }
}

/**
 * Keeps a setting or a mark that must stick (a reveal seen, the tour done): when storage is full, cached responses
 * make room for it. False when it could not be kept (storage blocked).
 */
export const writeStored = (key: string, value: string) => {
  const s = store()
  if (!s) return false
  for (;;) {
    try {
      s.setItem(key, value)
      return true
    } catch {
      try {
        if (!dropOldest(s)) return false
      } catch {
        return false
      }
    }
  }
}
