import React, { useEffect, useRef, useState } from 'react'
import { palettes } from './sticker/stickerArt'
import { createStickerScene, StickerScene } from './sticker/stickerScene'
import {
  PAD_X,
  PAD_Y,
  SCRIPT_PATH,
  SCRIPT_STROKE,
  SCRIPT_VIEW_WIDTH,
  SCRIPT_WIDTH,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  blobPathString,
} from './sticker/stickerShape'

const BLOB_PATH = blobPathString()
const SCRIPT_SCALE = SCRIPT_WIDTH / SCRIPT_VIEW_WIDTH

// Rendered on the server, before hydration, when WebGL2 is unavailable, and
// whenever reduced motion is requested. Same artwork, no peeling.
const StaticSticker = () => (
  <div
    aria-hidden="true"
    className="absolute"
    style={{ left: 0, top: '50%', transform: 'translateY(-50%)' }}
  >
    <svg
      width={STICKER_WIDTH}
      height={STICKER_HEIGHT}
      viewBox={`0 0 ${STICKER_WIDTH} ${STICKER_HEIGHT}`}
      style={{ filter: 'drop-shadow(0 6px 12px rgba(28, 25, 23, 0.2))' }}
    >
      <path d={BLOB_PATH} fill="#ffffff" className="dark:fill-[#f4f1eb]" />
      <path
        d={BLOB_PATH}
        fill="none"
        stroke="rgba(28, 25, 23, 0.07)"
        strokeWidth={1}
      />
      <g transform={`translate(${PAD_X} ${PAD_Y}) scale(${SCRIPT_SCALE})`}>
        <path
          d={SCRIPT_PATH}
          fill="none"
          stroke="#1c1917"
          strokeWidth={SCRIPT_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  </div>
)

const StickerHeader = () => {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<StickerScene | null>(null)
  const [live, setLive] = useState(false)
  const [motionKey, setMotionKey] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = () => setMotionKey((key) => key + 1)
    motionQuery.addEventListener('change', onMotionChange)

    const canvas = canvasRef.current
    const stage = stageRef.current

    // Reduced motion keeps the sticker, drops the physics.
    if (motionQuery.matches || !canvas || !stage) {
      return () => motionQuery.removeEventListener('change', onMotionChange)
    }

    const schemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const paletteFor = () => (schemeQuery.matches ? palettes.dark : palettes.light)

    const scene = createStickerScene(canvas, { palette: paletteFor() })
    if (!scene) {
      return () => motionQuery.removeEventListener('change', onMotionChange)
    }

    sceneRef.current = scene
    setLive(true)

    const onSchemeChange = () => scene.setPalette(paletteFor())
    schemeQuery.addEventListener('change', onSchemeChange)

    const resizeObserver = new ResizeObserver(() => scene.resize())
    resizeObserver.observe(stage)

    return () => {
      resizeObserver.disconnect()
      schemeQuery.removeEventListener('change', onSchemeChange)
      motionQuery.removeEventListener('change', onMotionChange)
      scene.destroy()
      sceneRef.current = null
      setLive(false)
    }
  }, [motionKey])

  return (
    <div className="-mt-6 sm:-mt-8 opacity-0 animate-reveal">
      <h1 className="sr-only">Jeff Su</h1>
      <div ref={stageRef} className="relative w-full h-44 sm:h-52 select-none">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'pan-y', opacity: live ? 1 : 0 }}
        />
        {live ? null : <StaticSticker />}
      </div>
    </div>
  )
}

export default StickerHeader
