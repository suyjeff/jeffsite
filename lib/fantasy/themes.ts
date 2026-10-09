// Colour themes. Each sets the app's tokens (styles/fantasy.css) as "r g b"
// triplets on the root element, so every `bg-ff-*` and `rgb(var(--ff-*))` follows.
//
// Two families. The Tailwind neutrals (slate, gray, zinc, neutral, stone) come
// in a light and a dark mode and follow the system unless you pick one; their
// steps are mapped the same way in each, so only the cast of the grey changes.
// The editor themes are the popular VS Code ones, each in its own fixed mode,
// with text and muted inks nudged where the original falls under WCAG contrast
// for body text (Rosé Pine's "muted" is decorative in the editor, a label here).

export type Mode = 'light' | 'dark'
export type Scheme = 'system' | Mode

export type Tokens = {
  bg: string
  panel: string
  raised: string
  sunken: string
  line: string
  line2: string
  text: string
  text2: string
  muted: string
  accent: string
  /** The accent's darker step: button bodies and borders. */
  accentDeep: string
  /** Text set on the accent. */
  onAccent: string
  pos: string
  neg: string
  warn: string
  s: [string, string, string, string, string]
  /** Dashboard link channels. */
  c: [string, string, string, string]
}

export type Theme = { id: string; label: string; family: 'Tailwind' | 'Editor'; light?: Tokens; dark?: Tokens }

