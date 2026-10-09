import { describe, expect, it } from 'vitest'
import { THEMES, contrast, mix, themeVars } from '../themes'

const modes = THEMES.flatMap((t) => (['light', 'dark'] as const).filter((m) => t[m]).map((m) => ({ id: `${t.id}/${m}`, t: t[m]! })))

describe('themes', () => {
  it.each(modes)('$id: body text, secondary text and labels meet WCAG AA on panels and the page', ({ t }) => {
    for (const surface of [t.panel, t.bg, t.raised, t.sunken]) {
      expect(contrast(t.text, surface)).toBeGreaterThanOrEqual(7)
      expect(contrast(t.text2, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.muted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it.each(modes)('$id: accent, gain, loss and caution read as text on the panel and on their own tinted chips', ({ t }) => {
    for (const ink of [t.accent, t.pos, t.neg, t.warn]) {
      expect(contrast(ink, t.panel)).toBeGreaterThanOrEqual(4.5)
      // Chips and badges tint the panel with their own ink (bg-ff-warn/15 and the like).
      expect(contrast(ink, mix(t.panel, ink, 0.15))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ink, mix(t.raised, ink, 0.1))).toBeGreaterThanOrEqual(4.5)
    }
  })
  it.each(modes)('$id: the two head-to-head series colours read as large figures', ({ t }) => {
    // The matchup sets each side's score in s1 and s2 at 26px (large text, 3:1).
    for (const ink of [t.s[0], t.s[1]]) expect(contrast(ink, t.panel)).toBeGreaterThanOrEqual(3)
  })
  it.each(modes)('$id: button text reads on the button body', ({ t }) => {
    // The Aqua capsule's label sits on accentDeep; the lighter accent only tints the top edge.
    expect(contrast(t.onAccent, t.accentDeep)).toBeGreaterThanOrEqual(4.5)
  })
  it('emits every token the stylesheet uses', () => {
    const v = themeVars(THEMES[0], 'light')
    for (const k of ['--ff-bg', '--ff-panel', '--ff-text', '--ff-accent', '--ff-accent-deep', '--ff-on-accent', '--ff-s5', '--ff-c4']) expect(v[k]).toMatch(/^\d+ \d+ \d+$/)
  })
})
