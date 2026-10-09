import { describe, expect, it } from 'vitest'
import { THEMES, contrast, mix, themeVars } from '../themes'

const modes = THEMES.flatMap((t) => (['light', 'dark'] as const).filter((m) => t[m]).map((m) => ({ id: `${t.id}/${m}`, t: t[m]! })))

describe('themes', () => {
  it.each(modes)('$id: body text, secondary text and labels meet WCAG AA on panels and the page', ({ t }) => {
    for (const surface of [t.panel, t.bg, t.raised]) {
      expect(contrast(t.text, surface)).toBeGreaterThanOrEqual(7)
      expect(contrast(t.text2, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.muted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it.each(modes)('$id: accent, gain, loss and caution read as text on the panel', ({ t }) => {
    for (const ink of [t.accent, t.pos, t.neg, t.warn]) expect(contrast(ink, t.panel)).toBeGreaterThanOrEqual(4.5)
  })
  it.each(modes)('$id: button text reads on the button body', ({ t }) => {
    // The Aqua capsule runs from the accent at the top to accentDeep; the label sits mid-way.
    expect(contrast(t.onAccent, mix(t.accent, t.accentDeep, 0.5))).toBeGreaterThanOrEqual(3)
    expect(contrast(t.onAccent, t.accentDeep)).toBeGreaterThanOrEqual(4.5)
  })
  it('emits every token the stylesheet uses', () => {
    const v = themeVars(THEMES[0], 'light')
    for (const k of ['--ff-bg', '--ff-panel', '--ff-text', '--ff-accent', '--ff-accent-deep', '--ff-on-accent', '--ff-s5', '--ff-c4']) expect(v[k]).toMatch(/^\d+ \d+ \d+$/)
  })
})
