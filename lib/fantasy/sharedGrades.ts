// Everyone's grades, folded into your trade odds, through a tiny worker (workers/grades).
//
// It only runs when NEXT_PUBLIC_FF_GRADES_URL is set at build time. Unset, every function here does
// nothing and the app behaves as if grades were only ever kept in this browser.
//
//   sending   when you grade, the deal goes to the worker as roster ids and numbers (a hash of the
//             deal, the manager's roster id, your grade and reason, the model's odds, the ask) with
//             a random id for this browser. No names, usernames or accounts.
//   reading   the worker returns what the league's other browsers learned, with yours left out so a
//             grade is never counted twice. It is cached for an hour and blended in by learn():
//             your own grades dominate and the shared lessons count for less as they thin out.

import { useEffect, useState } from 'react'
import { PRICING_VERSION } from './currency'
import type { Grades } from './grades'
import { writeStored } from './storage'

/** What the worker returns: other browsers' grades, summed (workers/grades/src/aggregate.ts `Prior`). */
export type SharedPrior = {
  global: { sum: number; n: number }
  partners: Record<string, { sum: number; n: number; dormant: number; untouchable: string[]; askCap: number | null }>
  clients: number
}

/** The worker's address, read when needed so the unset case stays a no-op. */
export const sharedUrl = (): string | null => {
  const u = (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_FF_GRADES_URL : '') ?? ''
  return u.trim().replace(/\/+$/, '') || null
}
export const sharingOn = () => sharedUrl() !== null

// ---- Blending ----
// The residuals are on the log-odds scale. Your own grades count in full; the shared mean counts as
// a few grades' worth at most, however many others there are, and fewer the more you have graded, so a
// league full of other people's opinions can tilt a team you have never graded but never outvote what you have.

/** The most grades' worth of a team's shared lessons, and how much each other grade counts. */
const PARTNER_CAP = 8
const PARTNER_WEIGHT = 0.5
/** The same for the all-leagues shift, which says less about any one team. */
const GLOBAL_CAP = 24
const GLOBAL_WEIGHT = 0.25
/** Other browsers who must agree before a manager counts as checked out. */
export const SHARED_DORMANT_MIN = 2

/** Others' grades as a few of your own, fewer the more of your own there are: n_shared capped, then faded by k / (k + yours). */
const pseudo = (n: number, cap: number, w: number, yours: number, k: number) => Math.min(Math.max(n, 0), cap) * w * (k / (k + yours))

/** A manager's offset from your residuals (sum over n), with the league's other grades as a few extra. */
export const blendOffset = (sum: number, n: number, shared?: { sum: number; n: number } | null) => {
  const m = shared && shared.n > 0 ? pseudo(shared.n, PARTNER_CAP, PARTNER_WEIGHT, n, 3) : 0
  const mean = shared && shared.n > 0 ? shared.sum / shared.n : 0
  return (sum + mean * m) / (n + m + 2)
}

/** The league-wide shift from your residuals (sum over n), with every league's other grades as a few extra. */
export const blendGlobal = (sum: number, n: number, shared?: { sum: number; n: number } | null) => {
  const m = shared && shared.n > 0 ? pseudo(shared.n, GLOBAL_CAP, GLOBAL_WEIGHT, n, 8) : 0
  const mean = shared && shared.n > 0 ? shared.sum / shared.n : 0
  return n + m > 0 ? (sum + mean * m) / (n + m + 6) : 0
}

// ---- Ids ----

const CLIENT_KEY = 'ff:grades:client:v1'

/** A random id for this browser, kept so a regrade replaces rather than adds. */
export const clientId = (): string => {
  try {
    let id = window.localStorage.getItem(CLIENT_KEY)
    if (id && /^[A-Za-z0-9-]{8,64}$/.test(id)) return id
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('')
    writeStored(CLIENT_KEY, id)
    return id
  } catch {
    return ''
  }
}

/** A deal key as a short hash, so the worker never sees which players were in it. */
export const hashKey = (key: string): string => {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b + c, 0x85ebca6b) >>> 0
    b ^= b >>> 13
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

// ---- Sending ----

const SENT_KEY = (league: string) => `ff:grades:sent:v1:${league}`
const read = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(window.localStorage.getItem(key) ?? 'null') as T | null) ?? fallback
  } catch {
    return fallback
  }
}
// Storage blocked: the grades are simply sent again next time.
const write = (key: string, v: unknown) => writeStored(key, JSON.stringify(v))

