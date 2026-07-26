// Geometry for the peelable name sticker: the cursive artwork, the soft blob
// die-cut around it, and the edge queries the peel interaction needs.

// The signature path, lifted verbatim from the original written-name header so
// the lettering keeps the exact same graphical style.
export const SCRIPT_PATH =
  'M11.6962 21.893C11.1323 21.8719 9.61909 21.7646 8.37298 21.4882C7.23484 21.2358 6.17512 20.4963 5.22454 19.9369C4.28248 19.3826 3.63886 17.7 3.22169 16.0583C2.3774 12.7356 3.98751 10.9324 5.74376 8.12728C6.54946 6.8404 8.82231 5.21175 11.5556 3.3173C12.9285 2.36575 13.833 2.13386 15.0661 1.84138C19.0383 0.899174 21.669 1.32167 22.0436 1.50045C22.7484 1.83685 23.0163 3.29264 23.2118 4.80383C23.2934 5.43432 23.2212 6.47118 22.8275 8.16016C22.4337 9.84913 21.6506 12.1641 20.5043 14.8396C19.358 17.5152 17.8722 20.4812 16.8901 22.5326C15.908 24.5839 15.4745 25.6307 14.8082 26.8929C13.3512 29.6531 11.9924 31.5681 11.0842 32.7642C8.85523 35.7 7.21088 36.8373 6.1195 37.625C4.97031 38.4543 3.52945 38.3889 2.51711 38.1882C1.70345 38.0268 1.494 36.8906 1.31484 35.5043C1.04034 33.3805 1.68839 32.2187 2.24653 31.2097C2.99498 29.8567 5.42845 28.2709 6.37405 27.4063C7.13759 26.7081 8.41246 25.6516 9.39815 24.8464C10.2021 24.1896 13.3271 22.35 15.2093 21.3146C15.8997 20.9348 17.9457 20.5018 19.5299 20.0734C20.4267 19.8308 21.4516 19.5109 23.818 18.4438C25.7325 17.5805 27.1988 16.3028 28.2516 15.1351C28.9807 14.3264 28.8063 13.5089 28.7154 13.0228C28.5626 12.2062 26.6333 12.4454 25.4987 12.6891C24.6976 12.8611 24.1478 14.533 23.7436 16.2842C22.9385 19.7711 23.7315 21.9472 24.0698 22.893C24.1994 23.2553 24.6002 23.439 25.0056 23.5903C26.677 24.2141 30.0588 23.5174 31.9047 22.9155C32.8119 22.6196 33.4585 22.0207 34.4512 21.0229C36.4967 18.9672 37.9817 16.7972 38.7017 15.4967C39.4216 14.1965 40.4245 10.9824 41.7036 7.06413C42.3039 5.22541 42.2746 4.40417 42.1981 3.73565C42.1387 3.21759 41.6266 2.98976 41.2397 2.83563C40.4185 2.50853 39.4721 2.84651 38.444 3.39688C37.9722 3.64949 37.7035 4.04933 37.4022 4.53779C36.9212 5.31787 35.8177 8.57206 34.3638 12.792C33.8432 14.3031 33.7873 14.5424 33.375 15.8097C32.9628 17.077 32.202 19.367 31.3004 22.5004C30.3988 25.6338 29.3795 29.5411 28.6939 31.947C27.2389 37.0531 25.7419 39.0775 25.4853 39.3536C25.3583 39.4903 25.1736 39.5522 24.997 39.4525C23.6883 38.7138 23.9587 35.2234 24.1228 33.7887C24.2786 32.4272 25.1839 31.5033 27.3333 29.4495C28.38 28.4493 30.3255 27.2715 32.4943 25.9047C34.6631 24.5379 37.0965 23.1342 38.6603 22.1609C40.8975 20.7684 42.9092 18.7369 45.19 16.3822C46.3651 15.1691 47.086 13.6139 48.0382 11.5051C49.2996 8.7114 49.1305 5.33498 48.897 3.37455C48.8525 3.00122 48.3579 2.89548 47.9564 2.83413C47.4691 2.75968 47.0011 2.85971 46.629 2.97427C45.8895 3.20196 45.2832 4.43179 43.5328 9.61451C42.9969 11.2012 42.6434 12.0229 42.1067 13.1987C41.9492 13.5438 41.8389 13.9492 41.0287 17.1291C40.2186 20.309 38.7303 26.2589 37.9317 29.4105C37.088 32.7398 36.4189 34.44 35.4798 36.8912C35.0197 38.092 34.7031 38.8627 34.3042 39.6415C34.1444 39.9534 33.9295 40.0129 33.7555 40.0129C32.9893 40.0131 32.5727 38.901 32.2536 38.0527C31.9222 37.1716 32.0105 35.3461 32.2973 33.6549C32.4944 32.493 33.5472 31.433 34.2178 30.6786C34.9511 29.8537 35.8837 29.3394 36.9191 28.5875C37.9359 27.8492 38.7967 27.1876 40.4552 26.1943C41.3432 25.6625 42.2313 24.8133 43.1354 23.9316C44.457 22.6427 46.9671 20.9922 47.8417 20.3868C48.6436 19.8316 49.287 19.2806 49.8875 18.7277C50.6626 18.014 51.1758 16.9684 51.528 16.279C51.8824 15.5855 52.2911 14.1772 52.8035 13.2043C52.8993 13.0244 52.9796 12.819 53.0919 12.6438C53.2041 12.4686 53.3458 12.3297 53.4918 12.1866'

