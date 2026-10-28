// Colour themes. Each sets the app's tokens (styles/fantasy.css) as "r g b"
// triplets on the root element, so every `bg-ff-*` and `rgb(var(--ff-*))` follows.
//
// Two families. The Tailwind neutrals (zinc, slate) come in a light and a dark
// mode and follow the system unless you pick one; their steps are mapped the
// same way in each, so only the cast of the grey changes. The editor and
// terminal themes are the popular ones, most in a fixed mode (Catppuccin and
// Gruvbox carry both of theirs), with text and muted inks nudged where the
// original falls under WCAG contrast for body text (Rosé Pine's "muted" is
// decorative in the editor, a label here).

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
  accent: '#1a5fbd',
  accentDeep: '#1655ab',
  onAccent: '#ffffff',
  pos: '#08703a',
  neg: '#b82828',
  warn: '#8a5800',
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
    50: '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#3f3f46',
    800: '#27272a',
    900: '#18181b',
    950: '#09090b',
  }),
  neutral('slate', 'Slate', {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  }),
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    family: 'Editor',
    // Latte: base #eff1f5, mantle #e6e9ef, crust #dce0e8, surface0 #ccd0da, surface1 #bcc0cc.
    light: {
      bg: '#e6e9ef',
      panel: '#eff1f5',
      raised: '#f6f7fa',
      sunken: '#dce0e8',
      line: '#ccd0da',
      line2: '#bcc0cc',
      text: '#3d4058',
      text2: '#4c4f69',
      muted: '#5c5f77',
      accent: '#7a33d7',
      accentDeep: '#7a33d7',
      onAccent: '#ffffff',
      pos: '#276d1b',
      neg: '#b80e33',
      warn: '#8e5106',
      s: ['#1e66f5', '#ec5d0a', '#179299', '#df8e1d', '#ea76cb'],
      c: ['#1e66f5', '#ec5d0a', '#40a02b', '#8839ef'],
    },
    // Mocha: base #1e1e2e, mantle #181825, crust #11111b, surface0 #313244, surface1 #45475a.
    dark: {
      bg: '#181825',
      panel: '#1e1e2e',
      raised: '#313244',
      sunken: '#11111b',
      line: '#2a2b3c',
      line2: '#45475a',
      text: '#cdd6f4',
      text2: '#bac2de',
      muted: '#a6adc8',
      accent: '#cba6f7',
      accentDeep: '#b48ee8',
      onAccent: '#11111b',
      pos: '#a6e3a1',
      neg: '#f38ba8',
      warn: '#fab387',
      s: ['#89b4fa', '#fab387', '#94e2d5', '#f9e2af', '#f5c2e7'],
      c: ['#89b4fa', '#fab387', '#a6e3a1', '#cba6f7'],
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    family: 'Editor',
    // Light: bg0_s #f2e5bc, bg0 #fbf1c7, bg0_h #f9f5d7, bg1 #ebdbb2, bg2 #d5c4a1; faded inks.
    light: {
      bg: '#f2e5bc',
      panel: '#fbf1c7',
      raised: '#fdf7d9',
      sunken: '#ebdbb2',
      line: '#e0d1a6',
      line2: '#d5c4a1',
      text: '#282828',
      text2: '#3c3836',
      muted: '#5a504a',
      accent: '#aa3803',
      accentDeep: '#aa3803',
      onAccent: '#fbf1c7',
      pos: '#676209',
      neg: '#9d0006',
      warn: '#855009',
      s: ['#076678', '#d65d0e', '#427b58', '#b57614', '#8f3f71'],
      c: ['#076678', '#d65d0e', '#79740e', '#8f3f71'],
    },
    // Dark: bg0_h #1d2021, bg0 #282828, bg1 #3c3836, bg2 #504945; bright inks.
    dark: {
      bg: '#1d2021',
      panel: '#282828',
      raised: '#3c3836',
      sunken: '#181a1b',
      line: '#35322f',
      line2: '#504945',
      text: '#ebdbb2',
      text2: '#d5c4a1',
      muted: '#bdae93',
      accent: '#fe9640',
      accentDeep: '#e06a0b',
      onAccent: '#1d2021',
      pos: '#b8bb26',
      neg: '#fd9487',
      warn: '#fabd2f',
      s: ['#83a598', '#fe8019', '#8ec07c', '#fabd2f', '#d3869b'],
      c: ['#83a598', '#fe8019', '#b8bb26', '#d3869b'],
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    family: 'Editor',
    dark: {
      bg: '#1e1f1c',
      panel: '#272822',
      raised: '#3e3d32',
      sunken: '#191a17',
      line: '#34352c',
      line2: '#49483e',
      text: '#f8f8f2',
      text2: '#dcdcd2',
      // The comment grey (#75715e) is dim for a label; this is its lifted step.
      muted: '#b0ac96',
      accent: '#66d9ef',
      accentDeep: '#3fb6d3',
      onAccent: '#1e1f1c',
      pos: '#a6e22e',
      neg: '#ff9d84',
      warn: '#e6db74',
      s: ['#66d9ef', '#f92672', '#a6e22e', '#fd971f', '#ae81ff'],
      c: ['#66d9ef', '#f92672', '#a6e22e', '#ae81ff'],
    },
  },
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
      neg: '#f17f9f',
      warn: '#f6c177',
      // Series 1 is pine, not foam: foam is the gain colour here, and your side of a matchup is not a gain.
      s: ['#3e8fb0', '#eb6f92', '#9ccfd8', '#f6c177', '#c4a7e7'],
      c: ['#3e8fb0', '#eb6f92', '#f6c177', '#c4a7e7'],
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
      neg: '#f7abc0',
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
      muted: '#625d7c',
      accent: '#286983',
      accentDeep: '#1f566c',
      onAccent: '#fffaf3',
      pos: '#25685a',
      neg: '#924560',
      warn: '#80530b',
      s: ['#286983', '#b4637a', '#56949f', '#ea9d34', '#907aa9'],
      c: ['#286983', '#b4637a', '#ea9d34', '#907aa9'],
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
      accent: '#c9a6fb',
      accentDeep: '#a77ef5',
      onAccent: '#21222c',
      pos: '#50fa7b',
      neg: '#ff9a9a',
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
      accent: '#96cbd9',
      accentDeep: '#81a1c1',
      onAccent: '#2e3440',
      pos: '#b2cb9e',
      neg: '#f2b8bd',
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
      accent: '#1a6197',
      accentDeep: '#185a8a',
      onAccent: '#fdf6e3',
      pos: '#506200',
      neg: '#a92623',
      warn: '#735700',
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

/** A theme's colours in a mode: that mode's, or its only one. */
export const tokensFor = (theme: Theme, mode: Mode): Tokens => ((mode === 'dark' ? theme.dark : theme.light) ?? theme.dark ?? theme.light)!

/** The crown's gold as RGB triplets: a fill, and a deeper ink for gold text that holds 4.5:1 on the panel. */
const GOLD = { light: '182 128 4', lightInk: '140 98 0', dark: '242 193 78', darkInk: '246 205 110' }

/** CSS custom properties for a theme in a mode, ready for a style attribute. */
export const themeVars = (theme: Theme, mode: Mode): Record<string, string> => {
  const t = tokensFor(theme, mode)
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
    // The power-rank crown: one gold for every theme, per mode (fantasy.css has the same pair for before a theme loads).
    '--ff-gold': mode === 'dark' ? GOLD.dark : GOLD.light,
    '--ff-gold-ink': mode === 'dark' ? GOLD.darkInk : GOLD.lightInk,
  }
}

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
