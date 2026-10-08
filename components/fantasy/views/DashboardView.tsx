import React, { useEffect, useRef, useState } from 'react'
import { WIDGETS, type Selection, type WidgetKind } from '../dashboard/widgets'
import { sectionCode } from '../Shell'
import { Button, PageHeader, cx } from '../ui'

// A modular board in the manner of a trading terminal: widgets on a 12-column
// grid, each with a width and height, reorderable by dragging the title bar,
// and linked by colour channel. Widgets on the same channel share a selection:
// pick a team in Playoff odds and the Team widget on that channel follows.

type Widget = { id: string; kind: WidgetKind; w: number; h: number; ch: number }

const STORAGE = 'ff:dash:v1'
const WIDTHS = [3, 4, 5, 6, 7, 8, 12]
const HEIGHTS: [string, number][] = [
  ['S', 7],
  ['M', 9],
  ['L', 11],
  ['XL', 15],
]
const CHANNELS = 4
const MIN_W = 2
const MIN_H = 4
const MAX_H = 24
/** Grid row unit and gap, in px; they match auto-rows-[34px] and gap-2 below. */
const ROW = 34
const GAP = 8
/** Two columns at md (half or full width), the widget's own span from xl. */
const spanClass = (w: number) => cx(w <= 6 ? 'md:col-span-6' : 'md:col-span-12', 'xl:[grid-column:span_var(--cols)_/_span_var(--cols)]')
const heightLabel = (h: number) => HEIGHTS.find(([, x]) => x === h)?.[0] ?? String(h)

const DEFAULT_LAYOUT: Widget[] = [
  { id: 'w1', kind: 'matchup', w: 4, h: 12, ch: 2 },
  { id: 'w2', kind: 'odds', w: 5, h: 12, ch: 1 },
  { id: 'w3', kind: 'player', w: 3, h: 12, ch: 2 },
  { id: 'w4', kind: 'trades', w: 7, h: 9, ch: 0 },
  { id: 'w5', kind: 'team', w: 5, h: 9, ch: 1 },
  { id: 'w6', kind: 'consensus', w: 4, h: 9, ch: 2 },
  { id: 'w7', kind: 'injuries', w: 4, h: 9, ch: 2 },
  { id: 'w8', kind: 'activity', w: 4, h: 9, ch: 2 },
  { id: 'w9', kind: 'scoreboard', w: 6, h: 7, ch: 1 },
  { id: 'w10', kind: 'standings', w: 6, h: 7, ch: 1 },
  { id: 'w11', kind: 'props', w: 6, h: 9, ch: 2 },
]

const load = (): Widget[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE)
    if (!raw) return DEFAULT_LAYOUT
    const xs = JSON.parse(raw) as Widget[]
    const ok = Array.isArray(xs) && xs.every((x) => x && typeof x.id === 'string' && x.kind in WIDGETS && Number.isInteger(x.w) && Number.isInteger(x.h))
    return ok ? xs : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}

const ChannelChip = ({ ch, onClick }: { ch: number; onClick: () => void }) => (
  <button
    onClick={onClick}
    title={ch ? `Linked on channel ${ch}. Click to change.` : 'Not linked. Click to link to a channel.'}
    aria-label={ch ? `Channel ${ch}` : 'Unlinked'}
    className="flex h-full w-8 shrink-0 items-center justify-center border-r border-ff-line hover:bg-ff-raised"
  >
    <span className={cx('flex h-3 w-3 items-center justify-center font-mono text-[8px] leading-none', !ch && 'border border-ff-line2 text-ff-muted')} style={ch ? { background: `rgb(var(--ff-c${ch}))`, color: 'rgb(var(--ff-panel))' } : undefined}>
      {ch || ''}
    </span>
  </button>
)

const Menu = ({ widget, onChange, onRemove, onMove, close }: { widget: Widget; onChange: (p: Partial<Widget>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; close: () => void }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A press on this widget's own toggle is left to the toggle, so clicking it closes the menu instead of reopening it.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (ref.current?.contains(t as Node) || t?.closest?.(`[data-menu-toggle="${widget.id}"]`)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [close, widget.id])
  const cell = (active: boolean) => cx('h-6 min-w-[26px] border border-ff-line px-1 font-mono text-[10.5px]', active ? 'bg-ff-text text-ff-panel' : 'text-ff-text2 hover:bg-ff-raised')
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-full z-40 w-[232px] border border-ff-line2 bg-ff-panel p-2 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
      <div className="ff-label mb-1">width / 12</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {WIDTHS.map((w) => (
          <button key={w} className={cell(widget.w === w)} onClick={() => onChange({ w })}>
            {w}
          </button>
        ))}
      </div>
      <div className="ff-label mb-1">height</div>
      <div className="mb-2 flex gap-1">
        {HEIGHTS.map(([k, h]) => (
          <button key={k} className={cell(widget.h === h)} onClick={() => onChange({ h })}>
            {k}
          </button>
        ))}
      </div>
      <div className="ff-label mb-1">channel</div>
      <div className="mb-2 flex gap-1">
        {Array.from({ length: CHANNELS + 1 }, (_, c) => (
          <button key={c} className={cell(widget.ch === c)} onClick={() => onChange({ ch: c })}>
            {c === 0 ? '—' : c}
          </button>
        ))}
      </div>
      <div className="flex gap-1 border-t border-ff-line pt-2">
        <button className={cell(false)} onClick={() => onMove(-1)}>
          ← move
        </button>
        <button className={cell(false)} onClick={() => onMove(1)}>
          move →
        </button>
        <button className={cx(cell(false), 'ml-auto text-ff-neg')} onClick={onRemove}>
          remove
        </button>
      </div>
    </div>
  )
}

