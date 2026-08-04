// Geometry for the peelable name sticker: the cursive artwork, the die-cut
// contour around it, and the edge queries the peel interaction needs.

// The signature path, lifted verbatim from the original written-name header so
// the lettering keeps the exact same graphical style.
export const SCRIPT_PATH =
  'M11.6962 21.893C11.1323 21.8719 9.61909 21.7646 8.37298 21.4882C7.23484 21.2358 6.17512 20.4963 5.22454 19.9369C4.28248 19.3826 3.63886 17.7 3.22169 16.0583C2.3774 12.7356 3.98751 10.9324 5.74376 8.12728C6.54946 6.8404 8.82231 5.21175 11.5556 3.3173C12.9285 2.36575 13.833 2.13386 15.0661 1.84138C19.0383 0.899174 21.669 1.32167 22.0436 1.50045C22.7484 1.83685 23.0163 3.29264 23.2118 4.80383C23.2934 5.43432 23.2212 6.47118 22.8275 8.16016C22.4337 9.84913 21.6506 12.1641 20.5043 14.8396C19.358 17.5152 17.8722 20.4812 16.8901 22.5326C15.908 24.5839 15.4745 25.6307 14.8082 26.8929C13.3512 29.6531 11.9924 31.5681 11.0842 32.7642C8.85523 35.7 7.21088 36.8373 6.1195 37.625C4.97031 38.4543 3.52945 38.3889 2.51711 38.1882C1.70345 38.0268 1.494 36.8906 1.31484 35.5043C1.04034 33.3805 1.68839 32.2187 2.24653 31.2097C2.99498 29.8567 5.42845 28.2709 6.37405 27.4063C7.13759 26.7081 8.41246 25.6516 9.39815 24.8464C10.2021 24.1896 13.3271 22.35 15.2093 21.3146C15.8997 20.9348 17.9457 20.5018 19.5299 20.0734C20.4267 19.8308 21.4516 19.5109 23.818 18.4438C25.7325 17.5805 27.1988 16.3028 28.2516 15.1351C28.9807 14.3264 28.8063 13.5089 28.7154 13.0228C28.5626 12.2062 26.6333 12.4454 25.4987 12.6891C24.6976 12.8611 24.1478 14.533 23.7436 16.2842C22.9385 19.7711 23.7315 21.9472 24.0698 22.893C24.1994 23.2553 24.6002 23.439 25.0056 23.5903C26.677 24.2141 30.0588 23.5174 31.9047 22.9155C32.8119 22.6196 33.4585 22.0207 34.4512 21.0229C36.4967 18.9672 37.9817 16.7972 38.7017 15.4967C39.4216 14.1965 40.4245 10.9824 41.7036 7.06413C42.3039 5.22541 42.2746 4.40417 42.1981 3.73565C42.1387 3.21759 41.6266 2.98976 41.2397 2.83563C40.4185 2.50853 39.4721 2.84651 38.444 3.39688C37.9722 3.64949 37.7035 4.04933 37.4022 4.53779C36.9212 5.31787 35.8177 8.57206 34.3638 12.792C33.8432 14.3031 33.7873 14.5424 33.375 15.8097C32.9628 17.077 32.202 19.367 31.3004 22.5004C30.3988 25.6338 29.3795 29.5411 28.6939 31.947C27.2389 37.0531 25.7419 39.0775 25.4853 39.3536C25.3583 39.4903 25.1736 39.5522 24.997 39.4525C23.6883 38.7138 23.9587 35.2234 24.1228 33.7887C24.2786 32.4272 25.1839 31.5033 27.3333 29.4495C28.38 28.4493 30.3255 27.2715 32.4943 25.9047C34.6631 24.5379 37.0965 23.1342 38.6603 22.1609C40.8975 20.7684 42.9092 18.7369 45.19 16.3822C46.3651 15.1691 47.086 13.6139 48.0382 11.5051C49.2996 8.7114 49.1305 5.33498 48.897 3.37455C48.8525 3.00122 48.3579 2.89548 47.9564 2.83413C47.4691 2.75968 47.0011 2.85971 46.629 2.97427C45.8895 3.20196 45.2832 4.43179 43.5328 9.61451C42.9969 11.2012 42.6434 12.0229 42.1067 13.1987C41.9492 13.5438 41.8389 13.9492 41.0287 17.1291C40.2186 20.309 38.7303 26.2589 37.9317 29.4105C37.088 32.7398 36.4189 34.44 35.4798 36.8912C35.0197 38.092 34.7031 38.8627 34.3042 39.6415C34.1444 39.9534 33.9295 40.0129 33.7555 40.0129C32.9893 40.0131 32.5727 38.901 32.2536 38.0527C31.9222 37.1716 32.0105 35.3461 32.2973 33.6549C32.4944 32.493 33.5472 31.433 34.2178 30.6786C34.9511 29.8537 35.8837 29.3394 36.9191 28.5875C37.9359 27.8492 38.7967 27.1876 40.4552 26.1943C41.3432 25.6625 42.2313 24.8133 43.1354 23.9316C44.457 22.6427 46.9671 20.9922 47.8417 20.3868C48.6436 19.8316 49.287 19.2806 49.8875 18.7277C50.6626 18.014 51.1758 16.9684 51.528 16.279C51.8824 15.5855 52.2911 14.1772 52.8035 13.2043C52.8993 13.0244 52.9796 12.819 53.0919 12.6438C53.2041 12.4686 53.3458 12.3297 53.4918 12.1866'

