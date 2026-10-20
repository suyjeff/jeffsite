import { CROWN_BAND, CROWN_NODES, CROWN_NODE_R, CROWN_PATH } from './RevealBanner'
import { POOP_BODY, POOP_FACE } from './RevealArt'
import { fmt } from './ui'

// The pictures the Power Rank reveal shares, drawn straight onto a canvas so they are the same on every device and
// need no library: the full-ranking card (a download) and the 1200×630 link-preview card (RevealShare.tsx).

export type CardTeam = { rosterId: number; name: string; avatar: string | null; rank: number; move: number; score: number }
export type CardInput = { league: string; week: number; teams: CardTeam[] }

const W = 1080
const PAD = 56
const HEAD = 270
const FOOT = 96

// The current theme's colours as read off the page, as "r,g,b" triplets; these are the light theme's, for when a
// variable cannot be read (a page without the fantasy root, a test).
const LIGHT = {
  bg: '246,246,247',
  panel: '255,255,255',
  sunken: '244,244,245',
  line: '228,228,231',
  line2: '212,212,216',
  text: '9,9,11',
  text2: '63,63,70',
  muted: '108,108,117',
  pos: '10,122,58',
  neg: '200,46,46',
  gold: '182,128,4',
  goldInk: '140,98,0',
  accentDeep: '22,85,171',
  c4: '160,96,220',
}
export type Palette = typeof LIGHT
const VARS: Record<keyof Palette, string> = { bg: '--ff-bg', panel: '--ff-panel', sunken: '--ff-sunken', line: '--ff-line', line2: '--ff-line2', text: '--ff-text', text2: '--ff-text2', muted: '--ff-muted', pos: '--ff-pos', neg: '--ff-neg', gold: '--ff-gold', goldInk: '--ff-gold-ink', accentDeep: '--ff-accent-deep', c4: '--ff-c4' }

export const readPalette = (): Palette => {
  const out = { ...LIGHT }
  try {
    const cs = getComputedStyle(document.querySelector('.ff') ?? document.documentElement)
    for (const k of Object.keys(VARS) as (keyof Palette)[]) {
      const v = cs.getPropertyValue(VARS[k]).trim()
      if (/^\d+\s+\d+\s+\d+$/.test(v)) out[k] = v.split(/\s+/).join(',')
    }
  } catch {
    // keep the light palette
  }
  return out
}
export const rgb = (t: string, a = 1) => (a === 1 ? `rgb(${t})` : `rgba(${t},${a})`)

// The app's own faces: Plex Sans for words, and Chivo Mono for numbers and labels (the `.num` and `.ff-label` classes).
export const SANS = '"IBM Plex Sans", system-ui, sans-serif'
export const MONO = '"Chivo Mono", ui-monospace, Menlo, monospace'

/** A team's picture, or null if it cannot be had for the canvas (blocked, missing, or no cross-origin permission). */
export const loadImage = (src: string | null) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    // Without this the canvas would be tainted and could not be exported.
    img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => resolve(null), 8000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img.naturalWidth ? img : null)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    img.src = src
  })

