// Link previews for the Power Rank reveal. The site is a static export, so a shared ranking cannot carry its own
// Open Graph tags; this worker holds them instead. The app posts a 1200×630 card and a few facts about the ranking,
// and gets back a short link. Opened by a link-preview bot (iMessage, Slack, Discord...) the link answers with a page
// of Open Graph tags and the card; opened by a person it sends them on to the app, which asks for their fantasy name
// as usual before it shows the week.
//
//   s:<id>      the facts, as JSON
//   s:<id>:png  the card
//
// Both expire after 120 days; nothing here names a user, only the league and teams already in the ranking.

import { limited, send } from './common'
import { appUrl, LEAGUE_ID, SITE } from './links'

/** The slice of Workers KV the worker uses, so it can be run against a fake. */
export interface ShareKV {
  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void>
  delete(key: string): Promise<void>
  list(opts: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>
}
export type ShareEnv = { GRADES: ShareKV }

export { appUrl, SITE }
export const TTL_SECONDS = 120 * 24 * 60 * 60
export const MAX_PNG = 400 * 1024
export const CARD = { w: 1200, h: 630 }
/** Cap on the whole request: the card, its base64 if sent that way, and the facts. */
const MAX_BODY = Math.ceil((MAX_PNG * 4) / 3) + 20_000
/** The facts alone are a few hundred bytes; this is room for five long names. */
const MAX_META = 4_000

const ID = /^[A-Za-z0-9]{10,32}$/
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_END = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
/** The unfurlers that get a page of tags instead of a redirect: known by name, so a browser never lands on one. */
const BOTS = /facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|Applebot|Pinterest|redditbot|Embedly|Iframely|SkypeUriPreview|Google-PageRenderer|vkShare|Mastodon/i

export type ShareMeta = {
  league: string
  leagueId: string
  week: number
  season: string
  title: string
  description: string
  provider: 'sleeper' | 'espn'
  top: { rank: number; name: string; score: number; move: number }[]
}

// Strings are cut of control characters and measured after, so a cap means what it says.
const clean = (v: unknown, max: number, min = 1): string | null => {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return s.length >= min && s.length <= max ? s : null
}
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null)

/** The facts, or why they were refused. Every field is checked; nothing is passed through unread. */
export const parseMeta = (raw: unknown): ShareMeta | string => {
  if (!raw || typeof raw !== 'object') return 'bad meta'
  const m = raw as Record<string, unknown>
  const league = clean(m.league, 80)
  const title = clean(m.title, 120)
  const description = clean(m.description, 300)
  const week = int(m.week, 1, 30)
  const leagueId = typeof m.leagueId === 'string' && LEAGUE_ID.test(m.leagueId) ? m.leagueId : null
  const season = typeof m.season === 'string' ? m.season : typeof m.season === 'number' ? String(m.season) : null
  const provider = m.provider === 'espn' ? 'espn' : m.provider === 'sleeper' ? 'sleeper' : null
  if (!league) return 'bad league'
  if (!leagueId) return 'bad leagueId'
  if (week == null) return 'bad week'
  if (!season || !/^\d{4}$/.test(season)) return 'bad season'
  if (!title) return 'bad title'
  if (!description) return 'bad description'
  if (!provider) return 'bad provider'
  if (!Array.isArray(m.top) || m.top.length < 1 || m.top.length > 5) return 'bad top'
  const top: ShareMeta['top'] = []
  for (const t of m.top) {
    const r = t as Record<string, unknown> | null
    const name = clean(r?.name, 60)
    const rank = int(r?.rank, 1, 64)
    const move = int(r?.move, -64, 64)
    const score = typeof r?.score === 'number' && Number.isFinite(r.score) && r.score >= -1000 && r.score <= 1000 ? Math.round(r.score * 100) / 100 : null
    if (!name || rank == null || move == null || score == null) return 'bad top'
    top.push({ rank, name, score, move })
  }
  return { league, leagueId, week, season, title, description, provider, top }
}