export const SCRIPT_VIEW_WIDTH = 55
export const SCRIPT_VIEW_HEIGHT = 42
export const SCRIPT_STROKE = 2.5

// Drawn size of the lettering, and the vinyl margin around it. The margin is
// what reads as the thick white sticker border.
export const SCRIPT_WIDTH = 112
export const SCRIPT_HEIGHT = (SCRIPT_WIDTH * SCRIPT_VIEW_HEIGHT) / SCRIPT_VIEW_WIDTH
export const PAD_X = 34
export const PAD_Y = 30

export const STICKER_WIDTH = Math.round(SCRIPT_WIDTH + PAD_X * 2)
export const STICKER_HEIGHT = Math.round(SCRIPT_HEIGHT + PAD_Y * 2)

/** Gap kept between the sticker and the edge of its stage. */
export const STAGE_MARGIN = 6

export type Point = { x: number; y: number }

// Superellipse exponent. Higher is boxier; 3 lands on a soft lozenge with
// convex edges that are pleasant to peel from.
const SQUARENESS = 3

// Deterministic low-frequency wobble so the cut looks hand-made rather than
// mathematically perfect. No randomness: the shape must be identical between
// the server-rendered fallback and the client canvas.
const WOBBLE_TERMS = [0.035, 0.022, 0.014]
/** Largest value `wobble` can return, used to keep the cut inside its box. */
const WOBBLE_MAX = 1 + WOBBLE_TERMS.reduce((sum, term) => sum + term, 0)
/** Breathing room for the antialiased edge of the die-cut. */
const EDGE_MARGIN = 1.5

const wobble = (t: number) =>
  1 +
  WOBBLE_TERMS[0] * Math.sin(3 * t + 0.9) +
  WOBBLE_TERMS[1] * Math.cos(5 * t - 0.4) +
  WOBBLE_TERMS[2] * Math.sin(2 * t + 2.2)

const superellipse = (t: number) => {
  const exponent = 2 / SQUARENESS
  const ct = Math.cos(t)
  const st = Math.sin(t)
  return {
    x: Math.sign(ct) * Math.pow(Math.abs(ct), exponent),
    y: Math.sign(st) * Math.pow(Math.abs(st), exponent),
  }
}

// Points on the blob outline, in sticker-local pixels with the origin at the
// top-left of the sticker box. Counter-clockwise in screen space.
export const blobPoints = (count: number, width = STICKER_WIDTH, height = STICKER_HEIGHT): Point[] => {
  const cx = width / 2
  const cy = height / 2
  // Divide out the wobble so its peaks land on the box edge rather than
  // outside it, where the texture would clip them into straight facets.
  const rx = (width / 2 - EDGE_MARGIN) / WOBBLE_MAX
  const ry = (height / 2 - EDGE_MARGIN) / WOBBLE_MAX
  const points: Point[] = []

  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2
    const unit = superellipse(t)
    const scale = wobble(t)
    points.push({ x: cx + unit.x * rx * scale, y: cy + unit.y * ry * scale })
  }

  return points
}

// Closed Catmull-Rom spline through the sampled outline, emitted as cubic
// beziers. Used for the SVG fallback and for the canvas fill.
export const blobPathString = (
  segments = 30,
  width = STICKER_WIDTH,
  height = STICKER_HEIGHT,
): string => {
  const points = blobPoints(segments, width, height)
  const at = (index: number) => points[(index + points.length) % points.length]
  let path = `M ${at(0).x.toFixed(2)} ${at(0).y.toFixed(2)}`

  for (let i = 0; i < points.length; i += 1) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(
      2,
    )} ${p2.y.toFixed(2)}`
  }

  return `${path} Z`
}

export const isInsideBlob = (points: Point[], x: number, y: number): boolean => {
  let inside = false

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]
    const b = points[j]
    const straddles = a.y > y !== b.y > y
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }

  return inside
}

export type EdgeHit = {
  /** Closest point on the outline, in sticker-local pixels. */
  point: Point
  /** Unit vector from that point toward the sticker's interior. */
  inward: Point
  /** Distance from the query point to the outline. */
  distance: number
  inside: boolean
}

// Nearest point on the outline plus the inward normal there. The peel rolls
// along the inward normal, so this is what turns "the cursor is near this bit
// of the edge" into a fold axis.
export const nearestEdge = (points: Point[], x: number, y: number): EdgeHit => {
  let best = { x: points[0].x, y: points[0].y }
  let bestDistanceSq = Infinity

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lengthSq = abx * abx + aby * aby
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lengthSq))
    const px = a.x + abx * t
    const py = a.y + aby * t
    const distanceSq = (x - px) * (x - px) + (y - py) * (y - py)

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      best = { x: px, y: py }
    }
  }

  // The blob is convex enough that pointing at the centroid is a stable,
  // artefact-free inward normal.
  let cx = 0
  let cy = 0
  for (const point of points) {
    cx += point.x
    cy += point.y
  }
  cx /= points.length
  cy /= points.length

  const dx = cx - best.x
  const dy = cy - best.y
  const length = Math.hypot(dx, dy) || 1

  return {
    point: best,
    inward: { x: dx / length, y: dy / length },
    distance: Math.sqrt(bestDistanceSq),
    inside: isInsideBlob(points, x, y),
  }
}

// How far the sticker extends from `origin` in direction `dir` — the travel the
// fold line has before the whole thing is off the page.
export const extentFrom = (points: Point[], origin: Point, dir: Point): number => {
  let max = 0

  for (const point of points) {
    const along = (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y
    if (along > max) max = along
  }

  return max
}