/** The text cut to a width with an ellipsis. */
export const fit = (ctx: CanvasRenderingContext2D, text: string, max: number) => {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/** The reveal's crown (RevealBanner.tsx), drawn at `size` px wide with its top-left corner at 0,0 of the current transform. */
export const crown = (ctx: CanvasRenderingContext2D, size: number, p: Palette) => {
  ctx.save()
  ctx.scale(size / 32, size / 32)
  ctx.fillStyle = rgb(p.gold)
  ctx.fill(new Path2D(CROWN_PATH))
  ctx.strokeStyle = rgb(p.panel, 0.7)
  ctx.lineWidth = 1
  ctx.stroke(new Path2D(CROWN_BAND))
  for (const [x, y] of CROWN_NODES) {
    ctx.beginPath()
    ctx.moveTo(x, y - CROWN_NODE_R)
    ctx.lineTo(x + CROWN_NODE_R, y)
    ctx.lineTo(x, y + CROWN_NODE_R)
    ctx.lineTo(x - CROWN_NODE_R, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Draws the card and returns its canvas. Waits for the fonts and the pictures first. */
export const renderRankCard = async ({ league, week, teams }: CardInput, palette?: Palette): Promise<HTMLCanvasElement> => {
  const p = palette ?? readPalette()
  const n = teams.length
  const rowH = Math.max(40, Math.min(96, Math.floor((1350 - HEAD - FOOT) / Math.max(1, n))))
  const H = Math.max(1080, HEAD + n * rowH + FOOT)
  const k = rowH / 86

  // Fonts load on first use, so ask for each cut that will be drawn, then wait for the page's own loading to finish.
  try {
    // Each cut with the text it will draw, so the right slice of the font is fetched.
    const words = `Power Rank Week 0123456789 ${league} ${teams.map((t) => t.name).join(' ')}`
    const digits = '0123456789.–· PWRKMOVETA sujeff.com/fantasy chance to beat an average team'
    await Promise.all([
      ...['500', '600'].map((w) => document.fonts.load(`${w} 40px "IBM Plex Sans"`, words)),
      ...['400', '500'].map((w) => document.fonts.load(`${w} 40px "Chivo Mono"`, digits + league.toUpperCase())),
    ])
    await document.fonts.ready
  } catch {
    // draw with whatever is there
  }
  const images = await Promise.all(teams.map((t) => loadImage(t.avatar)))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  const spaced = (px: number) => {
    // Not everywhere yet; the labels just sit a touch tighter without it.
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`
  }
  ctx.textBaseline = 'middle'

  // Ground, and the reveal's accent rule along the top.
  ctx.fillStyle = rgb(p.panel)
  ctx.fillRect(0, 0, W, H)
  const bar = ctx.createLinearGradient(0, 0, W, 0)
  bar.addColorStop(0, rgb(p.accentDeep))
  bar.addColorStop(1, rgb(p.c4))
  ctx.fillStyle = bar
  ctx.fillRect(0, 0, W, 10)

  // Heading.
  ctx.textAlign = 'left'
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `500 26px ${MONO}`
  spaced(3)
  ctx.fillText(fit(ctx, league.toUpperCase(), W - PAD * 2), PAD, 82)
  spaced(0)
  ctx.fillStyle = rgb(p.text)
  ctx.font = `600 66px ${SANS}`
  ctx.fillText('Power Rank', PAD, 154)
  const titleW = ctx.measureText('Power Rank').width
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `400 40px ${MONO}`
  ctx.fillText(`· Week ${week}`, PAD + titleW + 22, 156)

  // Column labels over a hairline.
  const right = W - PAD - 20
  const moveR = right - 150
  const label = (s: string, x: number, align: CanvasTextAlign) => {
    ctx.textAlign = align
    ctx.fillText(s, x, HEAD - 22)
  }
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `400 21px ${MONO}`
  spaced(2.5)
  label('RK', PAD + 20, 'left')
  label('TEAM', PAD + 20 + Math.round(76 * k) + 4, 'left')
  label('MOVE', moveR, 'right')
  label('PWR', right, 'right')
  spaced(0)
  ctx.fillStyle = rgb(p.line2)
  ctx.fillRect(PAD, HEAD - 1, W - PAD * 2, 2)

  // Rows.
  teams.forEach((t, i) => {
    const y = HEAD + i * rowH
    const mid = y + rowH / 2
    const first = i === 0
    const last = i === n - 1 && n >= 4
    if (first) {
      ctx.fillStyle = rgb(p.gold, 0.12)
      ctx.fillRect(PAD, y, W - PAD * 2, rowH)
      ctx.fillStyle = rgb(p.gold)
      ctx.fillRect(PAD, y, 5, rowH)
    } else if (last) {
      ctx.fillStyle = rgb(p.neg, 0.09)
      ctx.fillRect(PAD, y, W - PAD * 2, rowH)
      ctx.fillStyle = rgb(p.neg)
      ctx.fillRect(PAD, y, 5, rowH)
    }
    if (i < n - 1) {
      ctx.fillStyle = rgb(p.line)
      ctx.fillRect(PAD, y + rowH - 1, W - PAD * 2, 1.5)
    }

    // Rank.
    ctx.textAlign = 'left'
    ctx.fillStyle = rgb(first ? p.goldInk : last ? p.neg : p.muted)
    ctx.font = `500 ${Math.round(38 * k)}px ${MONO}`
    ctx.fillText(String(t.rank).padStart(2, '0'), PAD + 20, mid + 1)

    // Picture: a square, or the team's first letter in one.
    const size = Math.round(rowH - 24)
    const ax = PAD + 20 + Math.round(76 * k) + 4
    const ay = Math.round(mid - size / 2)
    const img = images[i]
    ctx.fillStyle = rgb(p.sunken)
    ctx.fillRect(ax, ay, size, size)
    if (img) {
      // Cover the square, anchored to the top, as the app does.
      const s = Math.min(img.naturalWidth, img.naturalHeight)
      ctx.drawImage(img, (img.naturalWidth - s) / 2, 0, s, s, ax, ay, size, size)
    } else {
      ctx.fillStyle = rgb(p.muted)
      ctx.font = `500 ${Math.round(size * 0.42)}px ${MONO}`
      ctx.textAlign = 'center'
      ctx.fillText((Array.from(t.name.trim())[0] ?? '?').toUpperCase(), ax + size / 2, ay + size / 2 + 1)
      ctx.textAlign = 'left'
    }
    ctx.strokeStyle = rgb(p.line2)
    ctx.lineWidth = 1.5
    ctx.strokeRect(ax + 0.75, ay + 0.75, size - 1.5, size - 1.5)
    if (first) {
      ctx.save()
      ctx.translate(ax - 12, ay - 11)
      ctx.rotate((-14 * Math.PI) / 180)
      crown(ctx, Math.round(size * 0.58), p)
      ctx.restore()
    }

    // Name.
    const nx = ax + size + 22
    ctx.fillStyle = rgb(p.text)
    ctx.font = `${first ? 600 : 500} ${Math.round(37 * k + 1)}px ${SANS}`
    ctx.textAlign = 'left'
    ctx.fillText(fit(ctx, t.name, moveR - 110 - nx), nx, mid + 1)

    // Move: a triangle and the places, or a dash.
    const col = t.move > 0 ? p.pos : t.move < 0 ? p.neg : p.muted
    ctx.fillStyle = rgb(col)
    ctx.textAlign = 'right'
    ctx.font = `500 ${Math.round(32 * k + 2)}px ${MONO}`
    if (t.move === 0) ctx.fillText('–', moveR, mid + 1)
    else {
      const num = String(Math.abs(t.move))
      ctx.fillText(num, moveR, mid + 1)
      const nw = ctx.measureText(num).width
      const tw = Math.round(24 * k + 4)
      const tx = moveR - nw - 10 - tw
      const th = tw * 0.86
      ctx.beginPath()
      if (t.move > 0) {
        ctx.moveTo(tx + tw / 2, mid - th / 2)
        ctx.lineTo(tx + tw, mid + th / 2)
        ctx.lineTo(tx, mid + th / 2)
      } else {
        ctx.moveTo(tx, mid - th / 2)
        ctx.lineTo(tx + tw, mid - th / 2)
        ctx.lineTo(tx + tw / 2, mid + th / 2)
      }
      ctx.closePath()
      ctx.fill()
    }

    // Power.
    ctx.fillStyle = rgb(p.text)
    ctx.font = `500 ${Math.round(40 * k + 2)}px ${MONO}`
    ctx.textAlign = 'right'
    ctx.fillText(fmt(t.score, 1), right, mid + 1)
  })

  // Footer.
  const fy = H - FOOT / 2 + 4
  ctx.fillStyle = rgb(p.line2)
  ctx.fillRect(PAD, H - FOOT, W - PAD * 2, 2)
  ctx.textAlign = 'left'
  ctx.fillStyle = rgb(p.text2)
  ctx.font = `500 26px ${MONO}`
  ctx.fillText('sujeff.com/fantasy', PAD, fy)
  ctx.textAlign = 'right'
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `400 21px ${MONO}`
  ctx.fillText('PWR · chance to beat an average team', W - PAD, fy)
  return canvas
}


// ---------------------------------------------------------------------------------------------------------------
// The link preview: 1200×630, in the app's dark colours whatever the theme, with few rows and large type so it reads as
// a thumbnail in a message.

/** The app's dark theme, for the preview card. */
export const DARK: Palette = {
  bg: '9,9,11',
  panel: '17,17,20',
  sunken: '12,12,14',
  line: '32,32,35',
  line2: '39,39,42',
  text: '250,250,250',
  text2: '212,212,216',
  muted: '161,161,170',
  pos: '46,196,112',
  neg: '244,102,102',
  gold: '242,193,78',
  goldInk: '246,205,110',
  accentDeep: '42,100,196',
  c4: '170,120,236',
}
const ACCENT = '82,152,240'

export type OgInput = CardInput & {
  /** Your own team, shown when it sits outside the top rows. */
  mine?: number | null
}

export const OG_W = 1200
export const OG_H = 630
const OG_ROWS = 3

/** Who moved most, and who is last: the highlights under the top rows. */
export const ogHighlights = (teams: CardTeam[]) => {
  const climb = teams.reduce<CardTeam | null>((m, t) => (t.move > 0 && (!m || t.move > m.move || (t.move === m.move && t.rank < m.rank)) ? t : m), null)
  const drop = teams.reduce<CardTeam | null>((m, t) => (t.move < 0 && (!m || t.move < m.move || (t.move === m.move && t.rank > m.rank)) ? t : m), null)
  const last = teams.length >= 4 ? teams[teams.length - 1] : null
  return { climb, drop, last }
}

/** The words a link preview carries besides the picture: the title, and a line with the top of the ranking. */
export const ogText = ({ league, week, teams }: CardInput) => {
  const top = teams.slice(0, OG_ROWS)
  const mv = (t: CardTeam) => (t.move > 0 ? ` ▲${t.move}` : t.move < 0 ? ` ▼${-t.move}` : '')
  const { last } = ogHighlights(teams)
  return {
    title: `${league} · Power Rank, Week ${week}`,
    description: `${top.map((t) => `${t.rank}. ${t.name} ${fmt(t.score, 1)}${mv(t)}`).join(' · ')}${last ? ` · Last: ${last.name}` : ''}`,
  }
}

const dots = (ctx: CanvasRenderingContext2D, p: Palette, w: number, h: number) => {
  ctx.fillStyle = rgb(p.line2, 0.8)
  for (let y = 12; y < h; y += 24) for (let x = 12; x < w; x += 24) ctx.fillRect(x, y, 2, 2)
}

/** A solid triangle of `w` px wide, pointing up or down, centred on x,y. */
const triangle = (ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, up: boolean) => {
  const h = w * 0.86
  ctx.beginPath()
  if (up) {
    ctx.moveTo(cx, cy - h / 2)
    ctx.lineTo(cx + w / 2, cy + h / 2)
    ctx.lineTo(cx - w / 2, cy + h / 2)
  } else {
    ctx.moveTo(cx - w / 2, cy - h / 2)
    ctx.lineTo(cx + w / 2, cy - h / 2)
    ctx.lineTo(cx, cy + h / 2)
  }
  ctx.closePath()
  ctx.fill()
}

/** Last place's mark, stroked as line art, `size` px wide with its top-left at the origin of the current transform. */
const poop = (ctx: CanvasRenderingContext2D, size: number, p: Palette) => {
  ctx.save()
  ctx.scale(size / 64, size / 64)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = 2.6
  ctx.strokeStyle = rgb(p.neg)
  for (const d of POOP_BODY) ctx.stroke(new Path2D(d))
  ctx.lineWidth = 2.2
  for (const d of POOP_FACE) ctx.stroke(new Path2D(d))
  ctx.restore()
}

const ogFonts = async (extra: string) => {
  try {
    const words = `Power Rank Week 0123456789 ${extra}`
    const digits = '0123456789.–·▲▼+ PWR WEEK BIGGEST CLIMB DROP LAST PLACE YOU sujeff.com/fantasy chance to beat an average team'
    await Promise.all([
      ...['500', '600'].map((w) => document.fonts.load(`${w} 40px "IBM Plex Sans"`, words)),
      ...['400', '500', '600'].map((w) => document.fonts.load(`${w} 40px "Chivo Mono"`, digits + extra.toUpperCase())),
    ])
    await document.fonts.ready
  } catch {
    // draw with whatever is there
  }
}

const ogGround = (p: Palette) => {
  const canvas = document.createElement('canvas')
  canvas.width = OG_W
  canvas.height = OG_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.textBaseline = 'middle'
  ctx.fillStyle = rgb(p.panel)
  ctx.fillRect(0, 0, OG_W, OG_H)
  dots(ctx, p, OG_W, OG_H)
  const bar = ctx.createLinearGradient(0, 0, OG_W, 0)
  bar.addColorStop(0, rgb(p.accentDeep))
  bar.addColorStop(1, rgb(p.c4))
  ctx.fillStyle = bar
  ctx.fillRect(0, 0, OG_W, 10)
  // Registration crosshairs at the corners, like a plotted sheet.
  ctx.strokeStyle = rgb(p.line2)
  ctx.lineWidth = 2
  for (const [x, y] of [[28, 38], [OG_W - 28, 38], [28, OG_H - 28], [OG_W - 28, OG_H - 28]]) {
    ctx.beginPath()
    ctx.moveTo(x - 7, y)
    ctx.lineTo(x + 7, y)
    ctx.moveTo(x, y - 7)
    ctx.lineTo(x, y + 7)
    ctx.stroke()
  }
  return { canvas, ctx }
}

/** The link-preview card: the top rows of the ranking, who moved most, who is last, and where the sharer stands. */
export const renderOgCard = async ({ league, week, teams, mine }: OgInput, palette: Palette = DARK): Promise<HTMLCanvasElement> => {
  const p = palette
  const top = teams.slice(0, OG_ROWS)
  await ogFonts(`${league} ${teams.map((t) => t.name).join(' ')}`)
  const images = await Promise.all(top.map((t) => loadImage(t.avatar)))
  const { canvas, ctx } = ogGround(p)
  const PAD = 60
  const spaced = (px: number) => {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`
  }

  // Header: the crown, the title, the league, the week.
  ctx.save()
  ctx.translate(PAD, 40)
  crown(ctx, 84, p)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.fillStyle = rgb(p.text)
  ctx.font = `600 54px ${SANS}`
  ctx.fillText('Power Rank', PAD + 112, 60)
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `500 22px ${MONO}`
  spaced(2.5)
  ctx.fillText(fit(ctx, league.toUpperCase(), 560), PAD + 114, 104)
  spaced(0)
  ctx.textAlign = 'right'
  ctx.fillStyle = rgb(p.goldInk)
  ctx.font = `600 54px ${MONO}`
  ctx.fillText(`WK ${String(week).padStart(2, '0')}`, OG_W - PAD, 62)

  // The top rows.
  const y0 = 130
  const rowH = 104
  const right = OG_W - PAD - 24
  const moveR = right - 168
  top.forEach((t, i) => {
    const y = y0 + i * rowH
    const mid = y + rowH / 2
    if (i === 0) {
      ctx.fillStyle = rgb(p.gold, 0.13)
      ctx.fillRect(PAD, y, OG_W - PAD * 2, rowH)
      ctx.fillStyle = rgb(p.gold)
      ctx.fillRect(PAD, y, 6, rowH)
    }
    ctx.fillStyle = rgb(p.line)
    ctx.fillRect(PAD, y, OG_W - PAD * 2, 2)
    ctx.textAlign = 'left'
    ctx.fillStyle = rgb(i === 0 ? p.goldInk : p.muted)
    ctx.font = `600 64px ${MONO}`
    ctx.fillText(String(t.rank).padStart(2, '0'), PAD + 26, mid + 2)
    // Avatar.
    const size = 80
    const ax = PAD + 138
    const ay = Math.round(mid - size / 2)
    ctx.fillStyle = rgb(p.sunken)
    ctx.fillRect(ax, ay, size, size)
    const img = images[i]
    if (img) {
      const s = Math.min(img.naturalWidth, img.naturalHeight)
      ctx.drawImage(img, (img.naturalWidth - s) / 2, 0, s, s, ax, ay, size, size)
    } else {
      ctx.fillStyle = rgb(p.muted)
      ctx.font = `500 ${Math.round(size * 0.42)}px ${MONO}`
      ctx.textAlign = 'center'
      ctx.fillText((Array.from(t.name.trim())[0] ?? '?').toUpperCase(), ax + size / 2, ay + size / 2 + 1)
      ctx.textAlign = 'left'
    }
    ctx.strokeStyle = rgb(p.line2)
    ctx.lineWidth = 2
    ctx.strokeRect(ax + 1, ay + 1, size - 2, size - 2)
    // Name.
    const nx = ax + size + 28
    ctx.fillStyle = rgb(p.text)
    ctx.font = `600 52px ${SANS}`
    ctx.fillText(fit(ctx, t.name, moveR - 110 - nx), nx, mid + 2)
    // Move.
    ctx.textAlign = 'right'
    ctx.font = `500 38px ${MONO}`
    ctx.fillStyle = rgb(t.move > 0 ? p.pos : t.move < 0 ? p.neg : p.muted)
    if (t.move === 0) ctx.fillText('–', moveR, mid + 2)
    else {
      const num = String(Math.abs(t.move))
      ctx.fillText(num, moveR, mid + 2)
      triangle(ctx, moveR - ctx.measureText(num).width - 24, mid + 1, 28, t.move > 0)
    }
    // Power.
    ctx.fillStyle = rgb(p.text)
    ctx.font = `500 54px ${MONO}`
    ctx.fillText(fmt(t.score, 1), right, mid + 2)
  })
  ctx.fillStyle = rgb(p.line)
  ctx.fillRect(PAD, y0 + OG_ROWS * rowH, OG_W - PAD * 2, 2)

  // Highlights: three short facts, side by side.
  const { climb, drop, last } = ogHighlights(teams)
  const chips: { label: string; team: CardTeam; kind: 'up' | 'down' | 'last' }[] = []
  if (climb) chips.push({ label: 'BIGGEST CLIMB', team: climb, kind: 'up' })
  if (drop) chips.push({ label: 'BIGGEST DROP', team: drop, kind: 'down' })
  if (last) chips.push({ label: 'LAST PLACE', team: last, kind: 'last' })
  const cy = y0 + OG_ROWS * rowH + 20
  const ch = 100
  const gap = 16
  const cw = chips.length ? Math.floor((OG_W - PAD * 2 - gap * (chips.length - 1)) / chips.length) : 0
  chips.forEach((c, i) => {
    const x = PAD + i * (cw + gap)
    ctx.fillStyle = rgb(p.sunken)
    ctx.fillRect(x, cy, cw, ch)
    ctx.strokeStyle = rgb(c.kind === 'last' ? p.neg : p.line2, c.kind === 'last' ? 0.6 : 1)
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, cy + 1, cw - 2, ch - 2)
    ctx.textAlign = 'left'
    ctx.fillStyle = rgb(c.kind === 'last' ? p.neg : p.muted)
    ctx.font = `500 18px ${MONO}`
    spaced(2)
    ctx.fillText(c.label, x + 20, cy + 26)
    spaced(0)
    let tx = x + 20
    const my = cy + 66
    if (c.kind === 'last') {
      ctx.save()
      ctx.translate(x + cw - 70, cy + 20)
      poop(ctx, 56, p)
      ctx.restore()
    } else {
      ctx.fillStyle = rgb(c.kind === 'up' ? p.pos : p.neg)
      triangle(ctx, tx + 12, my, 22, c.kind === 'up')
      tx += 34
      ctx.font = `600 34px ${MONO}`
      ctx.fillText(String(Math.abs(c.team.move)), tx, my + 1)
      tx += ctx.measureText(String(Math.abs(c.team.move))).width + 14
    }
    ctx.fillStyle = rgb(p.text)
    ctx.font = `600 31px ${SANS}`
    ctx.fillText(fit(ctx, c.team.name, x + cw - 20 - (c.kind === 'last' ? 66 : 0) - tx), tx, my + 1)
  })

  // Footer.
  const fy = OG_H - 30
  ctx.textAlign = 'left'
  ctx.fillStyle = rgb(p.text2)
  ctx.font = `500 22px ${MONO}`
  ctx.fillText('sujeff.com/fantasy', PAD, fy)
  const me = mine != null ? teams.find((t) => t.rosterId === mine) : null
  ctx.textAlign = 'right'
  if (me && me.rank > OG_ROWS) {
    const mv = me.move > 0 ? `  ▲${me.move}` : me.move < 0 ? `  ▼${-me.move}` : ''
    ctx.fillStyle = rgb(ACCENT)
    ctx.font = `500 22px ${MONO}`
    spaced(1)
    ctx.fillText(fit(ctx, `YOU · #${me.rank}${mv} · ${me.name}`, 640), OG_W - PAD, fy)
    spaced(0)
  } else {
    ctx.fillStyle = rgb(p.muted)
    ctx.font = `400 18px ${MONO}`
    ctx.fillText('PWR · chance to beat an average team', OG_W - PAD, fy)
  }
  return canvas
}

/** The plain card for links with no ranking of their own: what the Power Rank is and when it lands. */
export const renderGenericOgCard = async (palette: Palette = DARK): Promise<HTMLCanvasElement> => {
  const p = palette
  await ogFonts('Weekly Power Rank every Tuesday 6 AM ET Your league modelled')
  const { canvas, ctx } = ogGround(p)
  const PAD = 72
  ctx.save()
  ctx.translate(PAD, 118)
  crown(ctx, 150, p)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `500 26px ${MONO}`
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '4px'
  ctx.fillText('SUJEFF.COM / FANTASY', PAD, 80)
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'
  ctx.fillStyle = rgb(p.text)
  ctx.font = `600 104px ${SANS}`
  ctx.font = `600 92px ${SANS}`
  ctx.fillText('Weekly', PAD + 190, 185)
  ctx.fillText('Power Rank', PAD + 190, 290)
  ctx.fillStyle = rgb(p.text2)
  ctx.font = `500 38px ${SANS}`
  ctx.fillText('Your league, ranked and explained.', PAD, 430)
  ctx.fillStyle = rgb(p.muted)
  ctx.font = `400 26px ${MONO}`
  ctx.fillText('New ranking every Tuesday · 6 AM ET', PAD, 486)
  // A few rows of a ranking, for the shape of it.
  const rows: [string, string, number][] = [['01', '60.2', 2], ['02', '58.4', -1], ['03', '56.9', 2], ['04', '54.5', -2]]
  rows.forEach(([rk, pw, mv], i) => {
    const x = 830
    const w = 300
    const y = 140 + i * 82
    ctx.fillStyle = i === 0 ? rgb(p.gold, 0.13) : rgb(p.sunken)
    ctx.fillRect(x, y, w, 66)
    if (i === 0) {
      ctx.fillStyle = rgb(p.gold)
      ctx.fillRect(x, y, 5, 66)
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = rgb(i === 0 ? p.goldInk : p.muted)
    ctx.font = `600 30px ${MONO}`
    ctx.fillText(rk, x + 20, y + 34)
    ctx.fillStyle = rgb(p.line2)
    ctx.fillRect(x + 76, y + 15, 36, 36)
    ctx.fillStyle = rgb(mv > 0 ? p.pos : p.neg)
    triangle(ctx, x + 146, y + 34, 15, mv > 0)
    ctx.font = `500 24px ${MONO}`
    ctx.fillText(String(Math.abs(mv)), x + 160, y + 35)
    ctx.textAlign = 'right'
    ctx.fillStyle = rgb(p.text)
    ctx.font = `500 30px ${MONO}`
    ctx.fillText(pw, x + w - 18, y + 35)
  })
  return canvas
}

export const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the image'))), 'image/png'))
