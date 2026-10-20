// @vitest-environment node
import { describe, expect, it } from 'vitest'
import worker from '../../../workers/grades/src/index'
import { appUrl, checkPng, MAX_PNG, newId, parseMeta, TTL_SECONDS } from '../../../workers/grades/src/share'

// A fake of the one KV namespace, keeping what was put and how long it was told to live.
const fakeKV = () => {
  const store = new Map<string, { value: string | ArrayBuffer; ttl?: number }>()
  return {
    store,
    async get(key: string, type?: string) {
      const hit = store.get(key)
      if (!hit) return null
      if (type === 'json') return JSON.parse(hit.value as string)
      return hit.value
    },
    async put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number }) {
      store.set(key, { value, ttl: opts?.expirationTtl })
    },
    async list() {
      return { keys: [], list_complete: true }
    },
    async delete() {},
  }
}

/** The bytes of a PNG with the preview card's header and trailer; the pixels are not needed to be checked. */
const png = (w = 1200, h = 630, pad = 0) => {
  const out = new Uint8Array(8 + 25 + pad + 12)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const dv = new DataView(out.buffer)
  dv.setUint32(8, 13)
  out.set([0x49, 0x48, 0x44, 0x52], 12)
  dv.setUint32(16, w)
  dv.setUint32(20, h)
  out.set([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], out.length - 12)
  return out
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

const meta = (over: Record<string, unknown> = {}) => ({
  league: 'NYC Fantasy Football',
  leagueId: '1234567890',
  week: 5,
  season: '2026',
  title: 'NYC Fantasy Football · Power Rank, Week 5',
  description: '1. Show me your TDs 60.2 ▲2 · 2. Emillionaires 58.4 ▼1 · 3. bababanik 56.9 ▲2',
  provider: 'sleeper',
  top: [
    { rank: 1, name: 'Show me your TDs', score: 60.2, move: 2 },
    { rank: 2, name: 'Emillionaires', score: 58.4, move: -1 },
  ],
  ...over,
})

let n = 0
const post = (env: { GRADES: ReturnType<typeof fakeKV> }, body: unknown, init: { origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) =>
  worker.fetch(
    new Request('https://ff-grades.example.workers.dev/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: init.origin === undefined ? 'https://sujeff.com' : (init.origin ?? ''), 'cf-connecting-ip': init.ip ?? `10.0.0.${++n}`, ...(init.headers ?? {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env as never,
  )
const get = (env: { GRADES: ReturnType<typeof fakeKV> }, path: string, ua = 'Mozilla/5.0 (iPhone) Safari') => worker.fetch(new Request(`https://ff-grades.example.workers.dev${path}`, { headers: { 'user-agent': ua } }), env as never)

describe('checkPng', () => {
  it('takes a PNG of the card size and nothing else', () => {
    expect(checkPng(png())).toEqual({ w: 1200, h: 630 })
    expect(checkPng(png(1200, 600))).toBe('wrong size')
    expect(checkPng(png(630, 1200))).toBe('wrong size')
    const jpg = png()
    jpg[1] = 0x4a
    expect(checkPng(jpg)).toBe('not a png')
    expect(checkPng(new Uint8Array(10))).toBe('not a png')
    expect(checkPng(png(1200, 630, MAX_PNG))).toBe('png too large')
    const cut = png()
    cut[cut.length - 1] = 0
    expect(checkPng(cut)).toBe('truncated png')
  })
})

describe('parseMeta', () => {
  it('keeps what is valid and caps every string', () => {
    expect(parseMeta(meta())).toMatchObject({ league: 'NYC Fantasy Football', week: 5, top: [{ rank: 1 }, { rank: 2 }] })
    expect(parseMeta(meta({ league: 'x'.repeat(81) }))).toBe('bad league')
    expect(parseMeta(meta({ title: 'x'.repeat(121) }))).toBe('bad title')
    expect(parseMeta(meta({ description: 'x'.repeat(301) }))).toBe('bad description')
    expect(parseMeta(meta({ leagueId: 'a b' }))).toBe('bad leagueId')
    expect(parseMeta(meta({ leagueId: 'x'.repeat(65) }))).toBe('bad leagueId')
    expect(parseMeta(meta({ week: 0 }))).toBe('bad week')
    expect(parseMeta(meta({ week: 2.5 }))).toBe('bad week')
    expect(parseMeta(meta({ season: 'abc' }))).toBe('bad season')
    expect(parseMeta(meta({ provider: 'yahoo' }))).toBe('bad provider')
    expect(parseMeta(meta({ top: [] }))).toBe('bad top')
    expect(parseMeta(meta({ top: Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, name: 'a', score: 1, move: 0 })) }))).toBe('bad top')
    expect(parseMeta(meta({ top: [{ rank: 1, name: 'x'.repeat(61), score: 1, move: 0 }] }))).toBe('bad top')
    expect(parseMeta(meta({ top: [{ rank: 1, name: 'a', score: Infinity, move: 0 }] }))).toBe('bad top')
    expect(parseMeta('nope')).toBe('bad meta')
  })
  it('turns control characters into spaces', () => {
    const m = parseMeta(meta({ league: 'A\nB\u0000C' })) as { league: string }
    expect(m.league).toBe('A B C')
  })
})

