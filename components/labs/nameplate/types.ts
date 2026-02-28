export type ThemeId = 'portfolio' | 'mauve' | 'brat' | 'nyt'
export type FontId = 'default' | 'serif' | 'mono'
export type EffectId = 'solid' | 'gradient' | 'neon' | 'toon' | 'pop'

export interface NameplateData {
  id: string
  name: string
  theme: ThemeId
  font: FontId
  effect: EffectId
  createdAt: string
  visitorToken: string
}

export interface ThemeConfig {
  label: string
  bg: string
  border: string
  text: string
  glow: string
  outline: string
  gradientFrom: string
  gradientTo: string
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  portfolio: {
    label: 'Portfolio',
    bg: 'bg-stone-100 dark:bg-stone-900',
    border: 'border-stone-300 dark:border-stone-700',
    text: 'text-stone-900 dark:text-stone-100',
    glow: '#a8a29e',
    outline: '#78716c',
    gradientFrom: '#78716c',
    gradientTo: '#d6d3d1',
  },
  mauve: {
    label: 'Mauve',
    bg: 'bg-purple-50 dark:bg-purple-950',
    border: 'border-purple-300 dark:border-purple-700',
    text: 'text-purple-900 dark:text-purple-100',
    glow: '#c084fc',
    outline: '#7e22ce',
    gradientFrom: '#7e22ce',
    gradientTo: '#e9d5ff',
  },
  brat: {
    label: 'Brat',
    bg: 'bg-lime-100 dark:bg-lime-950',
    border: 'border-lime-400 dark:border-lime-600',
    text: 'text-lime-950 dark:text-lime-100',
    glow: '#a3e635',
    outline: '#365314',
    gradientFrom: '#a3e635',
    gradientTo: '#ecfccb',
  },
  nyt: {
    label: 'NYT',
    bg: 'bg-white dark:bg-neutral-950',
    border: 'border-neutral-900 dark:border-neutral-300',
    text: 'text-neutral-900 dark:text-neutral-100',
    glow: '#a3a3a3',
    outline: '#171717',
    gradientFrom: '#171717',
    gradientTo: '#737373',
  },
}

export const FONTS: { id: FontId; label: string; className: string }[] = [
  { id: 'default', label: 'Lars', className: 'font-sans' },
  { id: 'serif', label: 'Serif', className: 'font-nameplate-serif' },
  { id: 'mono', label: 'Mono', className: 'font-nameplate-mono' },
]

export const EFFECTS: { id: EffectId; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'neon', label: 'Neon' },
  { id: 'toon', label: 'Toon' },
  { id: 'pop', label: 'Pop' },
]
