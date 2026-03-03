import React, { useState } from 'react'
import {
  ThemeId, FontId, EffectId, NameplateData,
  THEMES, FONTS, EFFECTS,
} from './types'
import NameplatePreview from './NameplatePreview'

const THEME_SWATCHES: { id: ThemeId; swatch: string }[] = [
  { id: 'portfolio', swatch: 'bg-stone-400' },
  { id: 'mauve',     swatch: 'bg-purple-400' },
  { id: 'brat',      swatch: 'bg-lime-400' },
  { id: 'nyt',       swatch: 'bg-neutral-900 dark:bg-neutral-100' },
]

const MAX_NAME = 24

interface Props {
  onSubmit: (plate: Omit<NameplateData, 'id' | 'createdAt' | 'visitorToken'>) => void
  submitting: boolean
  alreadySubmitted: boolean
}

const NameplateDesigner: React.FC<Props> = ({ onSubmit, submitting, alreadySubmitted }) => {
  const [name, setName] = useState('')
  const [theme, setTheme] = useState<ThemeId>('portfolio')
  const [font, setFont] = useState<FontId>('default')
  const [effect, setEffect] = useState<EffectId>('solid')

  const canSubmit = name.trim().length > 0 && name.trim().length <= MAX_NAME && !submitting && !alreadySubmitted

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({ name: name.trim(), theme, font, effect })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Live preview */}
      <div className="flex items-center justify-center py-8 rounded-lg bg-stone-200/50 dark:bg-stone-800/30">
        <NameplatePreview name={name || 'Your Name'} theme={theme} font={font} effect={effect} />
      </div>

      {/* Controls */}
      <div className="y2k-panel p-5 flex flex-col gap-5">
        {/* Name input */}
        <div>
          <label className="y2k-label">Name</label>
          <input
            type="text"
            className="y2k-input"
            placeholder="Enter your name..."
            maxLength={MAX_NAME}
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <div className="mt-1 text-xs text-stone-400 text-right">{name.length}/{MAX_NAME}</div>
        </div>

        {/* Theme picker */}
        <div>
          <span className="y2k-label">Theme</span>
          <div className="grid grid-cols-4 gap-2">
            {THEME_SWATCHES.map(ts => (
              <button
                key={ts.id}
                type="button"
                className="y2k-tile"
                data-selected={theme === ts.id}
                onClick={() => setTheme(ts.id)}
              >
                <span className={`w-7 h-7 rounded-full border border-black/10 ${ts.swatch}`} />
                <span className="text-[10px] font-semibold tracking-wide text-stone-600 dark:text-stone-400">
                  {THEMES[ts.id].label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Font picker */}
        <div>
          <span className="y2k-label">Typeface</span>
          <div className="grid grid-cols-3 gap-2">
            {FONTS.map(f => (
              <button
                key={f.id}
                type="button"
                className="y2k-tile"
                data-selected={font === f.id}
                onClick={() => setFont(f.id)}
              >
                <span className={`text-lg font-bold ${f.className} text-stone-800 dark:text-stone-200`}>Aa</span>
                <span className="text-[10px] font-semibold tracking-wide text-stone-600 dark:text-stone-400">{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Effect picker */}
        <div>
          <span className="y2k-label">Name Effect</span>
          <div className="grid grid-cols-3 gap-2">
            {EFFECTS.map(e => (
              <button
                key={e.id}
                type="button"
                className="y2k-tile py-3"
                data-selected={effect === e.id}
                onClick={() => setEffect(e.id)}
              >
                <EffectSwatch effectId={e.id} theme={theme} label={e.label} />
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="button"
          className="y2k-btn y2k-btn-submit w-full py-3 text-base"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? 'Placing...' : alreadySubmitted ? 'Already Placed' : 'Place on Board ✦'}
        </button>
      </div>
    </div>
  )
}

function EffectSwatch({ effectId, theme, label }: { effectId: EffectId; theme: ThemeId; label: string }) {
  const t = THEMES[theme]
  const cls = `text-sm font-bold np-effect-${effectId}`
  const style: React.CSSProperties = {
    '--np-glow': t.glow,
    '--np-outline': t.outline,
  } as React.CSSProperties

  if (effectId === 'gradient') {
    style.backgroundImage = `linear-gradient(90deg, ${t.gradientFrom}, ${t.gradientTo}, ${t.gradientFrom})`
  }

  return (
    <span className={`${cls} text-stone-800 dark:text-stone-200`} style={style}>
      {label}
    </span>
  )
}

export default NameplateDesigner