export const SCRIPT_VIEW_WIDTH = 55
export const SCRIPT_VIEW_HEIGHT = 42
export const SCRIPT_STROKE = 2.5

// The die-cut, in the same coordinate space as the signature path.
//
// Generated offline rather than at runtime: the signature is rasterised, its
// ink dilated by a fixed bleed (a fat round pen stroke is a morphological
// dilation), interior loops filled, then the contour traced and smoothed. That
// yields an outline that follows the shape of the name instead of a generic
// blob, while staying chunky enough to read as vinyl. Baking the result keeps
// the server-rendered fallback and the client canvas in exact agreement, and
// costs nothing at runtime.
const DIE_CUT: number[] = [
  17.499, -5.287, 18.417, -5.308, 20.24, -5.206, 21.137, -5.081, 22.888, -4.691, 23.739, -4.435,
  24.572, -4.148, 26.19, -3.522, 26.977, -3.209, 27.754, -2.915, 29.29, -2.439, 30.055, -2.278,
  31.594, -2.143, 32.374, -2.17, 33.163, -2.254, 34.777, -2.558, 35.603, -2.753, 36.444, -2.962,
  38.167, -3.369, 39.048, -3.549, 40.847, -3.828, 41.76, -3.918, 42.679, -3.974, 44.522, -3.973,
  45.437, -3.913, 46.343, -3.812, 48.105, -3.472, 48.952, -3.227, 50.552, -2.573, 51.298, -2.162,
  52.004, -1.693, 53.297, -0.595, 53.885, 0.027, 54.437, 0.692, 55.448, 2.125, 55.915, 2.882,
  56.784, 4.448, 57.188, 5.251, 57.57, 6.063, 58.251, 7.708, 58.54, 8.54, 58.785, 9.377,
  59.122, 11.065, 59.204, 11.914, 59.179, 13.616, 59.072, 14.466, 58.904, 15.31, 58.397, 16.978,
  58.065, 17.797, 57.685, 18.603, 56.801, 20.171, 56.301, 20.93, 55.204, 22.396, 54.611, 23.103,
  53.993, 23.793, 52.696, 25.132, 52.024, 25.784, 51.343, 26.43, 49.976, 27.716, 49.3, 28.364,
  47.991, 29.687, 47.367, 30.368, 46.769, 31.066, 45.656, 32.515, 45.144, 33.266, 44.658, 34.034,
  43.758, 35.608, 43.332, 36.41, 42.501, 38.018, 42.082, 38.816, 41.65, 39.602, 40.722, 41.113,
  40.215, 41.824, 39.674, 42.498, 38.476, 43.706, 37.817, 44.229, 36.383, 45.096, 35.613, 45.437,
  34.81, 45.717, 33.124, 46.102, 32.25, 46.216, 31.36, 46.284, 29.552, 46.294, 28.642, 46.242,
  26.835, 46.028, 25.945, 45.865, 25.07, 45.663, 23.375, 45.139, 22.559, 44.821, 21.766, 44.47,
  20.241, 43.709, 19.505, 43.322, 18.069, 42.61, 17.361, 42.317, 16.654, 42.083, 15.228, 41.831,
  14.503, 41.823, 13.767, 41.89, 12.258, 42.225, 11.484, 42.469, 9.896, 43.033, 9.082, 43.323,
  8.256, 43.596, 6.576, 44.043, 5.726, 44.196, 4.873, 44.29, 3.179, 44.282, 2.347, 44.173,
  0.744, 43.737, -0.014, 43.411, -0.736, 43.014, -2.045, 42.021, -2.623, 41.432, -3.145, 40.788,
  -4.007, 39.355, -4.344, 38.579, -4.826, 36.938, -4.972, 36.085, -5.057, 35.218, -5.054, 33.461,
  -4.975, 32.579, -4.853, 31.698, -4.506, 29.948, -4.3, 29.08, -3.876, 27.357, -3.678, 26.498,
  -3.502, 25.641, -3.244, 23.923, -3.171, 23.059, -3.135, 22.191, -3.161, 20.438, -3.209, 19.554,
  -3.332, 17.773, -3.386, 16.877, -3.421, 15.979, -3.405, 14.186, -3.34, 13.294, -3.231, 12.408,
  -2.873, 10.661, -2.623, 9.803, -1.984, 8.129, -1.599, 7.314, -1.173, 6.517, -0.205, 4.975,
  0.332, 4.233, 0.902, 3.512, 2.129, 2.133, 2.782, 1.477, 4.158, 0.239, 4.877, -0.342,
  5.615, -0.897, 7.142, -1.922, 7.929, -2.391, 8.731, -2.83, 10.382, -3.611, 11.23, -3.952,
  12.967, -4.528, 13.856, -4.761, 14.756, -4.955, 16.58, -5.22,
]

