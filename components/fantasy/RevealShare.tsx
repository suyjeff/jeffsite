import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Recap } from '../../lib/fantasy/recap'
import { useFantasy } from './FantasyContext'
import { cx, fmt } from './ui'

// Sharing the ranking as a picture: a clean card drawn straight onto a canvas (rank, team, power, move and nothing
// else), handed to the phone's share sheet where there is one and saved as a file where there is not. Drawn by hand
// rather than captured from the page so it is the same on every device, and needs no library.

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
type Palette = typeof LIGHT
const VARS: Record<keyof Palette, string> = { bg: '--ff-bg', panel: '--ff-panel', sunken: '--ff-sunken', line: '--ff-line', line2: '--ff-line2', text: '--ff-text', text2: '--ff-text2', muted: '--ff-muted', pos: '--ff-pos', neg: '--ff-neg', gold: '--ff-gold', goldInk: '--ff-gold-ink', accentDeep: '--ff-accent-deep', c4: '--ff-c4' }

const readPalette = (): Palette => {
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
const rgb = (t: string, a = 1) => (a === 1 ? `rgb(${t})` : `rgba(${t},${a})`)

const SANS = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'

/** A team's picture, or null if it cannot be had for the canvas (blocked, missing, or no cross-origin permission). */
const loadImage = (src: string | null) =>
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
const fit = (ctx: CanvasRenderingContext2D, text: string, max: number) => {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

const CROWN = 'M5 20V9.5l5.75 4.75L16 6l5.25 8.25L27 9.5V20Z'
/** The reveal's crown (RevealBanner.tsx), drawn at `size` px wide with its top-left corner at 0,0 of the current transform. */
const crown = (ctx: CanvasRenderingContext2D, size: number, p: Palette) => {
  ctx.save()
  ctx.scale(size / 32, size / 32)
  ctx.fillStyle = rgb(p.gold)
  ctx.fill(new Path2D(CROWN))
  ctx.strokeStyle = rgb(p.panel, 0.7)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(6.5, 17)
  ctx.lineTo(25.5, 17)
  ctx.stroke()
  for (const [x, y] of [[5, 8.5], [16, 4.75], [27, 8.5]]) {
    ctx.beginPath()
    ctx.moveTo(x, y - 1.9)
    ctx.lineTo(x + 1.9, y)
    ctx.lineTo(x, y + 1.9)
    ctx.lineTo(x - 1.9, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Draws the card and returns its canvas. Waits for the fonts and the pictures first. */
export const renderRankCard = async ({ league, week, teams }: CardInput): Promise<HTMLCanvasElement> => {
  const p = readPalette()
  const n = teams.length
  const rowH = Math.max(40, Math.min(96, Math.floor((1350 - HEAD - FOOT) / Math.max(1, n))))
  const H = Math.max(1080, HEAD + n * rowH + FOOT)
  const k = rowH / 86

  // Fonts load on first use, so ask for each cut that will be drawn, then wait for the page's own loading to finish.
  try {
    await Promise.all(['600 64px "IBM Plex Sans"', '500 36px "IBM Plex Sans"', '400 28px "IBM Plex Mono"', '500 40px "IBM Plex Mono"'].map((f) => document.fonts.load(f)))
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

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the image'))), 'image/png'))

/** Saves a file by a link the page clicks itself, where there is no share sheet. */
const download = (file: File) => {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export type ShareResult = 'shared' | 'saved' | 'cancelled'

/** Opens the share sheet with the picture when the device can take it, else saves it. A cancelled sheet is not an error. */
export const shareFile = async (file: File, title: string): Promise<ShareResult> => {
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
      // The sheet refused (a gesture too old, say): the file is still worth having.
      if ((e as DOMException)?.name !== 'NotAllowedError') throw e
    }
  }
  download(file)
  return 'saved'
}

// One finished picture per recap, drawn in the background once the recap is on screen so a tap has the file ready:
// browsers only open a share sheet from a fresh tap, and drawing it first (pictures to fetch) could outlast that.
const made = new WeakMap<Recap, { key: string; file: Promise<File> }>()

const useCard = (recap: Recap) => {
  const { data, analysis } = useFantasy()
  const input = useCallback((): CardInput => {
    return {
      league: data.league.name || 'Power rank',
      week: recap.week,
      teams: recap.teams.map((t) => {
        const a = analysis.teamById[t.rosterId]
        return { rosterId: t.rosterId, name: a?.name ?? `Team ${t.rosterId}`, avatar: a?.avatar ?? null, rank: t.rankAfter, move: t.move, score: t.scoreAfter }
      }),
    }
  }, [data.league.name, analysis, recap])
  return useCallback(() => {
    // A theme change redraws it in the new colours.
    const key = JSON.stringify(readPalette())
    const hit = made.get(recap)
    if (hit && hit.key === key) return hit.file
    const file = renderRankCard(input())
      .then(toBlob)
      .then((b) => new File([b], `power-rank-week-${recap.week}.png`, { type: 'image/png' }))
    file.catch(() => made.delete(recap))
    made.set(recap, { key, file })
    return file
  }, [recap, input])
}

type Status = null | { tone: 'ok' | 'bad'; text: string }

/**
 * The Share control: an icon on its own for the reveal's header on a phone, a labelled button above the ranking
 * on a wide screen. Says so, briefly, when it saved a file or could not make one.
 */
export const ShareButton = ({ recap, icon, className }: { recap: Recap; icon?: boolean; className?: string }) => {
  const { data } = useFantasy()
  const card = useCard(recap)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const timer = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    // Draw it while the recap settles in, off the first frames.
    const id = window.setTimeout(() => card().catch(() => {}), 900)
    return () => {
      alive.current = false
      window.clearTimeout(id)
      window.clearTimeout(timer.current)
    }
  }, [card])
  const say = (s: Status) => {
    if (!alive.current) return
    setStatus(s)
    window.clearTimeout(timer.current)
    if (s) timer.current = window.setTimeout(() => setStatus(null), s.tone === 'bad' ? 5000 : 2600)
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    say(null)
    try {
      const r = await shareFile(await card(), `${data.league.name || 'Power rank'} power rank, week ${recap.week}`)
      if (r === 'saved') say({ tone: 'ok', text: 'Saved the image' })
    } catch {
      say({ tone: 'bad', text: 'Could not share. Try again.' })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <span className={cx('relative inline-flex items-center gap-2', className)}>
      {/* Always mounted, so a screen reader announces the text when it changes. */}
      <span role="status" className="sr-only">
        {status?.text}
      </span>
      {status && !icon && (
        <span aria-hidden className={cx('ff-fade-in font-mono text-[10.5px]', status.tone === 'bad' ? 'text-ff-neg' : 'text-ff-muted')}>
          {status.text}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        aria-busy={busy || undefined}
        aria-label={icon ? 'Share the ranking as an image' : undefined}
        title="Share the ranking as an image"
        className={cx(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text active:bg-ff-raised',
          icon ? 'h-10 w-10 md:h-8 md:w-8' : 'h-8 border border-ff-line2 px-2.5 max-md:h-10',
          busy && 'opacity-60',
        )}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
          <path d="M7 9V1.5M4 4.25 7 1.25l3 3M2.5 7v5.5h9V7" />
        </svg>
        {!icon && (busy ? 'Making…' : 'Share')}
      </button>
      {/* In the reveal's header there is no room beside the icon: the note drops below it. */}
      {status && icon && (
        <span aria-hidden className={cx('ff-fade-in absolute right-0 top-full z-20 mt-1 w-max max-w-[240px] border bg-ff-panel px-2 py-1.5 text-[11.5px] leading-snug shadow-[0_8px_24px_-12px_rgb(0_0_0/0.4)]', status.tone === 'bad' ? 'border-ff-neg/60 text-ff-neg' : 'border-ff-line2 text-ff-text2')}>
          {status.text}
        </span>
      )}
    </span>
  )
}
