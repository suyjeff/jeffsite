import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Recap } from '../../lib/fantasy/recap'
import { sharedUrl } from '../../lib/fantasy/sharedGrades'
import { useFantasy } from './FantasyContext'
import { ogText, readPalette, renderOgCard, renderRankCard, toBlob, type CardInput, type OgInput } from './shareCards'
import { deepLinkUrl } from './useDeepLink'
import { cx } from './ui'

// Sharing the Power Rank. The Share button opens a small sheet: a preview of the card a message will unfurl to, a link
// that opens the week in the app (asking for a fantasy name first, as any visit does), and the full ranking as a PNG.
//
// The link is the shared worker's (workers/grades/src/share.ts), which holds the preview card and its tags for link
// previews, and sends people on to the app. Everything is made ahead, in idle time after the recap has settled, so a
// tap on Share link or Copy link only has to hand over what is ready: a browser opens its share sheet only from a tap.
// With no worker (or if it is down) the link is the plain address in the app, which still opens the right week.

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


/** What a share is made from: the rows, the facts the link preview carries, and who is looking. */
const useShareInput = (recap: Recap) => {
  const { data, analysis } = useFantasy()
  return useMemo(() => {
    const league = data.league.name || 'Power rank'
    const teams = recap.teams.map((t) => {
      const a = analysis.teamById[t.rosterId]
      return { rosterId: t.rosterId, name: a?.name ?? `Team ${t.rosterId}`, avatar: a?.avatar ?? null, rank: t.rankAfter, move: t.move, score: t.scoreAfter }
    })
    const card: CardInput = { league, week: recap.week, teams }
    const og: OgInput = { ...card, mine: analysis.myRosterId }
    return { card, og, leagueId: data.league.league_id, season: String(data.league.season), provider: data.provider ?? 'sleeper' }
  }, [data.league.name, data.league.league_id, data.league.season, data.provider, analysis, recap])
}
type ShareInput = ReturnType<typeof useShareInput>

const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const STORED = 'ff:share:'
const REUSE_MS = 100 * 24 * 60 * 60 * 1000
const readStored = (key: string, base: string): string | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORED + key) ?? 'null') as { id?: string; base?: string; at?: number } | null
    return v?.id && v.base === base && typeof v.at === 'number' && Date.now() - v.at < REUSE_MS ? v.id : null
  } catch {
    return null
  }
}
const writeStored = (key: string, id: string, base: string) => {
  try {
    window.localStorage.setItem(STORED + key, JSON.stringify({ id, base, at: Date.now() }))
  } catch {
    // ignore
  }
}

/** The worker's short link for a ranking: the one made before when it is still good, else the card is uploaded. */
const uploadPreview = async (input: ShareInput, blob: Blob, key: string): Promise<string> => {
  const base = sharedUrl()
  if (!base) throw new Error('no worker')
  const known = readStored(key, base)
  if (known) return `${base}/s/${known}`
  const { title, description } = ogText(input.card)
  const meta = {
    league: input.card.league.slice(0, 80),
    leagueId: input.leagueId,
    week: input.card.week,
    season: input.season,
    title: title.slice(0, 120),
    description: description.slice(0, 300),
    provider: input.provider,
    top: input.card.teams.slice(0, 5).map((t) => ({ rank: t.rank, name: t.name.slice(0, 60), score: t.score, move: t.move })),
  }
  const form = new FormData()
  form.set('meta', JSON.stringify(meta))
  form.set('png', blob, 'power-rank.png')
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch(`${base}/share`, { method: 'POST', body: form, signal: ctl.signal })
    if (!r.ok) throw new Error(`share ${r.status}`)
    const { id } = (await r.json()) as { id?: string }
    if (!id || !/^[A-Za-z0-9]{10,32}$/.test(id)) throw new Error('bad id')
    writeStored(key, id, base)
    return `${base}/s/${id}`
  } finally {
    window.clearTimeout(timer)
  }
}

// What was made for a recap, kept so reopening the sheet (or the other Share button) finds it. Three steps, each
// waiting on the one before and none started twice: the full card, the preview card, the link.
type Job = { key: string; file: Promise<File>; og: Promise<Blob>; link: Promise<string> }
const jobs = new WeakMap<Recap, Job>()
const OG_MAX = 400 * 1024

