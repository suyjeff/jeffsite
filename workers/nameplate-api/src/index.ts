export interface Env {
  DB: D1Database
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (url.pathname === '/nameplates' && request.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500)
      const { results } = await env.DB.prepare(
        'SELECT id, name, theme, font, effect, created_at AS createdAt, visitor_token AS visitorToken, x, y, rotation FROM nameplates ORDER BY created_at DESC LIMIT ?',
      ).bind(limit).all()

      return json({ nameplates: results })
    }

    if (url.pathname === '/nameplates' && request.method === 'POST') {
      const body = await request.json<{
        name?: string
        theme?: string
        font?: string
        effect?: string
        visitorToken?: string
      }>()

      const { name, theme, font, effect, visitorToken } = body

      if (!name || !theme || !font || !effect || !visitorToken) {
        return json({ error: 'Missing required fields' }, 400)
      }

      if (name.trim().length === 0 || name.trim().length > 24) {
        return json({ error: 'Name must be 1-24 characters' }, 400)
      }

      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()

      try {
        await env.DB.prepare(
          'INSERT INTO nameplates (id, name, theme, font, effect, created_at, visitor_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(id, name.trim(), theme, font, effect, createdAt, visitorToken).run()
      } catch (e: any) {
        if (e.message?.includes('UNIQUE constraint failed')) {
          return json({ error: 'You already placed a nameplate!' }, 409)
        }
        return json({ error: 'Internal error' }, 500)
      }

      return json({
        nameplate: { id, name: name.trim(), theme, font, effect, createdAt, visitorToken },
      }, 201)
    }

    const patchMatch = url.pathname.match(/^\/nameplates\/([^/]+)$/)
    if (patchMatch && request.method === 'PATCH') {
      const id = patchMatch[1]
      const body = await request.json<{
        x?: number
        y?: number
        rotation?: number
        visitorToken?: string
      }>()

      if (!body.visitorToken) {
        return json({ error: 'Missing visitorToken' }, 400)
      }

      const row = await env.DB.prepare(
        'SELECT visitor_token FROM nameplates WHERE id = ?',
      ).bind(id).first<{ visitor_token: string }>()

      if (!row) {
        return json({ error: 'Not found' }, 404)
      }
      if (row.visitor_token !== body.visitorToken) {
        return json({ error: 'Forbidden' }, 403)
      }

      await env.DB.prepare(
        'UPDATE nameplates SET x = ?, y = ?, rotation = ? WHERE id = ?',
      ).bind(body.x ?? null, body.y ?? null, body.rotation ?? null, id).run()

      return json({ ok: true })
    }

    return json({ error: 'Not found' }, 404)
  },
}