/** The grades not yet sent, and the hashes sent that are no longer graded. Pure. */
export const pending = (grades: Grades, sent: Record<string, number>) => {
  const send: Record<string, unknown>[] = []
  const now = new Set<string>()
  for (const [k, r] of Object.entries(grades)) {
    const key = hashKey(k)
    now.add(key)
    if (sent[key] === r.at) continue
    send.push({
      key,
      partnerId: r.partnerId,
      grade: r.grade,
      ...(r.why ? { why: r.why } : {}),
      ...(r.why === 'untouchable' && r.player ? { player: r.player } : {}),
      x: Math.round(r.x * 1000) / 1000,
      ask: r.ask == null ? null : Math.round(r.ask * 1000) / 1000,
      ...(r.v != null ? { v: r.v } : {}),
      at: r.at,
    })
  }
  const remove = Object.keys(sent).filter((k) => !now.has(k))
  return { send, remove }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const BATCH = 50

const flush = async (league: string, grades: Grades) => {
  const base = sharedUrl()
  const client = clientId()
  if (!base || !client) return
  const sent = read<Record<string, number>>(SENT_KEY(league), {})
  const { send, remove } = pending(grades, sent)
  while (send.length || remove.length) {
    const batch = send.splice(0, BATCH)
    const gone = remove.splice(0, BATCH)
    try {
      const res = await fetch(`${base}/grades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ league, client, grades: batch, remove: gone }),
        keepalive: true,
      })
      if (!res.ok) return
    } catch {
      return
    }
    for (const g of batch) sent[g.key as string] = g.at as number
    for (const k of gone) delete sent[k]
    write(SENT_KEY(league), sent)
  }
}

/** Share what changed in your grades, a moment after the last change. Fire and forget; never throws. */
export const shareGrades = (league: string, grades: Grades) => {
  if (!sharingOn() || typeof window === 'undefined' || !league) return
  clearTimeout(timers.get(league))
  timers.set(
    league,
    setTimeout(() => {
      timers.delete(league)
      flush(league, grades).catch(() => {})
    }, 1200),
  )
}

// ---- Reading ----

const PRIOR_TTL = 60 * 60 * 1000
const PRIOR_KEY = (league: string) => `ff:grades:prior:v1:${league}`
const memory = new Map<string, { at: number; prior: SharedPrior }>()

const valid = (p: unknown): p is SharedPrior => {
  const x = p as SharedPrior | null
  return !!x && typeof x === 'object' && !!x.global && typeof x.global.sum === 'number' && typeof x.global.n === 'number' && !!x.partners && typeof x.partners === 'object'
}

/** The cached prior for a league, fresh or not. */
export const cachedPrior = (league: string): { at: number; prior: SharedPrior } | null => {
  const m = memory.get(league)
  if (m) return m
  const s = read<{ at: number; prior: SharedPrior } | null>(PRIOR_KEY(league), null)
  if (s && typeof s.at === 'number' && valid(s.prior)) {
    memory.set(league, s)
    return s
  }
  return null
}

/** What other browsers have learned, from the cache when it is under an hour old. Null when sharing is off or the worker is unreachable. */
export const fetchPrior = async (league: string, force = false): Promise<SharedPrior | null> => {
  const base = sharedUrl()
  if (!base || typeof window === 'undefined' || !league) return null
  const hit = cachedPrior(league)
  if (hit && !force && Date.now() - hit.at < PRIOR_TTL) return hit.prior
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 6000)
    const q = new URLSearchParams({ league, client: clientId(), v: String(PRICING_VERSION) })
    const res = await fetch(`${base}/prior?${q}`, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return hit?.prior ?? null
    const prior = (await res.json()) as unknown
    if (!valid(prior)) return hit?.prior ?? null
    const entry = { at: Date.now(), prior }
    memory.set(league, entry)
    write(PRIOR_KEY(league), entry)
    return prior
  } catch {
    return hit?.prior ?? null
  }
}

/** The league's shared prior for use in learn(); null until it arrives, and always null when sharing is off. */
export const useSharedPrior = (league: string | null): SharedPrior | null => {
  const on = sharingOn()
  const [state, setState] = useState<{ league: string; prior: SharedPrior } | null>(null)
  useEffect(() => {
    if (!on || !league) return
    let live = true
    const hit = cachedPrior(league)
    if (hit) setState({ league, prior: hit.prior })
    fetchPrior(league).then((prior) => live && prior && setState({ league, prior }))
    return () => {
      live = false
    }
  }, [on, league])
  return on && league && state?.league === league ? state.prior : null
}