const startJob = (recap: Recap, input: ShareInput): Job => {
  const palette = readPalette()
  const key = JSON.stringify([palette, input.leagueId, input.card.league, input.card.teams.map((t) => [t.name, t.avatar, t.rank, t.move, t.score]), input.og.mine])
  const hit = jobs.get(recap)
  if (hit && hit.key === key) return hit
  const file = renderRankCard(input.card, palette)
    .then(toBlob)
    .then((b) => new File([b], `power-rank-week-${recap.week}.png`, { type: 'image/png' }))
  const og = file.then(() => renderOgCard(input.og)).then(toBlob)
  const sig = hash(JSON.stringify([input.leagueId, input.card.week, input.card.teams.slice(0, 5).map((t) => [t.name, t.avatar, t.rank, t.move, t.score]), ogText(input.card), input.og.mine, input.card.teams.length]))
  // With no worker, or any trouble with it, the plain link in the app stands in.
  const link = og
    .then((b) => (b.size > OG_MAX ? Promise.reject(new Error('card too large')) : uploadPreview(input, b, sig)))
    .catch(() => deepLinkUrl(input.leagueId, recap.week))
  const mine: Job = { key, file, og, link }
  jobs.set(recap, mine)
  // A failed step clears only its own entry, so the next open tries again.
  file.catch(() => jobs.get(recap) === mine && jobs.delete(recap))
  og.catch(() => jobs.get(recap) === mine && jobs.delete(recap))
  return mine
}

type Kit = { file: File | null; fileFailed: boolean; preview: string | null; link: string | null; plain: boolean; retry: () => void }

/** Makes the share ahead of the tap, once the recap has had its entrance (about a second), and only when the page is idle. */
const useShareKit = (recap: Recap, input: ShareInput): Kit => {
  const [state, setState] = useState<{ file: File | null; fileFailed: boolean; ogBlob: Blob | null; link: string | null }>({ file: null, fileFailed: false, ogBlob: null, link: null })
  const [preview, setPreview] = useState<string | null>(null)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let live = true
    setState({ file: null, fileFailed: false, ogBlob: null, link: null })
    const start = () => {
      if (tries > 0) jobs.delete(recap)
      const job = startJob(recap, input)
      job.file.then((file) => live && setState((s) => ({ ...s, file })), () => live && setState((s) => ({ ...s, fileFailed: true })))
      job.og.then((ogBlob) => live && setState((s) => ({ ...s, ogBlob })), () => {})
      job.link.then((link) => live && setState((s) => ({ ...s, link })))
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
    let idle = 0
    const made = jobs.get(recap)
    const wait = made && tries === 0 ? 0 : 1500
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

  // The preview picture is an object URL of the card, let go of when it is replaced or the sheet is gone.
  useEffect(() => {
    if (!state.ogBlob) return setPreview(null)
    const url = URL.createObjectURL(state.ogBlob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [state.ogBlob])

  const base = sharedUrl()
  return { file: state.file, fileFailed: state.fileFailed, preview, link: state.link, plain: !!state.link && !(base && state.link.startsWith(`${base}/s/`)), retry: () => setTries((n) => n + 1) }
}

type Status = null | { tone: 'ok' | 'bad'; text: string }

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and non-secure pages: select the text in a field and copy it.
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(el)
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    el.remove()
    return ok
  }
}

const Btn = ({ children, onClick, disabled, primary, className }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; className?: string }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cx(
      'inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border px-2 font-mono text-[11px] uppercase tracking-[0.08em] md:h-9 disabled:cursor-default disabled:opacity-50',
      primary ? 'border-ff-accent bg-ff-accent text-ff-on-accent enabled:hover:brightness-110' : 'border-ff-line2 text-ff-text2 enabled:hover:bg-ff-raised enabled:hover:text-ff-text',
      className,
    )}
  >
    {children}
  </button>
)

