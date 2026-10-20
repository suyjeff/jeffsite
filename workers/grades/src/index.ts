// Shared trade grades for the fantasy app: browsers post their grades, and read back what the
// league's other browsers have learned. One KV namespace (GRADES):
//
//   c:<league>:<client>   one browser's grades in a league. Written only by that browser, and its
//                         metadata carries the residual total {s, n} so a listing can sum it unread.
//   snap:l:<league>       the league's browsers added up, rebuilt at most every 10 minutes
//   snap:g                every browser's residual total, rebuilt at most every 30 minutes
//
// There is no running aggregate to keep in step: a post touches only its own key, and the two
// snapshots are always overwritten whole, so concurrent posts cannot lose each other's grades.

import { allowed, limited, send } from './common'
import { handlePost as handleShare, serve as serveShare, type ShareKV } from './share'
import { cleanGrade, clientKey, clientOf, contribute, LIMITS, priorFor, type Contribution, type StoredGrade, type Sum } from './aggregate'

export interface Env {
  GRADES: ShareKV
}

const LEAGUE = /^[A-Za-z0-9:_.-]{1,64}$/
const CLIENT = /^[A-Za-z0-9-]{8,64}$/
const MAX_BODY = 40_000
const MAX_PER_POST = 60
const LEAGUE_TTL = 10 * 60_000
const GLOBAL_TTL = 30 * 60_000
/** Listing pages read when summing every browser; keeps a rebuild inside the subrequest limit. */
const GLOBAL_PAGES = 5

type Snapshot<T> = { at: number; data: T }

const getJson = async <T>(env: Env, key: string, fallback: T): Promise<T> => {
  try {
    const v = await env.GRADES.get(key, 'json')
    return (v as T | null) ?? fallback
  } catch {
    return fallback
  }
}

/** A snapshot from KV when it is fresh, otherwise rebuilt and written over whole. Stale data beats an error. */
const snapshot = async <T>(env: Env, key: string, ttl: number, build: () => Promise<T>): Promise<T> => {
  const hit = await getJson<Snapshot<T> | null>(env, key, null)
  if (hit && Date.now() - hit.at < ttl) return hit.data
  try {
    const data = await build()
    // KV's shortest expiry is 60s; the longer one just lets an idle league's snapshot clean itself up.
    await env.GRADES.put(key, JSON.stringify({ at: Date.now(), data } satisfies Snapshot<T>), { expirationTtl: Math.max(60, Math.ceil((ttl * 6) / 1000)) })
    return data
  } catch {
    if (hit) return hit.data
    throw new Error('snapshot')
  }
}

const listAll = async (env: Env, prefix: string, pages: number) => {
  const keys: { name: string; metadata?: unknown }[] = []
  let cursor: string | undefined
  for (let i = 0; i < pages; i++) {
    const r = await env.GRADES.list({ prefix, cursor })
    keys.push(...r.keys)
    if (r.list_complete) break
    cursor = r.cursor
  }
  return keys
}

const buildLeague = async (env: Env, league: string): Promise<Record<string, Contribution>> => {
  const keys = (await listAll(env, `c:${league}:`, 1)).filter((k) => clientOf(k.name, league))
  const out: Record<string, Contribution> = {}
  await Promise.all(
    keys.slice(0, LIMITS.clientsPerLeague).map(async (k) => {
      const mine = await getJson<Record<string, StoredGrade>>(env, k.name, {})
      out[clientOf(k.name, league)!] = contribute(Object.values(mine), 0)
    }),
  )
  return out
}

const buildGlobal = async (env: Env): Promise<Record<string, Sum>> => {
  const out: Record<string, Sum> = {}
  for (const k of await listAll(env, 'c:', GLOBAL_PAGES)) {
    const m = k.metadata as { s?: number; n?: number } | null
    if (m && Number.isFinite(m.s) && Number.isFinite(m.n)) out[k.name] = { sum: m.s as number, n: m.n as number }
  }
  return out
}

