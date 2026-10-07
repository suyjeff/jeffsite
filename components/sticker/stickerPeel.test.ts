import { describe, expect, it } from 'vitest'
import {
  DETACH_DISTANCE,
  PRESS_FOLD,
  ROLL_RATIO,
  aimPeel,
  solvePeel,
  supportShift,
} from './stickerPeel'
import { Point, blobPoints, nearestEdge } from './stickerShape'

const outline = blobPoints(120)

// Grab points spread all the way round the die-cut, each with the outline's
// own inward normal, exactly as a pointer-down on the sticker produces them.
const grabs = outline
  .filter((_, index) => index % 6 === 0)
  .map((point) => nearestEdge(outline, point.x, point.y))

const directions = Array.from({ length: 16 }, (_, index) => {
  const angle = (index / 16) * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
})

const drag = (dir: Point, length: number) => [dir.x * length, dir.y * length] as const

// CPU copy of the vertex shader's deform, in the plane: where a point of the
// sticker ends up once the fold has rolled it.
const landing = (point: Point, origin: Point, dir: Point, fold: number): Point => {
  const perp = { x: -dir.y, y: dir.x }
  const along = (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y
  const across = (point.x - origin.x) * perp.x + (point.y - origin.y) * perp.y
  if (fold <= 0.25 || along >= fold) return point
  const radius = fold * ROLL_RATIO
  const theta = (fold - along) / radius
  const wrapped = Math.min(theta, Math.PI)
  const overshoot = Math.max(theta - Math.PI, 0) * radius
  const rolled = fold - radius * Math.sin(wrapped) + overshoot
  return {
    x: origin.x + dir.x * rolled + perp.x * across,
    y: origin.y + dir.y * rolled + perp.y * across,
  }
}

describe('solvePeel', () => {
  it('catches the moment the sticker is pressed', () => {
    for (const grab of grabs) {
      expect(solvePeel(outline, grab.point, grab.inward, 0, 0).fold).toBeGreaterThanOrEqual(PRESS_FOLD)
    }
  })

  it('peels from every grab point, whichever way it is dragged', () => {
    for (const grab of grabs) {
      for (const dir of directions) {
        const peel = solvePeel(outline, grab.point, grab.inward, ...drag(dir, 40))
        expect(peel.fold).toBeGreaterThan(40)
      }
    }
  })

  it('never folds over material lying behind the fold line', () => {
    for (const grab of grabs) {
      for (const dir of directions) {
        for (const length of [5, 30, 70]) {
          const peel = solvePeel(outline, grab.point, grab.inward, ...drag(dir, length))
          expect(supportShift(outline, peel.origin, peel.direction)).toBeLessThan(0.5)
        }
      }
    }
  })

  it('comes off within a comfortable pull in every direction, but not on a nudge', () => {
    for (const grab of grabs) {
      for (const dir of directions) {
        let pull = 0
        while (!solvePeel(outline, grab.point, grab.inward, ...drag(dir, pull)).detached) pull += 1
        expect(pull).toBeLessThanOrEqual(DETACH_DISTANCE)
        // Enough travel that the peel is seen before it lets go.
        expect(pull).toBeGreaterThanOrEqual(40)
      }
    }
  })

  it('keeps the grabbed edge under the pointer when folding it back', () => {
    for (const grab of grabs) {
      // Only where the edge itself is the leading edge; in a dip, the bulges
      // either side lead the fold instead.
      if (aimPeel(outline, grab.point, grab.inward).shift > 0.5) continue
      for (const length of [30, 50]) {
        const [dx, dy] = drag(grab.inward, length)
        const peel = solvePeel(outline, grab.point, grab.inward, dx, dy)
        if (peel.detached) continue
        const landed = landing(grab.point, peel.origin, peel.direction, peel.fold)
        expect(Math.hypot(landed.x - (grab.point.x + dx), landed.y - (grab.point.y + dy))).toBeLessThan(2)
      }
    }
  })

  it('lets a corner fold follow a diagonal drag', () => {
    // The top-left of the die-cut is a rounded corner.
    const corner = nearestEdge(outline, 0, 0)
    const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    const across = { x: 1, y: 0 }
    const diagonal = solvePeel(outline, corner.point, corner.inward, ...drag(dir, 40))
    const sideways = solvePeel(outline, corner.point, corner.inward, ...drag(across, 40))
    const angle = (a: Point, b: Point) => Math.acos(Math.min(1, a.x * b.x + a.y * b.y))
    expect(angle(diagonal.direction, sideways.direction)).toBeGreaterThan(0.25)
  })
})
