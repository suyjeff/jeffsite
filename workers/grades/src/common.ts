// What the worker's endpoints share: which sites may call it, the JSON reply with its CORS headers, and the per-IP limit.

const ORIGINS = [/^https:\/\/sujeff\.com$/, /^http:\/\/localhost(:\d+)?$/]

export const allowed = (origin: string | null) => (origin && ORIGINS.some((r) => r.test(origin)) ? origin : null)

export const send = (body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) =>
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
export const limited = (ip: string, max: number, windowMs = 60_000) => {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) for (const [k, ts] of hits) if (!ts.some((t) => now - t < windowMs)) hits.delete(k)
  return recent.length > max
}