async function post(req: Request, env: Env, origin: string): Promise<Response> {
  const text = await req.text()
  if (text.length > MAX_BODY) return send({ error: 'too large' }, 413, origin)
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return send({ error: 'bad json' }, 400, origin)
  }
  const { league, client } = body ?? {}
  if (typeof league !== 'string' || !LEAGUE.test(league)) return send({ error: 'bad league' }, 400, origin)
  if (typeof client !== 'string' || !CLIENT.test(client)) return send({ error: 'bad client' }, 400, origin)
  const incoming: unknown[] = Array.isArray(body.grades) ? body.grades.slice(0, MAX_PER_POST) : []
  const remove: unknown[] = Array.isArray(body.remove) ? body.remove.slice(0, MAX_PER_POST) : []
  const fresh = incoming.map(cleanGrade).filter((g): g is StoredGrade => !!g)
  if (incoming.length && !fresh.length && !remove.length) return send({ error: 'no valid grades' }, 400, origin)

  const ckey = clientKey(league, client)
  const mine = await getJson<Record<string, StoredGrade>>(env, ckey, {})
  // Dedupe: one grade per deal per browser. A regrade replaces; a removal deletes.
  for (const g of fresh) mine[g.key] = g
  for (const k of remove) if (typeof k === 'string') delete mine[k]
  // Keep the newest if a browser somehow holds more than the cap.
  const all = Object.values(mine)
  if (all.length > LIMITS.perClient) {
    all.sort((a, b) => b.at - a.at)
    for (const g of all.slice(LIMITS.perClient)) delete mine[g.key]
  }
  // This browser's key is the only thing a post writes.
  if (Object.keys(mine).length) {
    const total = contribute(Object.values(mine)).all
    await env.GRADES.put(ckey, JSON.stringify(mine), { metadata: { s: Math.round(total.sum * 1e4) / 1e4, n: total.n } })
  } else await env.GRADES.delete(ckey)
  return send({ ok: true, stored: Object.keys(mine).length }, 200, origin)
}

async function prior(url: URL, env: Env, origin: string): Promise<Response> {
  const league = url.searchParams.get('league') ?? ''
  if (!LEAGUE.test(league)) return send({ error: 'bad league' }, 400, origin)
  const client = url.searchParams.get('client') ?? undefined
  if (client !== undefined && !CLIENT.test(client)) return send({ error: 'bad client' }, 400, origin)
  const vRaw = url.searchParams.get('v')
  const v = vRaw !== null && /^\d{1,3}$/.test(vRaw) ? Number(vRaw) : undefined
  const [clients, sums] = await Promise.all([
    snapshot(env, `snap:l:${league}`, LEAGUE_TTL, () => buildLeague(env, league)),
    snapshot(env, 'snap:g', GLOBAL_TTL, () => buildGlobal(env)),
  ])
  return send(priorFor(clients, sums, client, league, v), 200, origin)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    // Shared links are opened by link-preview bots and by people on any site, so they sit outside the CORS gate below.
    if (url.pathname.startsWith('/s/') && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        return await serveShare(req, env)
      } catch {
        return new Response('Server error', { status: 500 })
      }
    }
    const origin = allowed(req.headers.get('origin'))
    if (req.method === 'OPTIONS') return send(null, origin ? 204 : 403, origin)
    if (!origin) return send({ error: 'origin not allowed' }, 403, null)
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    try {
      if (url.pathname === '/share' && req.method === 'POST') return await handleShare(req, env, origin, ip)
      if (url.pathname === '/grades' && req.method === 'POST') {
        if (limited(`p:${ip}`, 30)) return send({ error: 'slow down' }, 429, origin, { 'retry-after': '60' })
        return await post(req, env, origin)
      }
      if (url.pathname === '/prior' && req.method === 'GET') {
        if (limited(`g:${ip}`, 120)) return send({ error: 'slow down' }, 429, origin, { 'retry-after': '60' })
        return await prior(url, env, origin)
      }
    } catch {
      return send({ error: 'server error' }, 500, origin)
    }
    return send({ error: 'not found' }, 404, origin)
  },
}
