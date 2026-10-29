import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A localStorage with a quota, in characters (keys included), like a browser's.
const fakeStorage = (quota: number) => {
  const m = new Map<string, string>()
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + v.length > quota) throw new DOMException('full', 'QuotaExceededError')
      m.set(k, v)
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

const entry = (t: number, size: number) => JSON.stringify({ t, data: 'x'.repeat(size) })

describe('storage within its quota', () => {
  let store: ReturnType<typeof fakeStorage>
  let mod: typeof import('../storage')
  beforeEach(async () => {
    vi.resetModules()
    store = fakeStorage(5_000_000)
    vi.stubGlobal('window', { localStorage: store })
    mod = await import('../storage')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the cache inside its budget, dropping the oldest first', () => {
    for (let i = 0; i < 8; i++) expect(mod.writeCached(`ff:v3:week${i}`, entry(1000 + i, 600_000))).toBe(true)
    let cache = 0
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)!
      cache += k.length + store.getItem(k)!.length
    }
    expect(cache).toBeLessThanOrEqual(mod.CACHE_BUDGET)
    expect(store.getItem('ff:v3:week0')).toBeNull()
    expect(store.getItem('ff:v3:week7')).not.toBeNull()
  })

  it('makes room for a mark that must stick when a cache from before the budget filled storage', () => {
    // Filled to the brim before this page kept a budget.
    for (let i = 0; i < 9; i++) store.setItem(`ff:v3:week${i}`, entry(1000 + i, 550_000))
    let used = 0
    for (let i = 0; i < store.length; i++) used += store.key(i)!.length + store.getItem(store.key(i)!)!.length
    store.setItem('ff:v3:pad', entry(2000, 5_000_000 - used - 'ff:v3:pad'.length - entry(2000, 0).length))
    expect(() => store.setItem('ff:reveal:L:2026:7', '1')).toThrow()
    expect(mod.writeStored('ff:reveal:L:2026:7', '1')).toBe(true)
    expect(store.getItem('ff:reveal:L:2026:7')).toBe('1')
    expect(store.getItem('ff:v3:week0')).toBeNull()
    expect(store.getItem('ff:v3:week8')).not.toBeNull()
  })

  it('brings an overfull cache back under on load, never touching settings', () => {
    store.setItem('ff:prefs', '{"onboarded":true}')
    for (let i = 0; i < 8; i++) store.setItem(`ff:v3:week${i}`, entry(1000 + i, 550_000))
    mod.trimCache()
    expect(store.getItem('ff:prefs')).toBe('{"onboarded":true}')
    let cache = 0
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)!
      if (k.startsWith('ff:v3:')) cache += k.length + store.getItem(k)!.length
    }
    expect(cache).toBeLessThanOrEqual(mod.CACHE_BUDGET)
  })

  it('does not keep a response bigger than the whole budget', () => {
    expect(mod.writeCached('ff:v3:huge', entry(1, mod.CACHE_BUDGET))).toBe(false)
    expect(store.getItem('ff:v3:huge')).toBeNull()
  })
})
