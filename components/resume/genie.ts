// The macOS "genie" minimise, drawn with horizontal strips of the page. Each strip is a trapezoid (a projective
// matrix3d), so neighbouring strips share edges exactly and the funnel's curved sides stay smooth with only a few
// dozen strips. Progress runs 0 (the page where it rests) to 1 (swallowed by the link); opening plays it backwards.

export type Rect = { x: number; y: number; w: number; h: number }
export type Tilt = { rx: number; ry: number }
type Pt = [number, number]

export const STRIPS = 36
/** The paper's perspective distance, shared with the CSS tilt so a tilted page hands over to the strips exactly. */
export const PERSPECTIVE = 1800

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
/** Soft floor at zero: follows d far from the neck and eases to 0 past it, so rows bunch up instead of clipping. */
const softplus = (d: number, k: number) => (d > k * 8 ? d : k * Math.log1p(Math.exp(d / k)))

/** Where a point on the page (relative to its top-left) lands on screen when the page is tilted as in CSS. */
function tilted(p: Rect, lx: number, ly: number, { rx, ry }: Tilt): Pt {
  const X = lx - p.w / 2
  const Y = ly - p.h / 2
  const a = (rx * Math.PI) / 180
  const b = (ry * Math.PI) / 180
  // rotateX(rx) rotateY(ry): Y first, then X.
  const x1 = X * Math.cos(b)
  const z1 = -X * Math.sin(b)
  const y2 = Y * Math.cos(a) - z1 * Math.sin(a)
  const z2 = Y * Math.sin(a) + z1 * Math.cos(a)
  const s = PERSPECTIVE / (PERSPECTIVE - z2)
  return [p.x + p.w / 2 + x1 * s, p.y + p.h / 2 + y2 * s]
}

/**
 * The strip boundaries at progress t: STRIPS + 1 rows, each a left and a right point on screen.
 * `tilt` is the page's tilt as the close begins; it straightens out over the first third.
 */
export function genieRows(t: number, page: Rect, target: Rect, tilt: Tilt): [Pt, Pt][] {
  const bend = easeOutCubic(clamp01(t / 0.36))
  // The slide accelerates all the way into the link and lands there before the last wisp fades: pulled, not pushed.
  const slide = clamp01((t - 0.08) / 0.86) ** 2
  const straighten = 1 - easeOutCubic(clamp01(t / 0.3))
  const tiltNow = { rx: tilt.rx * straighten, ry: tilt.ry * straighten }

  // Work as if the link sits below the page; a link above is the same picture mirrored.
  const down = target.y + target.h / 2 >= page.y + page.h / 2
  const flip = (y: number) => (down ? y : -y)
  const top = down ? page.y : -(page.y + page.h)
  const neck = flip(target.y + target.h / 2)
  const k = Math.max(page.h * 0.016, 6)
  // The top edge travels a little past the neck, so by the end the whole page has bunched into the link.
  const reach = Math.max(neck - top, 1) + 3 * k
  const neckW = Math.max(target.w, 24)
  const neckL = target.x + target.w / 2 - neckW / 2

  const rows: [Pt, Pt][] = []
  for (let i = 0; i <= STRIPS; i++) {
    const v = i / STRIPS
    const vReal = down ? v : 1 - v
    const slid = top + v * page.h + slide * reach
    const y = lerp(slid, neck - softplus(neck - slid, k), bend)
    // The funnel: full width at the page's top edge, the link's width at the neck, an S-curve between.
    const f = smooth(0, 1, (y - top) / (neck - top || 1))
    const l = lerp(page.x, lerp(page.x, neckL, f), bend)
    const r = lerp(page.x + page.w, lerp(page.x + page.w, neckL + neckW, f), bend)
    const yScreen = flip(y)
    // Carry the tilt as an offset on top of the flat shape, so the first frame matches the tilted page.
    const rowY = page.y + vReal * page.h
    const tl = tilted(page, 0, vReal * page.h, tiltNow)
    const tr = tilted(page, page.w, vReal * page.h, tiltNow)
    rows.push([
      [l + tl[0] - page.x, yScreen + tl[1] - rowY],
      [r + tr[0] - (page.x + page.w), yScreen + tr[1] - rowY],
    ])
  }
  return down ? rows : rows.reverse()
}

/** A CSS matrix3d taking the box (0,0)-(w,h) onto the quad tl, tr, br, bl (Heckbert's square-to-quad). */
export function quadMatrix(w: number, h: number, tl: Pt, tr: Pt, br: Pt, bl: Pt): string {
  const [x0, y0] = tl
  const [x1, y1] = tr
  const [x2, y2] = br
  const [x3, y3] = bl
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const dy3 = y0 - y1 + y2 - y3
  let g = 0
  let hh = 0
  if (Math.abs(dx3) > 1e-6 || Math.abs(dy3) > 1e-6) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-6
    g = (dx3 * dy2 - dx2 * dy3) / den
    hh = (dx1 * dy3 - dx3 * dy1) / den
  }
  const a = x1 - x0 + g * x1
  const b = x3 - x0 + hh * x3
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + hh * y3
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1]
  return `matrix3d(${m.map((n) => +n.toPrecision(8)).join(',')})`
}