const DashboardView = () => {
  const [layout, setLayout] = useState<Widget[]>(DEFAULT_LAYOUT)
  const [loaded, setLoaded] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [catalog, setCatalog] = useState(false)
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)
  const [resizing, setResizing] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  // Channel 0 is "unlinked": each such widget keeps its own selection, keyed by id.
  const [selection, setSelection] = useState<Record<string, Selection>>({})

  useEffect(() => {
    setLayout(load())
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify(layout))
    } catch {
      // Layout simply does not persist in a private window.
    }
  }, [layout, loaded])

  const keyFor = (w: Widget) => (w.ch ? `ch${w.ch}` : w.id)
  const patch = (id: string, p: Partial<Widget>) => setLayout((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const move = (id: string, d: -1 | 1) =>
    setLayout((xs) => {
      const i = xs.findIndex((x) => x.id === id)
      const j = i + d
      if (i < 0 || j < 0 || j >= xs.length) return xs
      const out = [...xs]
      ;[out[i], out[j]] = [out[j], out[i]]
      return out
    })
  const add = (kind: WidgetKind) => {
    const m = WIDGETS[kind]
    setLayout((xs) => [...xs, { id: `w${Date.now().toString(36)}`, kind, w: m.w, h: m.h, ch: m.reads ? 1 : 0 }])
    setCatalog(false)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }
  // Drag the corner: the widget snaps to whole columns and rows as the pointer moves.
  const startResize = (e: React.PointerEvent<HTMLElement>, w: Widget) => {
    if (e.button !== 0 || !grid.current) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const wide = window.matchMedia('(min-width: 1280px)').matches
    const colW = (grid.current.clientWidth - GAP * 11) / 12
    const x0 = e.clientX
    const y0 = e.clientY
    const { w: w0, h: h0 } = w
    setResizing(w.id)
    const onMove = (ev: PointerEvent) => {
      // Below xl the grid is two halves, so width steps between 6 and 12.
      // Width is the desktop column span; below xl the grid is two halves, so only height changes there.
      const nextW = wide ? Math.max(MIN_W, Math.min(12, w0 + Math.round((ev.clientX - x0) / (colW + GAP)))) : w0
      const nextH = Math.max(MIN_H, Math.min(MAX_H, h0 + Math.round((ev.clientY - y0) / (ROW + GAP))))
      setLayout((xs) => {
        const cur = xs.find((x) => x.id === w.id)
        // Most moves stay inside one cell: keep the same array so nothing re-renders or re-saves.
        if (!cur || (cur.w === nextW && cur.h === nextH)) return xs
        return xs.map((x) => (x.id === w.id ? { ...x, w: nextW, h: nextH } : x))
      })
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setResizing(null)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }
  const drop = (target: string) => {
    if (!drag || drag.id === target) return
    setLayout((xs) => {
      const from = xs.findIndex((x) => x.id === drag.id)
      const item = xs[from]
      const rest = xs.filter((x) => x.id !== drag.id)
      const to = rest.findIndex((x) => x.id === target)
      rest.splice(to, 0, item)
      return rest
    })
  }

  return (
    <>
      <PageHeader
        code={sectionCode('dash')}
        title="Dashboard"
        actions={
          <>
            {/* Phones have no edit mode, so Reset stays there; on wide screens it lives in edit mode. */}
            <Button size="sm" variant="ghost" onClick={() => setLayout(DEFAULT_LAYOUT)} title="Restore the default board" className={editing ? undefined : 'md:hidden'}>
              Reset
            </Button>
            <Button size="sm" variant={editing ? 'primary' : 'ghost'} onClick={() => setEditing((x) => !x)} title="Show resize handles and grid guides" className="hidden md:inline-flex">
              {editing ? 'Done' : 'Edit layout'}
            </Button>
            <div className="relative">
              <Button size="sm" variant={catalog ? 'primary' : 'outline'} onClick={() => setCatalog((c) => !c)}>
                + Widget
              </Button>
              {catalog && (
                <div className="fixed inset-x-2 top-[100px] z-40 border border-ff-line2 bg-ff-panel shadow-[0_8px_24px_rgba(0,0,0,0.25)] md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-1 md:w-[300px]">
                  <div className="ff-label border-b border-ff-line px-3 py-1.5">add widget</div>
                  <div className="ff-scroll max-h-[60vh] overflow-auto">
                    {(Object.keys(WIDGETS) as WidgetKind[]).map((k) => (
                      <button key={k} onClick={() => add(k)} className="block w-full border-b border-ff-line/60 px-3 py-2 text-left last:border-0 hover:bg-ff-raised">
                        <span className="flex items-baseline justify-between">
                          <span className="text-[12.5px] text-ff-text">{WIDGETS[k].title}</span>
                          <span className="num text-[10px] text-ff-muted">
                            {WIDGETS[k].w}×{WIDGETS[k].h}
                          </span>
                        </span>
                        <span className="block text-[11px] leading-snug text-ff-muted">{WIDGETS[k].blurb}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="ff-canvas -mx-3 mt-0 min-h-[calc(100vh-120px)] p-1.5 md:-mx-5 md:p-2">
        {/* Phones stack widgets at their natural height; the row grid starts at md. */}
        <div ref={grid} className={cx('grid grid-cols-1 gap-1.5 md:grid-flow-row-dense md:auto-rows-[34px] md:grid-cols-12 md:gap-2', editing && 'ff-grid-guides')}>
          {layout.map((w) => {
            const meta = WIDGETS[w.kind]
            const key = keyFor(w)
            const sel = selection[key] ?? {}
            const Body = meta.Body
            return (
              <section
                key={w.id}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  if (drag.over !== w.id) setDrag({ ...drag, over: w.id })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  drop(w.id)
                  setDrag(null)
                }}
                className={cx(
                  'relative flex max-h-[72vh] min-w-0 flex-col border border-ff-line bg-ff-panel md:max-h-none md:[grid-row:span_var(--rows)_/_span_var(--rows)]',
                  drag?.id === w.id && 'ff-dragging',
                  drag && drag.over === w.id && drag.id !== w.id && 'ff-drop-before',
                  spanClass(w.w),
                  resizing === w.id && 'ff-resizing',
                  editing && 'ff-editing',
                )}
                style={{ ['--rows' as string]: w.h, ['--cols' as string]: w.w }}
              >
                <header
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', w.id)
                    setDrag({ id: w.id, over: null })
                  }}
                  onDragEnd={() => setDrag(null)}
                  className="flex h-8 shrink-0 cursor-grab items-stretch border-b border-ff-line active:cursor-grabbing"
                >
                  <ChannelChip ch={w.ch} onClick={() => patch(w.id, { ch: (w.ch + 1) % (CHANNELS + 1) })} />
                  <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                    <span className="ff-label truncate text-ff-text2">{meta.title}</span>
                    {meta.reads && w.ch > 0 && <span className="hidden font-mono text-[9.5px] text-ff-muted lg:inline">follows ch{w.ch}</span>}
                  </span>
                  <span className="relative flex">
                    <button
                      data-menu-toggle={w.id}
                      onClick={() => setMenu(menu === w.id ? null : w.id)}
                      aria-haspopup="menu"
                      aria-expanded={menu === w.id}
                      className="flex h-full items-center border-l border-ff-line px-2.5 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-text"
                      title="Size, channel, order"
                    >
                      {w.w}·{heightLabel(w.h)}
                    </button>
                    {menu === w.id && (
                      <Menu
                        widget={w}
                        onChange={(p) => patch(w.id, p)}
                        onRemove={() => {
                          setLayout((xs) => xs.filter((x) => x.id !== w.id))
                          setMenu(null)
                        }}
                        onMove={(d) => move(w.id, d)}
                        close={() => setMenu(null)}
                      />
                    )}
                    <button
                      onClick={() => setLayout((xs) => xs.filter((x) => x.id !== w.id))}
                      className="flex h-full items-center border-l border-ff-line px-2.5 font-mono text-[11px] text-ff-muted hover:bg-ff-raised hover:text-ff-neg"
                      aria-label={`Remove ${meta.title}`}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                </header>
                <div className="ff-scroll min-h-0 flex-1 overflow-auto">
                  <Body sel={sel} select={(s) => setSelection((all) => ({ ...all, [key]: { ...(all[key] ?? {}), ...s } }))} w={w.w} h={w.h} />
                </div>
                <span
                  role="separator"
                  aria-label={`Resize ${meta.title}: ${w.w} columns by ${w.h} rows`}
                  title="Drag to resize"
                  onPointerDown={(e) => startResize(e, w)}
                  className={cx('ff-resize absolute bottom-0 right-0 z-10 hidden h-4 w-4 cursor-nwse-resize md:block', editing && 'ff-resize-on')}
                />
                {resizing === w.id && <span className="pointer-events-none absolute bottom-1.5 right-5 z-10 bg-ff-text px-1.5 py-0.5 font-mono text-[10.5px] text-ff-panel">{w.w} × {w.h}</span>}
              </section>
            )
          })}
        </div>
        {layout.length === 0 && (
          <div className="flex h-64 items-center justify-center font-mono text-[12px] text-ff-muted">
            <span className="ff-caret">empty board · add a widget</span>
          </div>
        )}
      </div>
    </>
  )
}

export default DashboardView
