// How a drag turns into a peel: which way the sticker folds, where the fold
// starts, how far it has rolled, and when it comes off the page.
//
// Kept free of WebGL and DOM so it can be tested directly against the real
// die-cut outline.

import { Point, extentFrom } from './stickerShape'

/**
 * Radius of the roll per unit of fold. A fatter tube than a strict
 * half-cylinder (which would be 1/PI): seen from a camera looking straight
 * down at the page, a thin roll foreshortens into a flat crease, while this
 * keeps enough of the curved surface facing the viewer to read as vinyl
 * lifting off the paper.
 */
export const ROLL_RATIO = 0.42

/** Angle swept by the material between the fold line and the free edge. */
const ROLL_ANGLE = 1 / ROLL_RATIO

/**
 * How far across the page the grabbed edge travels per unit of fold. Dividing
 * the drag by this keeps the grabbed edge under the pointer.
 */
export const EDGE_TRAVEL = 1 - ROLL_RATIO * Math.sin(ROLL_ANGLE)

/** Lift the instant the sticker is pressed, so it visibly catches. */
export const PRESS_FOLD = 20

/** It comes off once the fold has crossed this much of the sticker… */
export const DETACH_AT = 0.6
/** …or the pointer has travelled this far, whichever happens first. */
export const DETACH_DISTANCE = 96

// How much further back the fold may start, beyond where pure inward peeling
// would put it, in exchange for following the drag direction.
const MAX_LEAN_SHIFT = 26
// Drag distance over which the fold eases from the inward normal to the drag
// direction, so the first pixels of a drag never snap it round.
const LEAN_RAMP = 16

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const rotate = (v: Point, angle: number): Point => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/**
 * How far the outline reaches behind `origin` along `dir`.
 *
 * A straight fold rolls everything on the near side of the fold line, so any
 * material behind the grab point would be flipped over wholesale. Starting the
 * fold this much further back puts it on the outline's support line instead,
 * which is what peeling with a straight fold physically does: grab inside a
 * dip and the bulges either side come up first.
 */
export const supportShift = (outline: Point[], origin: Point, dir: Point): number => {
  let min = 0
  for (const point of outline) {
    const along = (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y
    if (along < min) min = along
  }
  return -min
}

export type PeelAim = {
  /** Where the fold line starts: on the outline's support line along `direction`. */
  origin: Point
  /** How far that origin sits behind the grabbed point. */
  shift: number
  /** Length of sticker ahead of the origin along `direction`. */
  extent: number
}

export const aimPeel = (outline: Point[], handle: Point, direction: Point): PeelAim => {
  const shift = supportShift(outline, handle, direction)
  const origin = { x: handle.x - direction.x * shift, y: handle.y - direction.y * shift }
  return { origin, shift, extent: Math.max(24, extentFrom(outline, origin, direction)) }
}

/**
 * The direction the peel travels for a drag of (dx, dy) from `handle`.
 *
 * Any drag counts. Pulling into the sticker folds the edge back over itself
 * along the drag; pulling away from it is mirrored back inward, which reads as
 * the edge lifting toward the pointer. Corners can follow the drag freely;
 * along a straight edge the fold leans only as far as it can without dragging
 * a large part of the sticker over with it.
 */
export const peelDirection = (
  outline: Point[],
  handle: Point,
  inward: Point,
  dx: number,
  dy: number,
): Point => {
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return inward

  let tx = dx / length
  let ty = dy / length
  const inwardness = tx * inward.x + ty * inward.y
  if (inwardness < 0) {
    // Reflect across the edge tangent.
    tx -= 2 * inwardness * inward.x
    ty -= 2 * inwardness * inward.y
  }

  const lean =
    Math.atan2(inward.x * ty - inward.y * tx, inward.x * tx + inward.y * ty) *
    smoothstep(0, LEAN_RAMP, length)
  const limit = supportShift(outline, handle, inward) + MAX_LEAN_SHIFT
  const at = (t: number) => rotate(inward, lean * t)

  if (supportShift(outline, handle, at(1)) <= limit) return at(1)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 8; i += 1) {
    const mid = (lo + hi) / 2
    if (supportShift(outline, handle, at(mid)) <= limit) lo = mid
    else hi = mid
  }
  return at(lo)
}

export type Peel = PeelAim & {
  direction: Point
  /** Fold distance, measured from `origin` along `direction`. */
  fold: number
  detached: boolean
}

/**
 * Resolve a drag of (dx, dy), in sticker-local pixels, from a sticker grabbed
 * at `handle` on its outline, where `inward` is the outline's inward normal.
 */
export const solvePeel = (
  outline: Point[],
  handle: Point,
  inward: Point,
  dx: number,
  dy: number,
): Peel => {
  const direction = peelDirection(outline, handle, inward, dx, dy)
  const aim = aimPeel(outline, handle, direction)
  const length = Math.hypot(dx, dy)
  // The fold has to reach the grabbed point before that point moves; ease the
  // support shift in over the first few pixels so it doesn't jump on press.
  const reach = aim.shift * smoothstep(0, LEAN_RAMP, length)
  const fold = Math.min(aim.extent * 1.04, Math.max(PRESS_FOLD, reach + length / EDGE_TRAVEL))
  // Progress is measured from the grabbed point, not the fold origin, so a
  // grab inside a dip takes the same pull to come off as one on a bulge.
  const peeled = fold - aim.shift
  const detached = peeled >= (aim.extent - aim.shift) * DETACH_AT || length >= DETACH_DISTANCE
  return { ...aim, direction, fold, detached }
}