describe('newId', () => {
  it('is long, url-safe and not repeated', () => {
    const ids = new Set(Array.from({ length: 200 }, newId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{14}$/)
  })
})

describe('POST /share', () => {
  it('stores the card and the facts for 120 days and returns an id', async () => {
    const env = { GRADES: fakeKV() }
    const r = await post(env, { meta: meta(), png: b64(png()) })
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBe('https://sujeff.com')
    const { id, url } = (await r.json()) as { id: string; url: string }
    expect(id).toMatch(/^[A-Za-z0-9]{10,}$/)
    expect(url).toBe(`https://ff-grades.example.workers.dev/s/${id}`)
    expect(env.GRADES.store.get(`s:${id}`)?.ttl).toBe(TTL_SECONDS)
    expect(env.GRADES.store.get(`s:${id}:png`)?.ttl).toBe(TTL_SECONDS)
    expect((env.GRADES.store.get(`s:${id}:png`)?.value as ArrayBuffer).byteLength).toBe(png().length)
  })
  it('takes a multipart form as well', async () => {
    const env = { GRADES: fakeKV() }
    const form = new FormData()
    form.set('meta', JSON.stringify(meta()))
    form.set('png', new Blob([png() as BlobPart], { type: 'image/png' }), 'card.png')
    const r = await worker.fetch(new Request('https://x.workers.dev/share', { method: 'POST', headers: { origin: 'http://localhost:3200', 'cf-connecting-ip': '9.9.9.9' }, body: form }), env as never)
    expect(r.status).toBe(200)
    expect(env.GRADES.store.size).toBe(2)
  })
  it('refuses other origins, bad pictures and bad facts, and stores nothing', async () => {
    const env = { GRADES: fakeKV() }
    expect((await post(env, { meta: meta(), png: b64(png()) }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(env, { meta: meta(), png: b64(png()) }, { origin: null })).status).toBe(403)
    expect((await post(env, { meta: meta(), png: b64(png(800, 400)) })).status).toBe(400)
    expect((await post(env, { meta: meta(), png: b64(png(1200, 630, MAX_PNG)) })).status).toBe(413)
    expect((await post(env, { meta: meta({ week: 99 }), png: b64(png()) })).status).toBe(400)
    expect((await post(env, { meta: meta(), png: '!!!not base64!!!' })).status).toBe(400)
    expect((await post(env, 'not json')).status).toBe(400)
    expect((await post(env, { meta: meta(), png: 'A'.repeat(900_000) })).status).toBe(413)
    expect(env.GRADES.store.size).toBe(0)
  })
  it('slows down one address', async () => {
    const env = { GRADES: fakeKV() }
    const codes: number[] = []
    for (let i = 0; i < 8; i++) codes.push((await post(env, { meta: meta(), png: b64(png()) }, { ip: '7.7.7.7' })).status)
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true)
    expect(codes.slice(6)).toEqual([429, 429])
  })
})

describe('GET /s/:id', () => {
  const stored = async (over: Record<string, unknown> = {}) => {
    const env = { GRADES: fakeKV() }
    const r = await post(env, { meta: meta(over), png: b64(png()) })
    const { id } = (await r.json()) as { id: string }
    return { env, id }
  }
  it('gives link-preview bots the Open Graph page, with no redirect', async () => {
    const { env, id } = await stored()
    for (const ua of ['facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'WhatsApp/2.23', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0', 'Mozilla/5.0 (Macintosh) Applebot/0.1']) {
      const r = await get(env, `/s/${id}`, ua)
      expect(r.status).toBe(200)
      expect(r.headers.get('location')).toBeNull()
      const html = await r.text()
      expect(html).toContain('<meta property="og:title" content="NYC Fantasy Football · Power Rank, Week 5">')
      expect(html).toContain(`<meta property="og:image" content="https://ff-grades.example.workers.dev/s/${id}.png">`)
      expect(html).toContain('<meta property="og:image:width" content="1200">')
      expect(html).toContain('<meta property="og:image:height" content="630">')
      expect(html).toContain(`<meta property="og:url" content="https://ff-grades.example.workers.dev/s/${id}">`)
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
      expect(html).toContain('<meta name="theme-color"')
      expect(html).toContain('>Open Power Rank</a>')
      expect(html).toContain('location.replace(')
      expect(html).not.toContain('http-equiv')
    }
  })
  it('sends people on to the app, which asks for their name first', async () => {
    const { env, id } = await stored()
    const r = await get(env, `/s/${id}`)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://sujeff.com/fantasy?league=1234567890&reveal=5#power')
    // Week 1 is written 01: a bare 1 already means "the latest week".
    expect(appUrl({ leagueId: 'abc', week: 1 })).toBe('https://sujeff.com/fantasy?league=abc&reveal=01#power')
  })
  it('escapes everything it prints', async () => {
    const { env, id } = await stored({ league: '<script>alert(1)</script>', title: '"><img src=x onerror=alert(1)>', description: "a & b </script><script>x('1')", top: [{ rank: 1, name: '<b>x</b>', score: 1, move: 0 }] })
    const html = await (await get(env, `/s/${id}`, 'Slackbot')).text()
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain("</script><script>x(")
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;&gt;&lt;img')
    expect(html.match(/<script>/g)?.length).toBe(1)
  })
  it('serves the card for a year, to anyone', async () => {
    const { env, id } = await stored()
    const r = await get(env, `/s/${id}.png`, 'Slackbot')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toContain('max-age=31536000')
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(png().length)
  })
  it('answers 404 to bots and the app to people when the link is gone or never was', async () => {
    const env = { GRADES: fakeKV() }
    expect((await get(env, '/s/abcdefghij1234', 'Slackbot')).status).toBe(404)
    const r = await get(env, '/s/abcdefghij1234')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://sujeff.com/fantasy#power')
    expect((await get(env, '/s/abcdefghij1234.png')).status).toBe(404)
    expect((await get(env, '/s/short')).status).toBe(404)
  })
})

describe('the other endpoints', () => {
  it('keep their origin gate and answer an unknown path with 404', async () => {
    const env = { GRADES: fakeKV() }
    const r = await worker.fetch(new Request('https://x.workers.dev/nope', { headers: { origin: 'https://sujeff.com' } }), env as never)
    expect(r.status).toBe(404)
    const bad = await worker.fetch(new Request('https://x.workers.dev/prior?league=a', { headers: { origin: 'https://evil.example' } }), env as never)
    expect(bad.status).toBe(403)
    const pre = await worker.fetch(new Request('https://x.workers.dev/share', { method: 'OPTIONS', headers: { origin: 'https://sujeff.com' } }), env as never)
    expect(pre.status).toBe(204)
  })
})
