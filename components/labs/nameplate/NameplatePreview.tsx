import React from 'react'
import {
  ThemeId, FontId, EffectId,
  THEMES, FONTS,
} from './types'

interface Props {
  name: string
  theme: ThemeId
  font: FontId
  effect: EffectId
  compact?: boolean
  borderOverride?: string
}

function effectClass(effect: EffectId): string {
  switch (effect) {
    case 'solid':    return 'np-effect-solid'
    case 'gradient': return 'np-effect-gradient'
    case 'neon':     return 'np-effect-neon'
    case 'toon':     return 'np-effect-toon'
    case 'pop':      return 'np-effect-pop'
  }
}

const NameplatePreview: React.FC<Props> = ({ name, theme, font, effect, compact, borderOverride }) => {
  const t = THEMES[theme]
  const f = FONTS.find(x => x.id === font) ?? FONTS[0]

  const effectStyles: React.CSSProperties = {
    '--np-glow': t.glow,
    '--np-outline': t.outline,
  } as React.CSSProperties

  if (effect === 'gradient') {
    effectStyles.backgroundImage = `linear-gradient(90deg, ${t.gradientFrom}, ${t.gradientTo}, ${t.gradientFrom})`
  }

  return (
    <div
      className={`
        inline-block rounded-lg border-2 px-4 py-2 select-none transition-[border-color] duration-200 ease-out
        ${t.bg} ${borderOverride ?? t.border}
        ${compact ? 'px-3 py-1.5' : 'px-5 py-3'}
      `}
    >
      <span
        className={`
          ${compact ? 'text-base' : 'text-xl'} font-bold leading-tight
          ${f.className} ${t.text} ${effectClass(effect)}
        `}
        style={effectStyles}
      >
        {name || '\u00A0'}
      </span>
    </div>
  )
}

export default NameplatePreview