const hex = (h: string) => {
  const n = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
/** t of the way from a to b. */
export const mix = (a: string, b: string, t: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

// Shared inks for the neutral family, from the app's original validated palette.
const LIGHT_INKS = {
  accent: '#1c68cc',
  accentDeep: '#1655ab',
  onAccent: '#ffffff',
  pos: '#0a7a3a',
  neg: '#c82e2e',
  warn: '#966000',
  s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as Tokens['s'],
  c: ['#2a78d6', '#eb6834', '#1baf7a', '#a060dc'] as Tokens['c'],
}
const DARK_INKS = {
  accent: '#5298f0',
  accentDeep: '#2a64c4',
  onAccent: '#ffffff',
  pos: '#2ec470',
  neg: '#f46666',
  warn: '#e8ac3c',
  s: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as Tokens['s'],
  c: ['#4892ee', '#e8703c', '#28b280', '#aa78ec'] as Tokens['c'],
}

type Steps = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>

/** A Tailwind grey, mapped onto the tokens the same way for every cast. */
const neutral = (id: string, label: string, g: Steps): Theme => ({
  id,
  label,
  family: 'Tailwind',
  light: {
    bg: mix(g[50], g[100], 0.6),
    panel: '#ffffff',
    raised: g[50],
    sunken: g[100],
    line: g[200],
    line2: g[300],
    text: g[950],
    text2: g[700],
    // A touch darker than step 500, which falls just under 4.5:1 on the tinted page.
    muted: mix(g[500], g[600], 0.15),
    ...LIGHT_INKS,
  },
  dark: {
    bg: g[950],
    panel: mix(g[950], g[900], 0.55),
    raised: g[900],
    sunken: mix(g[950], g[900], 0.2),
    line: mix(g[900], g[800], 0.55),
    line2: g[800],
    text: g[50],
    text2: g[300],
    muted: g[400],
    ...DARK_INKS,
  },
})

export const THEMES: Theme[] = [
  neutral('zinc', 'Zinc', {
    50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b',
  }),
  neutral('slate', 'Slate', {
    50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617',
  }),
  neutral('gray', 'Gray', {
    50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712',
  }),
  neutral('neutral', 'Neutral', {
    50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717', 950: '#0a0a0a',
  }),
  neutral('stone', 'Stone', {
    50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917', 950: '#0c0a09',
  }),
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    family: 'Editor',
    dark: {
      bg: '#191724',
      panel: '#1f1d2e',
      raised: '#26233a',
      sunken: '#1b1928',
      line: '#2a2740',
      line2: '#403d52',
      text: '#e0def4',
      text2: '#c3c0de',
      muted: '#9a96b5',
      accent: '#c4a7e7',
      accentDeep: '#a487c9',
      onAccent: '#191724',
      pos: '#9ccfd8',
      neg: '#eb6f92',
      warn: '#f6c177',
      s: ['#9ccfd8', '#eb6f92', '#3e8fb0', '#f6c177', '#c4a7e7'],
      c: ['#9ccfd8', '#eb6f92', '#f6c177', '#c4a7e7'],
    },
  },
  {
    id: 'rose-pine-moon',
    label: 'Rosé Pine Moon',
    family: 'Editor',
    dark: {
      bg: '#232136',
      panel: '#2a273f',
      raised: '#393552',
      sunken: '#25233a',
      line: '#36334d',
      line2: '#44415a',
      text: '#e0def4',
      text2: '#c6c3e0',
      muted: '#a8a4c4',
      accent: '#c4a7e7',
      accentDeep: '#a487c9',
      onAccent: '#232136',
      pos: '#9ccfd8',
      neg: '#eb6f92',
      warn: '#f6c177',
      s: ['#9ccfd8', '#ea9a97', '#3e8fb0', '#f6c177', '#c4a7e7'],
      c: ['#9ccfd8', '#ea9a97', '#f6c177', '#c4a7e7'],
    },
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    family: 'Editor',
    light: {
      bg: '#faf4ed',
      panel: '#fffaf3',
      raised: '#f6efe7',
      sunken: '#f2e9e1',
      line: '#e8e1dc',
      line2: '#cecacd',
      text: '#464261',
      text2: '#575279',
      muted: '#6e6987',
      accent: '#286983',
      accentDeep: '#1f566c',
      onAccent: '#fffaf3',
      pos: '#2f7d6d',
      neg: '#a24f68',
      warn: '#93600f',
      s: ['#286983', '#d7827e', '#56949f', '#ea9d34', '#907aa9'],
      c: ['#286983', '#d7827e', '#ea9d34', '#907aa9'],
    },
  },
  {
    id: 'phosphor',
    label: 'Phosphor',
    family: 'Editor',
    dark: {
      bg: '#000000',
      panel: '#040904',
      raised: '#0a160a',
      sunken: '#020502',
      line: '#0f2a10',
      line2: '#1b4a1c',
      text: '#b6ffb0',
      text2: '#7fe57a',
      muted: '#4fb64c',
      accent: '#39ff14',
      accentDeep: '#2bd10e',
      onAccent: '#001a00',
      pos: '#39ff14',
      neg: '#ff5c57',
      warn: '#ffd23f',
      s: ['#39ff14', '#ffb000', '#00e5ff', '#ff4fd8', '#ffd23f'],
      c: ['#39ff14', '#ffb000', '#00e5ff', '#ff4fd8'],
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    family: 'Editor',
    dark: {
      bg: '#21222c',
      panel: '#282a36',
      raised: '#343746',
      sunken: '#1e1f29',
      line: '#363948',
      line2: '#44475a',
      text: '#f8f8f2',
      text2: '#d2d3dc',
      muted: '#9aa3c8',
      accent: '#bd93f9',
      accentDeep: '#a77ef5',
      onAccent: '#21222c',
      pos: '#50fa7b',
      neg: '#ff5555',
      warn: '#ffb86c',
      s: ['#8be9fd', '#ff79c6', '#50fa7b', '#ffb86c', '#bd93f9'],
      c: ['#8be9fd', '#ff79c6', '#50fa7b', '#bd93f9'],
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    family: 'Editor',
    dark: {
      bg: '#2b303b',
      panel: '#2e3440',
      raised: '#3b4252',
      sunken: '#292e39',
      line: '#3b4252',
      line2: '#4c566a',
      text: '#eceff4',
      text2: '#d8dee9',
      muted: '#a7b1c2',
      accent: '#88c0d0',
      accentDeep: '#81a1c1',
      onAccent: '#2e3440',
      pos: '#a3be8c',
      neg: '#de8c94',
      warn: '#ebcb8b',
      s: ['#88c0d0', '#d08770', '#a3be8c', '#ebcb8b', '#b48ead'],
      c: ['#88c0d0', '#d08770', '#a3be8c', '#b48ead'],
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    family: 'Editor',
    dark: {
      bg: '#16161e',
      panel: '#1a1b26',
      raised: '#24283b',
      sunken: '#14141b',
      line: '#232433',
      line2: '#3b4261',
      text: '#c0caf5',
      text2: '#a9b1d6',
      muted: '#8d96c0',
      accent: '#7aa2f7',
      accentDeep: '#3d59a1',
      onAccent: '#ffffff',
      pos: '#9ece6a',
      neg: '#f7768e',
      warn: '#e0af68',
      s: ['#7aa2f7', '#ff9e64', '#9ece6a', '#e0af68', '#bb9af7'],
      c: ['#7aa2f7', '#ff9e64', '#9ece6a', '#bb9af7'],
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    family: 'Editor',
    light: {
      bg: '#eee8d5',
      panel: '#fdf6e3',
      raised: '#f7f0dc',
      sunken: '#f1ebd7',
      line: '#e4ddc7',
      line2: '#d3cbb4',
      text: '#073642',
      text2: '#46595f',
      muted: '#556970',
      accent: '#1f6fa8',
      accentDeep: '#185a8a',
      onAccent: '#fdf6e3',
      pos: '#5f7300',
      neg: '#c22d2a',
      warn: '#8c6a00',
      s: ['#268bd2', '#cb4b16', '#2aa198', '#b58900', '#d33682'],
      c: ['#268bd2', '#cb4b16', '#2aa198', '#6c71c4'],
    },
  },
]

export const DEFAULT_THEME = 'zinc'

export const themeById = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!

/** The mode a theme renders in: its only one, or the scheme's pick (the system's by default). */
export const resolveMode = (theme: Theme, scheme: Scheme, systemDark: boolean): Mode => {
  if (!theme.light) return 'dark'
  if (!theme.dark) return 'light'
  return scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme
}

const rgb = (h: string) => hex(h).join(' ')

/** CSS custom properties for a theme in a mode, ready for a style attribute. */
export const themeVars = (theme: Theme, mode: Mode): Record<string, string> => {
  const t = (mode === 'dark' ? theme.dark : theme.light) ?? theme.dark ?? theme.light!
  return {
    colorScheme: mode,
    '--ff-bg': rgb(t.bg),
    '--ff-panel': rgb(t.panel),
    '--ff-raised': rgb(t.raised),
    '--ff-sunken': rgb(t.sunken),
    '--ff-line': rgb(t.line),
    '--ff-line2': rgb(t.line2),
    '--ff-text': rgb(t.text),
    '--ff-text2': rgb(t.text2),
    '--ff-muted': rgb(t.muted),
    '--ff-accent': rgb(t.accent),
    '--ff-accent-deep': rgb(t.accentDeep),
    '--ff-on-accent': rgb(t.onAccent),
    '--ff-accent2': rgb(mix(t.panel, t.accent, 0.18)),
    '--ff-pos': rgb(t.pos),
    '--ff-neg': rgb(t.neg),
    '--ff-warn': rgb(t.warn),
    ...Object.fromEntries(t.s.map((c, i) => [`--ff-s${i + 1}`, rgb(c)])),
    ...Object.fromEntries(t.c.map((c, i) => [`--ff-c${i + 1}`, rgb(c)])),
  }
}

/** The page colour for the browser chrome (theme-color). */
export const themeBg = (theme: Theme, mode: Mode) => ((mode === 'dark' ? theme.dark : theme.light) ?? theme.dark ?? theme.light!).bg

/** WCAG relative luminance contrast between two hex colours. */
export const contrast = (a: string, b: string) => {
  const lum = (h: string) => {
    const [r, g, bl] = hex(h).map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
