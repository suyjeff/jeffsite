import React, { useEffect, useId, useRef, useState } from 'react'
import { THEMES, themeById, type Scheme, type Theme } from '../../lib/fantasy/themes'
import { Segmented, cx } from './ui'

export type Density = 'compact' | 'comfortable'

const MODE_LABEL: Record<Scheme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }

/** Four chips of a theme's own colours: page, panel, accent, and the first series. */
export const Swatch = ({ theme, compact }: { theme: Theme; compact?: boolean }) => {
  const t = theme.dark ?? theme.light!
  const l = theme.light ?? theme.dark!
  const chips = compact ? [t.bg, t.accent] : [l.panel, t.bg, t.accent, t.s[1]]
  return (
    <span aria-hidden className="inline-flex shrink-0 border border-ff-line2">
      {chips.map((c, i) => (
        <span key={i} className="h-3 w-2" style={{ background: c }} />
      ))}
    </span>
  )
}

const ThemeOption = ({ theme, checked, name, onPick }: { theme: Theme; checked: boolean; name: string; onPick: () => void }) => (
  <label
    className={cx(
      'relative flex min-w-0 cursor-pointer items-center gap-2 border px-2 py-1.5 text-[12px] transition-colors',
      checked ? 'border-ff-accent bg-ff-accent/10 text-ff-text' : 'border-ff-line text-ff-text2 hover:border-ff-line2 hover:text-ff-text',
      'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ff-accent',
    )}
  >
    <input type="radio" name={name} checked={checked} onChange={onPick} className="sr-only" />
    <Swatch theme={theme} compact />
    <span className="min-w-0 flex-1 truncate">{theme.label}</span>
    {/* Most themes come in both; the few that don't say which one they are. */}
    {!(theme.light && theme.dark) && <span className="font-mono text-[9.5px] text-ff-muted">{theme.light ? 'light' : 'dark'}</span>}
  </label>
)

/**
 * Display settings for the settings rail: theme, light or dark, and density. One row that opens a
 * small panel, so the rail stays short and every choice is spelled out (no glyph to decode).
 */
const DisplayMenu = ({
  theme: themeId,
  onTheme,
  scheme,
  onScheme,
  density,
  onDensity,
}: {
  theme: string
  onTheme: (id: string) => void
  scheme: Scheme
  onScheme: (s: Scheme) => void
  density: Density
  onDensity: (d: Density) => void
}) => {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const theme = themeById(themeId)
  const both = !!(theme.light && theme.dark)

  useEffect(() => {
    if (!open) return
    // Focus the checked theme, the choice people come here for most.
    panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    // Tabbing out closes it, like a menu. Focus landing outside is the signal, not a blur: a click on padding or on a
    // control that takes no focus (Safari buttons) blurs with no target and must not close the panel under the pointer.
    const focusOut = (e: FocusEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key, true)
    document.addEventListener('focusin', focusOut)
    return () => {
      document.removeEventListener('focusin', focusOut)
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((x) => !x)}
        className={cx(
          'flex h-7 w-full min-w-0 items-center gap-1.5 border bg-ff-panel pl-2 pr-1.5 text-left text-[12px] text-ff-text transition-colors',
          open ? 'border-ff-line2' : 'border-ff-line hover:border-ff-line2',
        )}
      >
        <Swatch theme={theme} compact />
        <span className="min-w-0 flex-1 truncate">
          {theme.label}
          <span className="text-ff-muted"> · {both ? MODE_LABEL[scheme] : theme.light ? 'Light' : 'Dark'}</span>
        </span>
        <span aria-hidden className={cx('font-mono text-[10px] text-ff-muted motion-safe:transition-transform motion-safe:duration-150', open && 'rotate-180')}>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Display"
          className="ff-pop absolute bottom-full left-0 z-50 mb-1 w-[288px] max-w-[calc(100vw-24px)] border border-ff-line2 bg-ff-panel shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]"
        >
          <div className="space-y-2.5 border-b border-ff-line p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="ff-label">Mode</span>
              {both ? (
                <Segmented<Scheme>
                  size="sm"
                  label="Mode"
                  value={scheme}
                  onChange={onScheme}
                  options={[
                    { key: 'system', label: 'Auto', title: 'Follow your device' },
                    { key: 'light', label: 'Light' },
                    { key: 'dark', label: 'Dark' },
                  ]}
                />
              ) : (
                <span className="font-mono text-[11px] text-ff-muted">
                  {theme.label} is {theme.light ? 'light' : 'dark'} only
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="ff-label">Density</span>
              <Segmented<Density>
                size="sm"
                label="Density"
                value={density}
                onChange={onDensity}
                options={[
                  { key: 'compact', label: 'Compact', title: 'More on screen' },
                  { key: 'comfortable', label: 'Comfortable', title: 'Larger type, roomier rows' },
                ]}
              />
            </div>
          </div>
          <fieldset className="max-h-[min(340px,50vh)] overflow-y-auto overscroll-contain p-3">
            <legend className="ff-label float-left mb-1.5 w-full">Theme</legend>
            <div className="clear-both grid grid-cols-2 gap-1">
              {THEMES.map((t) => (
                <ThemeOption key={t.id} theme={t} name={`${id}-theme`} checked={t.id === theme.id} onPick={() => onTheme(t.id)} />
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  )
}

export default DisplayMenu
