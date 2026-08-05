// Paints the sticker artwork and its contact shadow into offscreen canvases,
// which the WebGL scene uses as textures.

import {
  SCRIPT_OFFSET_X,
  SCRIPT_OFFSET_Y,
  SCRIPT_PATH,
  SCRIPT_STROKE,
  SCRIPT_VIEW_WIDTH,
  SCRIPT_WIDTH,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  blobPathString,
} from './stickerShape'

// Texels per CSS pixel. The sticker is small and sits at the top of the page,
// so it is worth over-sampling to keep the die-cut edge and the hairline script
// crisp on retina displays.
const TEXEL_SCALE = 3

/** The die-cut, shared by the fill, the edge and the shadow. */
const BLOB = blobPathString()

export type StickerPalette = {
  /** Face of the vinyl. */
  vinyl: string
  /** Reverse side, seen when the sticker curls over. */
  backing: string
  /** The lettering. */
  ink: string
  /** Contact shadow tint and strength. */
  shadow: string
  shadowAlpha: number
}

export const palettes: Record<'light' | 'dark', StickerPalette> = {
  light: {
    vinyl: '#ffffff',
    backing: '#efece6',
    ink: '#1c1917',
    shadow: '#1c1917',
    shadowAlpha: 0.3,
  },
  dark: {
    // A touch off-white so it does not glare against the near-black page.
    vinyl: '#f4f1eb',
    backing: '#d9d4ca',
    ink: '#1c1917',
    shadow: '#000000',
    shadowAlpha: 0.55,
  },
}

/** Runs `draw` with the die-cut as the current path, scaled about its centre. */
const withBlob = (
  ctx: CanvasRenderingContext2D,
  inset: number,
  draw: (path: Path2D) => void,
) => {
  const scale = 1 - inset
  const cx = STICKER_WIDTH / 2
  const cy = STICKER_HEIGHT / 2

  ctx.save()
  if (inset !== 0) {
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
  }
  draw(new Path2D(BLOB))
  ctx.restore()
}

const createSurface = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * TEXEL_SCALE)
  canvas.height = Math.round(height * TEXEL_SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(TEXEL_SCALE, 0, 0, TEXEL_SCALE, 0, 0)
  return { canvas, ctx }
}

export const paintSticker = (palette: StickerPalette): HTMLCanvasElement | null => {
  const surface = createSurface(STICKER_WIDTH, STICKER_HEIGHT)
  if (!surface) return null
  const { canvas, ctx } = surface

  // The die-cut vinyl.
  withBlob(ctx, 0, (path) => {
    ctx.fillStyle = palette.vinyl
    ctx.fill(path)

    // A whisper of shading just inside the cut so the sticker reads as a
    // material with thickness rather than a flat white shape.
    ctx.save()
    ctx.clip(path)
    const shading = ctx.createLinearGradient(0, 0, STICKER_WIDTH * 0.35, STICKER_HEIGHT)
    shading.addColorStop(0, 'rgba(255, 255, 255, 0)')
    shading.addColorStop(1, 'rgba(28, 25, 23, 0.04)')
    ctx.fillStyle = shading
    ctx.fillRect(0, 0, STICKER_WIDTH, STICKER_HEIGHT)
    ctx.restore()
  })

  withBlob(ctx, 0.006, (path) => {
    ctx.strokeStyle = 'rgba(28, 25, 23, 0.07)'
    ctx.lineWidth = 1
    ctx.stroke(path)
  })

  // The lettering, drawn from the same path the written-name header used.
  const scale = SCRIPT_WIDTH / SCRIPT_VIEW_WIDTH
  ctx.save()
  ctx.translate(SCRIPT_OFFSET_X, SCRIPT_OFFSET_Y)
  ctx.scale(scale, scale)
  ctx.strokeStyle = palette.ink
  ctx.lineWidth = SCRIPT_STROKE
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(SCRIPT_PATH))
  ctx.restore()

  return canvas
}

export const paintShadow = (): HTMLCanvasElement | null => {
  const surface = createSurface(STICKER_WIDTH, STICKER_HEIGHT)
  if (!surface) return null
  const { canvas, ctx } = surface

  // Inset so the blur has room inside the texture bounds, then pre-blurred.
  // The scene samples progressively coarser mips as the sticker lifts, which
  // is what softens the shadow on the way up.
  ctx.filter = 'blur(6px)'
  withBlob(ctx, 0.06, (path) => {
    ctx.fillStyle = '#000000'
    ctx.fill(path)
  })
  ctx.filter = 'none'

  return canvas
}