// Bounds of the die-cut in signature units.
const CUT_MIN_X = -5.0828
const CUT_MIN_Y = -5.3083
const CUT_WIDTH = 64.3059
const CUT_HEIGHT = 51.6167

/** Drawn width of the lettering. The sticker is sized from this. */
export const SCRIPT_WIDTH = 154
export const SCRIPT_HEIGHT = (SCRIPT_WIDTH * SCRIPT_VIEW_HEIGHT) / SCRIPT_VIEW_WIDTH

const SCALE = SCRIPT_WIDTH / SCRIPT_VIEW_WIDTH
/** Breathing room so the antialiased cut is not clipped by the texture. */
const EDGE_MARGIN = 2

export const STICKER_WIDTH = Math.round(CUT_WIDTH * SCALE + EDGE_MARGIN * 2)
export const STICKER_HEIGHT = Math.round(CUT_HEIGHT * SCALE + EDGE_MARGIN * 2)

/** Where the signature's own origin sits inside the sticker box. */
export const SCRIPT_OFFSET_X = -CUT_MIN_X * SCALE + EDGE_MARGIN
export const SCRIPT_OFFSET_Y = -CUT_MIN_Y * SCALE + EDGE_MARGIN

/** Gap kept between the sticker and the edge of its stage. */
export const STAGE_MARGIN = 6

export type Point = { x: number; y: number }

/**
 * The die-cut outline in sticker-local pixels, origin at the top-left of the
 * sticker box. `count` resamples the baked contour; it never exceeds the baked
 * resolution.
 */
export const blobPoints = (count = DIE_CUT.length / 2): Point[] => {
  const total = DIE_CUT.length / 2
  const step = total / Math.min(count, total)
  const points: Point[] = []

  for (let i = 0; i < Math.min(count, total); i += 1) {
    const index = Math.round(i * step) % total
    points.push({
      x: (DIE_CUT[index * 2] - CUT_MIN_X) * SCALE + EDGE_MARGIN,
      y: (DIE_CUT[index * 2 + 1] - CUT_MIN_Y) * SCALE + EDGE_MARGIN,
    })
  }

  return points
}

/**
 * Closed Catmull-Rom spline through the outline, as cubic beziers. Shared by
 * the canvas fill and the SVG fallback so the two cannot drift apart.
 */
export const blobPathString = (segments = 64): string => {
  const points = blobPoints(segments)
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

/**
 * Nearest point on the outline plus the inward normal there. The peel rolls
 * along the inward normal, so this turns "the cursor is near this bit of the
 * edge" into a fold axis.
 */
export const nearestEdge = (points: Point[], x: number, y: number): EdgeHit => {
  let best = { x: points[0].x, y: points[0].y }
  let bestSegment = 0
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
      bestSegment = i
    }
  }

  // Take the normal from the local segment rather than from the centroid: the
  // cut follows the name, so it has concave stretches where those two disagree.
  const a = points[bestSegment]
  const b = points[(bestSegment + 1) % points.length]
  const tangentX = b.x - a.x
  const tangentY = b.y - a.y
  const tangentLength = Math.hypot(tangentX, tangentY) || 1
  let normalX = -tangentY / tangentLength
  let normalY = tangentX / tangentLength

  // Orient it inward by probing just off the edge.
  const probe = 1.5
  if (!isInsideBlob(points, best.x + normalX * probe, best.y + normalY * probe)) {
    normalX = -normalX
    normalY = -normalY
  }

  return {
    point: best,
    inward: { x: normalX, y: normalY },
    distance: Math.sqrt(bestDistanceSq),
    inside: isInsideBlob(points, x, y),
  }
}

/** How far the sticker extends from `origin` in direction `dir`. */
export const extentFrom = (points: Point[], origin: Point, dir: Point): number => {
  let max = 0

  for (const point of points) {
    const along = (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y
    if (along > max) max = along
  }

  return max
}