const bytesAt = (b: Uint8Array, at: number, want: number[]) => want.every((x, i) => b[at + i] === x)

/** The picture's dimensions when it is a PNG of the size the preview card is, else why not. */
export const checkPng = (png: Uint8Array): { w: number; h: number } | string => {
  if (png.length > MAX_PNG) return 'png too large'
  if (png.length < 33 || !bytesAt(png, 0, PNG_SIGNATURE)) return 'not a png'
  // The first chunk must be IHDR, whose first two fields are the width and height.
  if (!bytesAt(png, 12, [0x49, 0x48, 0x44, 0x52])) return 'not a png'
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const w = dv.getUint32(16)
  const h = dv.getUint32(20)
  if (w !== CARD.w || h !== CARD.h) return 'wrong size'
  if (!bytesAt(png, png.length - PNG_END.length, PNG_END)) return 'truncated png'
  return { w, h }
}

const unbase64 = (s: string): Uint8Array | null => {
  try {
    const bin = atob(s.replace(/^data:image\/png;base64,/, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** An unguessable id: 14 characters of a 62-letter alphabet, about 83 bits. */
export const newId = (): string => {
  const out: string[] = []
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  // Bytes at or over 248 are skipped so every letter is equally likely.
  for (const b of buf) if (b < 248 && out.length < 14) out.push(ALPHABET[b % 62])
  return out.length === 14 ? out.join('') : newId()
}

/** The body as bytes, read in chunks and given up on as soon as it passes the cap, whatever the headers claimed. */
const readBounded = async (req: Request, cap: number): Promise<Uint8Array | null> => {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/** What a request carried: the facts and the card, from JSON (`png` in base64) or a multipart form (`meta`, `png`). */
const readBody = async (req: Request): Promise<{ meta: unknown; png: Uint8Array } | { error: string; status: number }> => {
  // A length must be declared and within the cap before a byte is read; the reader still holds the line if it lied.
  const declared = req.headers.get('content-length')
  if (declared == null || !/^\d+$/.test(declared)) return { error: 'length required', status: 411 }
  if (Number(declared) > MAX_BODY) return { error: 'too large', status: 413 }
  const bytes = await readBounded(req, MAX_BODY)
  if (!bytes) return { error: 'too large', status: 413 }
  const type = req.headers.get('content-type') ?? ''
  const bad = { error: 'bad body', status: 400 }
  try {
    if (type.includes('multipart/form-data')) {
      const form = await new Response(bytes as BodyInit, { headers: { 'content-type': type } }).formData()
      const file = form.get('png')
      const metaRaw = form.get('meta')
      if (typeof metaRaw !== 'string' || metaRaw.length > MAX_META || !file || typeof file === 'string') return bad
      if (file.size > MAX_PNG) return { error: 'png too large', status: 413 }
      return { meta: JSON.parse(metaRaw), png: new Uint8Array(await file.arrayBuffer()) }
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { meta?: unknown; png?: unknown }
    if (typeof body?.png !== 'string') return bad
    if (JSON.stringify(body.meta ?? null).length > MAX_META) return { error: 'meta too large', status: 413 }
    const png = unbase64(body.png)
    return png ? { meta: body.meta, png } : { error: 'bad png', status: 400 }
  } catch {
    return bad
  }
}

/** POST /share: validate, store, answer with the link's id. */
export async function handlePost(req: Request, env: ShareEnv, origin: string, ip: string): Promise<Response> {
  if (limited(`s1:${ip}`, 6) || limited(`sh:${ip}`, 40, 3_600_000)) return send({ error: 'slow down' }, 429, origin, { 'retry-after': '60' })
  const body = await readBody(req)
  if ('error' in body) return send({ error: body.error }, body.status, origin)
  const meta = parseMeta(body.meta)
  if (typeof meta === 'string') return send({ error: meta }, 400, origin)
  const dims = checkPng(body.png)
  if (typeof dims === 'string') return send({ error: dims }, dims === 'png too large' ? 413 : 400, origin)
  const id = newId()
  const buf = body.png.buffer.slice(body.png.byteOffset, body.png.byteOffset + body.png.byteLength) as ArrayBuffer
  await Promise.all([
    env.GRADES.put(`s:${id}:png`, buf, { expirationTtl: TTL_SECONDS }),
    env.GRADES.put(`s:${id}`, JSON.stringify({ v: 1, at: Date.now(), ...meta }), { expirationTtl: TTL_SECONDS }),
  ])
  return send({ id, url: `${new URL(req.url).origin}/s/${id}` }, 200, origin)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
/** A string for inside a <script>: JSON, with the characters that could end the tag or the line escaped. */
const js = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** The page link-preview bots read: Open Graph and Twitter tags, plus a way on for anyone who lands on it. */
export const previewPage = (meta: ShareMeta, id: string, origin: string) => {
  const page = `${origin}/s/${id}`
  const image = `${origin}/s/${id}.png`
  const to = appUrl(meta)
  const alt = `${meta.title}: ${meta.description}`.slice(0, 300)
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'sujeff.com / Fantasy'],
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:url', page],
    ['og:image', image],
    ['og:image:type', 'image/png'],
    ['og:image:width', String(CARD.w)],
    ['og:image:height', String(CARD.h)],
    ['og:image:alt', alt],
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', meta.title],
    ['twitter:description', meta.description],
    ['twitter:image', image],
    ['twitter:image:alt', alt],
    ['theme-color', '#111114'],
  ]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="robots" content="noindex">
${tags.map(([k, v]) => `<meta ${k.startsWith('og:') ? 'property' : 'name'}="${k}" content="${esc(v)}">`).join('\n')}
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111114;color:#fafafa;font:16px/1.5 system-ui,sans-serif}
main{width:min(560px,92vw);padding:24px 0;text-align:center}
img{width:100%;height:auto;display:block;border:1px solid #27272a}
a{display:inline-block;margin-top:20px;padding:12px 20px;border:1px solid #52a0f0;color:#52a0f0;text-decoration:none;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}
</style>
</head>
<body>
<main>
<img src="${esc(image)}" width="${CARD.w}" height="${CARD.h}" alt="${esc(alt)}">
<a href="${esc(to)}">Open Power Rank</a>
</main>
<script>location.replace(${js(to)})</script>
</body>
</html>`
}

/** The redirect people get. It depends on who asks, so nothing may keep it. */
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'private, no-store', vary: 'User-Agent' } })

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', ...extra } })

/** GET /s/:id (the page or the redirect) and GET /s/:id.png (the card). Open to anyone; there is nothing private in it. */
export async function serve(req: Request, env: ShareEnv): Promise<Response> {
  const url = new URL(req.url)
  const m = /^\/s\/([A-Za-z0-9]+)(\.png)?$/.exec(url.pathname)
  if (!m || !ID.test(m[1])) return text('Not found', 404)
  const [, id, png] = m
  if (png) {
    const buf = await env.GRADES.get(`s:${id}:png`, 'arrayBuffer')
    if (!buf) return text('Not found', 404)
    return new Response(req.method === 'HEAD' ? null : buf, {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' },
    })
  }
  const stored = (await env.GRADES.get(`s:${id}`, 'json')) as (ShareMeta & { v?: number }) | null
  const meta = stored ? parseMeta(stored) : null
  const bot = BOTS.test(req.headers.get('user-agent') ?? '')
  if (!meta || typeof meta === 'string') {
    // A link that has lapsed still lands people in the app.
    return bot ? text('Not found', 404) : redirect(`${SITE}/fantasy#power`)
  }
  if (bot) return text(previewPage(meta, id, url.origin), 200, { 'cache-control': 'public, max-age=300', vary: 'User-Agent' })
  return redirect(appUrl(meta))
}
