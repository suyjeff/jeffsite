import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Recap } from '../../lib/fantasy/recap'
import { useFantasy } from './FantasyContext'
import { CROWN_BAND, CROWN_NODES, CROWN_NODE_R, CROWN_PATH } from './RevealBanner'
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

// The app's own faces: Plex Sans for words, and Chivo Mono for numbers and labels (the `.num` and `.ff-label` classes).
const SANS = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"Chivo Mono", ui-monospace, Menlo, monospace'

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

/** The reveal's crown (RevealBanner.tsx), drawn at `size` px wide with its top-left corner at 0,0 of the current transform. */
const crown = (ctx: CanvasRenderingContext2D, size: number, p: Palette) => {
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
export const renderRankCard = async ({ league, week, teams }: CardInput): Promise<HTMLCanvasElement> => {
  const p = readPalette()
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

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the image'))), 'image/png'))

/** Whether a clicked `download` link is honoured: not in an iOS home-screen app or an in-app browser, which ignore it. */
const canDownload = () => {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|; wv\)/.test(ua)
  return !inApp && !(ios && standalone)
}

/** Saves the file by a link the page clicks itself, or opens it in a tab to be pressed and held where that cannot be. */
const save = (file: File): 'downloaded' | 'opened' => {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  const down = canDownload()
  if (down) a.download = file.name
  else {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  document.body.appendChild(a)
  a.click()
  a.remove()
  // A tab that was opened still needs the file after the click, so give it a minute.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  return down ? 'downloaded' : 'opened'
}

export type ShareResult = 'shared' | 'downloaded' | 'opened' | 'cancelled'

/**
 * Opens the share sheet with the picture when the device can take it, else saves it. A cancelled sheet is not an error.
 * Not async before the share call: browsers open the sheet only from a live tap, so the file must already be made.
 */
export const shareFile = (file: File, title: string): Promise<ShareResult> => {
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title }).then(
      () => 'shared' as const,
      (e) => {
        if ((e as DOMException)?.name === 'AbortError') return 'cancelled' as const
        // The sheet refused: the file is still worth having.
        if ((e as DOMException)?.name !== 'NotAllowedError') throw e
        return save(file)
      },
    )
  }
  return Promise.resolve(save(file))
}

// One finished picture per recap, drawn in idle time once the recap has settled, so a tap finds the file ready.
// The key says what it was drawn from, so a theme, a rename or a new avatar draws it again.
type Made = { key: string; file: Promise<File> }
const made = new WeakMap<Recap, Made>()

type Card = { file: File | null; failed: boolean; retry: () => void }

const useCard = (recap: Recap): Card => {
  const { data, analysis } = useFantasy()
  const input = useMemo((): CardInput => {
    return {
      league: data.league.name || 'Power rank',
      week: recap.week,
      teams: recap.teams.map((t) => {
        const a = analysis.teamById[t.rosterId]
        return { rosterId: t.rosterId, name: a?.name ?? `Team ${t.rosterId}`, avatar: a?.avatar ?? null, rank: t.rankAfter, move: t.move, score: t.scoreAfter }
      }),
    }
  }, [data.league.name, analysis, recap])
  const [state, setState] = useState<{ file: File | null; failed: boolean }>({ file: null, failed: false })
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let live = true
    const key = JSON.stringify([readPalette(), input.league, input.teams.map((t) => [t.name, t.avatar, t.rank, t.move, t.score])])
    setState({ file: null, failed: false })
    const start = () => {
      let entry = made.get(recap)
      if (!entry || entry.key !== key || tries > 0) {
        const mine: Made = { key, file: renderRankCard(input).then(toBlob).then((b) => new File([b], `power-rank-week-${recap.week}.png`, { type: 'image/png' })) }
        // A failed draw clears only its own entry, never a newer one.
        mine.file.catch(() => made.get(recap) === mine && made.delete(recap))
        made.set(recap, mine)
        entry = mine
      }
      entry.file.then(
        (file) => live && setState({ file, failed: false }),
        () => live && setState({ file: null, failed: true }),
      )
    }
    // After the recap's entrance (about a second), and then only when the page is idle.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    let idle = 0
    const wait = made.get(recap)?.key === key && tries === 0 ? 0 : 1500
    const id = window.setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(start, { timeout: 4000 })
      else start()
    }, wait)
    return () => {
      live = false
      window.clearTimeout(id)
      if (idle) w.cancelIdleCallback?.(idle)
    }
  }, [recap, input, tries])

  return { ...state, retry: () => setTries((n) => n + 1) }
}

type Status = null | { tone: 'ok' | 'bad'; text: string }

/**
 * The Share control: an icon on its own for the reveal's header on a phone, a labelled button above the ranking
 * on a wide screen. Disabled, saying so, until the picture is made, so a tap always has a file to hand over.
 * Says so, briefly, when it saved or opened a file or could not share.
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
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])
  const say = (s: Status) => {
    if (!alive.current) return
    setStatus(s)
    window.clearTimeout(timer.current)
    if (s) timer.current = window.setTimeout(() => setStatus(null), s.tone === 'bad' ? 5000 : 2600)
  }

  const preparing = !card.file && !card.failed
  const run = () => {
    if (busy || preparing) return
    say(null)
    if (!card.file) return card.retry()
    setBusy(true)
    // Called straight from the tap, with the file already in hand.
    shareFile(card.file, `${data.league.name || 'Power rank'} power rank, week ${recap.week}`)
      .then((r) => {
        if (r === 'downloaded') say({ tone: 'ok', text: 'Downloaded the image' })
        else if (r === 'opened') say({ tone: 'ok', text: 'Opened the image' })
      })
      .catch(() => say({ tone: 'bad', text: 'Could not share. Try again.' }))
      .finally(() => alive.current && setBusy(false))
  }
  const label = preparing ? 'Preparing…' : card.failed ? 'Retry' : busy ? 'Sharing…' : 'Share'

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
        disabled={preparing}
        aria-busy={busy || preparing || undefined}
        aria-label={icon ? (preparing ? 'Preparing the image to share' : card.failed ? 'Retry making the image to share' : 'Share the ranking as an image') : undefined}
        title={preparing ? 'Preparing the image' : 'Share the ranking as an image'}
        className={cx(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text active:bg-ff-raised disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ff-text2',
          icon ? 'h-10 w-10 md:h-8 md:w-8' : 'h-8 border border-ff-line2 px-2.5 max-md:h-10',
          busy && 'opacity-60',
        )}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" className={cx(preparing && 'motion-safe:animate-pulse')}>
          <path d="M7 9V1.5M4 4.25 7 1.25l3 3M2.5 7v5.5h9V7" />
        </svg>
        {!icon && label}
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
