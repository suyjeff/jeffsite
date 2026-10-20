import { describe, expect, it } from 'vitest'
import { genieRows, quadMatrix, STRIPS } from '../genie'

const page = { x: 360, y: 56, w: 560, h: 725 }
const link = { x: 480, y: 762, w: 56, h: 24 }
const flat = { rx: 0, ry: 0 }

/** Apply a CSS matrix3d string to a point, as the browser would. */
function project(m: string, x: number, y: number) {
  const v = m.slice(9, -1).split(',').map(Number)
  const X = v[0] * x + v[4] * y + v[12]
  const Y = v[1] * x + v[5] * y + v[13]
  const W = v[3] * x + v[7] * y + v[15]
  return [X / W, Y / W]
}

describe('genieRows', () => {
  it('starts as the page itself', () => {
    const rows = genieRows(0, page, link, flat)
    expect(rows).toHaveLength(STRIPS + 1)
    rows.forEach(([l, r], i) => {
      expect(l[0]).toBeCloseTo(page.x)
      expect(r[0]).toBeCloseTo(page.x + page.w)
      expect(l[1]).toBeCloseTo(page.y + (i / STRIPS) * page.h)
    })
  })

  it('ends bunched into the link', () => {
    for (const [l, r] of genieRows(1, page, link, flat)) {
      expect(l[0]).toBeGreaterThanOrEqual(link.x - 1)
      expect(r[0]).toBeLessThanOrEqual(link.x + link.w + 1)
      expect(Math.abs(l[1] - (link.y + link.h / 2))).toBeLessThan(4)
    }
  })

  it('keeps strips stacked in order, with no gaps or folds, throughout', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const rows = genieRows(t, page, link, flat)
      for (let i = 1; i < rows.length; i++) expect(rows[i][0][1]).toBeGreaterThanOrEqual(rows[i - 1][0][1] - 1e-6)
    }
  })

  it('works the same for a link above the page', () => {
    const above = { ...link, y: 10 }
    const rows = genieRows(1, page, above, flat)
    expect(rows[0][0][1]).toBeLessThanOrEqual(rows[STRIPS][0][1])
    for (const [l] of rows) expect(Math.abs(l[1] - (above.y + above.h / 2))).toBeLessThan(4)
  })
})

describe('quadMatrix', () => {
  it('maps the box corners onto the quad, trapezoids included', () => {
    const tl: [number, number] = [10, 20]
    const tr: [number, number] = [210, 25]
    const br: [number, number] = [160, 120]
    const bl: [number, number] = [40, 110]
    const m = quadMatrix(300, 50, tl, tr, br, bl)
    const corners = [project(m, 0, 0), project(m, 300, 0), project(m, 300, 50), project(m, 0, 50)]
    ;[tl, tr, br, bl].forEach((p, i) => {
      expect(corners[i][0]).toBeCloseTo(p[0], 2)
      expect(corners[i][1]).toBeCloseTo(p[1], 2)
    })
  })
})
