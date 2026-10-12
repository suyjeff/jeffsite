// Shared trade grades for the fantasy app: browsers post their grades, and read back what the
// league's other browsers have learned. One KV namespace (GRADES), three kinds of key:
//
//   c:<league>:<client>   one browser's grades in a league, by deal
//   l:<league>            that league's per-browser contributions (see aggregate.ts)
//   g                     the running total of residuals across every league
//
// A post rewrites its own browser's grades, then adjusts the league and global totals by the
// difference. A read is two gets and some addition.

import { cleanGrade, contribute, LIMITS, moveGlobal, priorFor, type Contribution, type StoredGrade, type Sum } from './aggregate'

export interface Env {
  GRADES: KVNamespace
}

const ORIGINS = [/^https:\/\/sujeff\.com$/, /^http:\/\/localhost(:\d+)?$/]
const LEAGUE = /^[A-Za-z0-9:_.-]{1,64}$/
const CLIENT = /^[A-Za-z0-9-]{8,64}$/
const MAX_BODY = 40_000
const MAX_PER_POST = 60

const allowed = (origin: string | null) => (origin && ORIGINS.some((r) => r.test(origin)) ? origin : null)

const send = (body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : { vary: 'origin' }),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extra,
    },
  })

// A per-IP limit kept in the isolate's memory: free, and good enough to blunt a loop. It resets when
// the isolate does, so it is a speed bump and not a guarantee.
const hits = new Map<string, number[]>()
const limited = (ip: string, max: number, windowMs = 60_000) => {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) for (const [k, ts] of hits) if (!ts.some((t) => now - t < windowMs)) hits.delete(k)
  return recent.length > max
}

type LeagueAgg = { clients: Record<string, Contribution> }

const getJson = async <T>(env: Env, key: string, fallback: T): Promise<T> => {
  try {
    const v = await env.GRADES.get(key, 'json')
    return (v as T | null) ?? fallback
  } catch {
    return fallback
  }
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

  const ckey = `c:${league}:${client}`
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
  const next = contribute(Object.values(mine), Date.now())

  const lkey = `l:${league}`
  const agg = await getJson<LeagueAgg>(env, lkey, { clients: {} })
  const before = agg.clients[client]
  if (Object.keys(mine).length) agg.clients[client] = next
  else delete agg.clients[client]
  const ids = Object.keys(agg.clients)
  if (ids.length > LIMITS.clientsPerLeague) {
    ids.sort((a, b) => agg.clients[a].at - agg.clients[b].at)
    for (const id of ids.slice(0, ids.length - LIMITS.clientsPerLeague)) delete agg.clients[id]
  }
  const g = await getJson<Sum>(env, 'g', { sum: 0, n: 0 })
  const moved = moveGlobal(g, before, Object.keys(mine).length ? next : { all: { sum: 0, n: 0 }, partners: {}, at: 0 })

  await Promise.all([
    Object.keys(mine).length ? env.GRADES.put(ckey, JSON.stringify(mine)) : env.GRADES.delete(ckey),
    env.GRADES.put(lkey, JSON.stringify(agg)),
    env.GRADES.put('g', JSON.stringify(moved)),
  ])
  return send({ ok: true, stored: Object.keys(mine).length }, 200, origin)
}

async function prior(url: URL, env: Env, origin: string): Promise<Response> {
  const league = url.searchParams.get('league') ?? ''
  if (!LEAGUE.test(league)) return send({ error: 'bad league' }, 400, origin)
  const client = url.searchParams.get('client') ?? undefined
  if (client !== undefined && !CLIENT.test(client)) return send({ error: 'bad client' }, 400, origin)
  const vRaw = url.searchParams.get('v')
  const v = vRaw !== null && /^\d{1,3}$/.test(vRaw) ? Number(vRaw) : undefined
  const [agg, g] = await Promise.all([getJson<LeagueAgg>(env, `l:${league}`, { clients: {} }), getJson<Sum>(env, 'g', { sum: 0, n: 0 })])
  return send(priorFor(agg.clients, g, client, v), 200, origin)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = allowed(req.headers.get('origin'))
    if (req.method === 'OPTIONS') return send(null, origin ? 204 : 403, origin)
    if (!origin) return send({ error: 'origin not allowed' }, 403, null)
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const url = new URL(req.url)
    try {
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
