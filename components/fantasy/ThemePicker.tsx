import React from 'react'
import { THEMES, themeById, type Scheme, type Theme } from '../../lib/fantasy/themes'
import { Dropdown } from './ui'

const NEXT: Record<Scheme, Scheme> = { system: 'light', light: 'dark', dark: 'system' }
const GLYPH: Record<Scheme, string> = { system: '◐', light: '○', dark: '●' }
const NAME: Record<Scheme, string> = { system: 'Following the system', light: 'Light', dark: 'Dark' }

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

/**
 * Theme choice for the settings rail: Tailwind neutrals first, then the editor themes. Themes with
 * both modes get a toggle beside the picker that steps through system, light and dark.
 */
const ThemePicker = ({ value, onChange, scheme, onScheme }: { value: string; onChange: (id: string) => void; scheme: Scheme; onScheme: (s: Scheme) => void }) => {
  const both = !!(themeById(value).light && themeById(value).dark)
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <Dropdown
        label="Theme"
        value={value}
        onChange={onChange}
        className="min-w-0 flex-1 [&>button]:h-7"
        menuClassName="!left-auto right-0 max-h-[340px] min-w-[204px]"
        options={THEMES.map((t) => ({
          value: t.id,
          text: t.label,
          group: t.family === 'Tailwind' ? 'Tailwind neutrals' : 'Editor themes',
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <Swatch theme={t} />
              <span className="truncate">{t.label}</span>
            </span>
          ),
          face: (
            <span className="flex min-w-0 items-center gap-1.5">
              <Swatch theme={t} compact />
              <span className="truncate">{t.label}</span>
            </span>
          ),
          sub: t.family === 'Editor' ? (t.light ? 'light only' : 'dark only') : undefined,
        }))}
      />
      {both && (
        <button
          type="button"
          onClick={() => onScheme(NEXT[scheme])}
          className="-ml-px h-7 w-7 shrink-0 border border-ff-line bg-ff-panel font-mono text-[12px] text-ff-text2 hover:bg-ff-raised hover:text-ff-text"
          title={`${NAME[scheme]}. Click for ${NAME[NEXT[scheme]].toLowerCase()}.`}
          aria-label={`Mode: ${NAME[scheme]}. Switch to ${NAME[NEXT[scheme]]}`}
        >
          {GLYPH[scheme]}
        </button>
      )}
    </span>
  )
}

export default ThemePicker
