// Paints the sticker artwork and its contact shadow into offscreen canvases,
// which the WebGL scene uses as textures.

import {
  PAD_X,
  PAD_Y,
  SCRIPT_PATH,
  SCRIPT_STROKE,
  SCRIPT_VIEW_WIDTH,
  SCRIPT_WIDTH,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  blobPoints,
} from './stickerShape'

// Texels per CSS pixel. The sticker is small and sits at the top of the page,
// so it is worth over-sampling to keep the die-cut edge and the hairline script
// crisp on retina displays.
const TEXEL_SCALE = 3
const OUTLINE_POINTS = 160

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

const traceBlob = (ctx: CanvasRenderingContext2D, inset: number) => {
  const scale = 1 - inset
  const cx = STICKER_WIDTH / 2
  const cy = STICKER_HEIGHT / 2
  const points = blobPoints(OUTLINE_POINTS)

  ctx.beginPath()
  points.forEach((point, index) => {
    const x = cx + (point.x - cx) * scale
    const y = cy + (point.y - cy) * scale
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
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
  traceBlob(ctx, 0)
  ctx.fillStyle = palette.vinyl
  ctx.fill()

  // A whisper of shading just inside the cut so the sticker reads as a
  // material with thickness rather than a flat white shape.
  ctx.save()
  ctx.clip()
  const shading = ctx.createLinearGradient(0, 0, STICKER_WIDTH * 0.35, STICKER_HEIGHT)
  shading.addColorStop(0, 'rgba(255, 255, 255, 0)')
  shading.addColorStop(1, 'rgba(28, 25, 23, 0.05)')
  ctx.fillStyle = shading
  ctx.fillRect(0, 0, STICKER_WIDTH, STICKER_HEIGHT)
  ctx.restore()

  traceBlob(ctx, 0.006)
  ctx.strokeStyle = 'rgba(28, 25, 23, 0.07)'
  ctx.lineWidth = 1
  ctx.stroke()

  // The lettering, drawn from the same path the written-name header used.
  const scale = SCRIPT_WIDTH / SCRIPT_VIEW_WIDTH
  ctx.save()
  ctx.translate(PAD_X, PAD_Y)
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
  traceBlob(ctx, 0.06)
  ctx.fillStyle = '#000000'
  ctx.fill()
  ctx.filter = 'none'

  return canvas
}