/** The sheet itself: the preview card, the link, and what can be done with them. */
const SharePanel = ({ recap, input, kit, onClose, stack }: { recap: Recap; input: ShareInput; kit: Kit; onClose: () => void; stack: boolean }) => {
  const [status, setStatus] = useState<Status>(null)
  const timer = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const say = useCallback((s: Status) => {
    setStatus(s)
    window.clearTimeout(timer.current)
    if (s) timer.current = window.setTimeout(() => setStatus(null), s.tone === 'bad' ? 6000 : 3000)
  }, [])
  const { title, description } = useMemo(() => ogText(input.card), [input.card])
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true })
  }, [])

  // Called straight from the tap, with the link already in hand.
  const shareLink = () => {
    if (!kit.link) return
    navigator.share({ title, text: description, url: kit.link }).then(
      () => say(null),
      (e) => ((e as DOMException)?.name === 'AbortError' ? say(null) : say({ tone: 'bad', text: 'Could not open the share sheet. Copy the link instead.' })),
    )
  }
  const copy = () => {
    if (!kit.link) return
    copyText(kit.link).then((ok) => say(ok ? { tone: 'ok', text: 'Link copied' } : { tone: 'bad', text: 'Could not copy. Select the link and copy it.' }))
  }
  const download = () => {
    if (!kit.file) return
    say({ tone: 'ok', text: save(kit.file) === 'opened' ? 'Opened the image: press and hold to save it' : 'Downloaded the image' })
  }

  const preparing = !kit.link
  const shown = kit.link ? kit.link.replace(/^https?:\/\//, '') : ''
  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Share the power rank"
      data-ff-share-open=""
      className={cx(
        'ff-fade-in z-40 border border-ff-line2 bg-ff-panel shadow-[0_16px_40px_-12px_rgb(0_0_0/0.5)]',
        stack ? 'fixed inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+10px)]' : 'absolute right-0 top-full mt-1 w-[360px]',
      )}
    >
      <div className="flex items-center justify-between border-b border-ff-line pl-3">
        <span className="ff-label">Share · week {recap.week}</span>
        <button type="button" onClick={onClose} className="h-10 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ff-muted hover:text-ff-text md:h-8">
          Close
        </button>
      </div>
      <div className="space-y-3 p-3">
        {/* What a message will show: the same card the link carries. */}
        <div className="relative aspect-[1200/630] w-full overflow-hidden border border-ff-line bg-ff-sunken">
          {kit.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.preview} alt={`Preview: ${title}. ${description}`} className="ff-fade-in h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-ff-muted motion-safe:animate-pulse">Drawing the preview…</span>
          )}
        </div>
        <div>
          <div className="ff-label mb-1">Link</div>
          <div className="flex h-9 items-center border border-ff-line bg-ff-sunken px-2.5 font-mono text-[11.5px] text-ff-text2">
            <span className="min-w-0 flex-1 truncate" title={kit.link ?? undefined}>
              {preparing ? <span className="text-ff-muted motion-safe:animate-pulse">Preparing…</span> : shown}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-ff-muted">
            {kit.plain ? 'A plain link to the week. Opening it asks for a fantasy name first.' : 'Shows this preview in a message. Opening it asks for a fantasy name first.'}
          </p>
        </div>
        <div className="flex gap-2">
          {canShare && (
            <Btn primary onClick={shareLink} disabled={preparing}>
              {preparing ? 'Preparing…' : 'Share link'}
            </Btn>
          )}
          <Btn primary={!canShare} onClick={copy} disabled={preparing}>
            {preparing ? 'Preparing…' : 'Copy link'}
          </Btn>
          <Btn onClick={kit.fileFailed ? kit.retry : download} disabled={!kit.file && !kit.fileFailed}>
            {kit.fileFailed ? 'Retry PNG' : kit.file ? 'Download PNG' : 'PNG…'}
          </Btn>
        </div>
        <p role="status" aria-live="polite" className={cx('min-h-[1.1em] font-mono text-[11px]', status?.tone === 'bad' ? 'text-ff-neg' : 'text-ff-muted')}>
          {status?.text}
        </p>
      </div>
    </div>
  )
}

/**
 * The Share control: an icon on its own for the reveal's header on a single-column layout, a labelled button above the
 * ranking on a wide screen. It opens the share sheet, and the things the sheet hands over are being made from the moment
 * the recap is up, so by the time it is open they are ready.
 */
export const ShareButton = ({ recap, icon, className }: { recap: Recap; icon?: boolean; className?: string }) => {
  const input = useShareInput(recap)
  const kit = useShareKit(recap, input)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }, [])
  // Escape closes the sheet (and not the reveal under it); a press outside it does too.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node) && !(e.target as Element).closest?.('[data-ff-share-open]')) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, close])

  return (
    <span ref={wrap} className={cx('relative z-30 inline-flex items-center', className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={icon ? 'Share the power rank' : undefined}
        title="Share the power rank"
        className={cx(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.08em] text-ff-text2 hover:bg-ff-raised hover:text-ff-text active:bg-ff-raised',
          icon ? 'h-10 w-10 md:h-8 md:w-8' : 'h-8 border border-ff-line2 px-2.5 max-md:h-10',
          open && 'bg-ff-raised text-ff-text',
        )}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
          <path d="M7 9V1.5M4 4.25 7 1.25l3 3M2.5 7v5.5h9V7" />
        </svg>
        {!icon && 'Share'}
      </button>
      {open && <SharePanel recap={recap} input={input} kit={kit} onClose={close} stack={!!icon} />}
    </span>
  )
}
