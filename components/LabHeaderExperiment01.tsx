import React, { useEffect, useRef } from 'react'

type ShapeKind = 'triangle' | 'square' | 'slash'

type ShapePoint = {
  baseX: number
  baseY: number
  x: number
  y: number
  vx: number
  vy: number
  shape: ShapeKind
  size: number
  rotation: number
  isName: boolean
}

type BitParticle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  ttl: number
  char: '0' | '1'
  size: number
}

type PointerState = {
  x: number
  y: number
  active: boolean
}

const SHAPES: ShapeKind[] = ['triangle', 'square', 'slash']

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

const createSeededRandom = (seed: number) => {
  let t = seed
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const LabHeaderExperiment01 = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null)
  const binaryCanvasRef = useRef<HTMLCanvasElement>(null)
  const seaColorRef = useRef<HTMLSpanElement>(null)
  const nameColorRef = useRef<HTMLSpanElement>(null)

  const pointsRef = useRef<ShapePoint[]>([])
  const layoutRef = useRef({ width: 0, height: 0, spacing: 10, lineWidth: 1.1 })
  const colorRef = useRef({ sea: '#8f8f8f', name: '#0f0f0f', binary: '#8f8f8f' })
  const pointerRef = useRef<PointerState>({ x: 0, y: 0, active: false })
  const prefersReducedMotionRef = useRef(false)
  const particlesRef = useRef<BitParticle[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const container = containerRef.current
    const shapeCanvas = shapeCanvasRef.current
    const binaryCanvas = binaryCanvasRef.current
    const seaSwatch = seaColorRef.current
    const nameSwatch = nameColorRef.current

    if (!container || !shapeCanvas || !binaryCanvas || !seaSwatch || !nameSwatch) {
      return
    }

    const shapeCtx = shapeCanvas.getContext('2d')
    const binaryCtx = binaryCanvas.getContext('2d')

    if (!shapeCtx || !binaryCtx) {
      return
    }

    prefersReducedMotionRef.current =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      shapeCanvas.width = rect.width * dpr
      shapeCanvas.height = rect.height * dpr
      shapeCanvas.style.width = `${rect.width}px`
      shapeCanvas.style.height = `${rect.height}px`
      shapeCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

      binaryCanvas.width = rect.width * dpr
      binaryCanvas.height = rect.height * dpr
      binaryCanvas.style.width = `${rect.width}px`
      binaryCanvas.style.height = `${rect.height}px`
      binaryCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const spacing = Math.max(8, Math.min(12, Math.round(rect.width / 70)))
      layoutRef.current = {
        width: rect.width,
        height: rect.height,
        spacing,
        lineWidth: Math.max(0.75, spacing * 0.12),
      }

      colorRef.current = {
        sea: window.getComputedStyle(seaSwatch).color,
        name: window.getComputedStyle(nameSwatch).color,
        binary: window.getComputedStyle(seaSwatch).color,
      }

      generatePoints(rect.width, rect.height)
    }

    const resizeObserver = new ResizeObserver(updateCanvasSize)
    resizeObserver.observe(container)
    updateCanvasSize()

    let shapeFrameId = 0
    let lastShapeTime = performance.now()

    const animateShapes = (timestamp: number) => {
      const delta = Math.min(0.05, (timestamp - lastShapeTime) / 1000)
      lastShapeTime = timestamp

      drawShapes(shapeCtx, delta)
      shapeFrameId = window.requestAnimationFrame(animateShapes)
    }

    shapeFrameId = window.requestAnimationFrame(animateShapes)

    let binaryFrameId = 0
    let lastBinaryTime = performance.now()
    let lastSpawnTime = 0
    let isHovering = false
    let binaryActive = true

    const spawnBits = (x: number, y: number) => {
      const now = performance.now()
      if (now - lastSpawnTime < 90) {
        return
      }
      lastSpawnTime = now

      const maxRadius = Math.max(30, layoutRef.current.width * 0.16)
      const count = 4 + Math.floor(Math.random() * 5)

      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const radius = Math.pow(Math.random(), 0.6) * maxRadius
        const spread = Math.random() * 6
        const originX = x + Math.cos(angle) * radius + (Math.random() - 0.5) * spread
        const originY = y + Math.sin(angle) * radius + (Math.random() - 0.5) * spread
        const speed = prefersReducedMotionRef.current ? 0 : 12 + Math.random() * 14

        particlesRef.current.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          ttl: prefersReducedMotionRef.current ? 0.6 + Math.random() * 0.4 : 1.05 + Math.random() * 0.45,
          char: Math.random() > 0.5 ? '1' : '0',
          size: 8 + Math.random() * 4,
        })
      }

      if (particlesRef.current.length > 140) {
        particlesRef.current.splice(0, particlesRef.current.length - 140)
      }

      if (!binaryActive) {
        binaryActive = true
        binaryFrameId = window.requestAnimationFrame(animateBinary)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      }
      isHovering = true
      spawnBits(pointerRef.current.x, pointerRef.current.y)
    }

    const handlePointerLeave = () => {
      pointerRef.current.active = false
      isHovering = false
    }

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerenter', handlePointerMove)
    container.addEventListener('pointerleave', handlePointerLeave)

    const animateBinary = (timestamp: number) => {
      const delta = Math.min(0.05, (timestamp - lastBinaryTime) / 1000)
      lastBinaryTime = timestamp

      const { width, height } = layoutRef.current
      binaryCtx.clearRect(0, 0, width, height)

      if (particlesRef.current.length === 0) {
        if (isHovering) {
          binaryFrameId = window.requestAnimationFrame(animateBinary)
          return
        }
        binaryActive = false
        return
      }

      binaryCtx.textAlign = 'center'
      binaryCtx.textBaseline = 'middle'
      binaryCtx.fillStyle = colorRef.current.binary
      binaryCtx.font =
        '500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.age += delta
        if (particle.age >= particle.ttl) {
          return false
        }

        particle.x += particle.vx * delta
        particle.y += particle.vy * delta

        const life = particle.age / particle.ttl
        const eased = easeInOutSine(Math.min(1, Math.max(0, life)))
        const alpha = Math.sin(Math.PI * eased)

        binaryCtx.globalAlpha = Math.max(0, alpha)
        binaryCtx.font = `500 ${particle.size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
        binaryCtx.fillText(particle.char, particle.x, particle.y)

        return true
      })

      binaryCtx.globalAlpha = 1
      binaryFrameId = window.requestAnimationFrame(animateBinary)
    }

    binaryFrameId = window.requestAnimationFrame(animateBinary)

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerenter', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerLeave)
      window.cancelAnimationFrame(shapeFrameId)
      window.cancelAnimationFrame(binaryFrameId)
    }
  }, [])

  const generatePoints = (width: number, height: number) => {
    const spacing = layoutRef.current.spacing
    const jitter = spacing * 0.25
    const rng = createSeededRandom(11)
    const points: ShapePoint[] = []

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    const maskCtx = maskCanvas.getContext('2d')

    if (maskCtx) {
      maskCtx.clearRect(0, 0, width, height)
      const fontSize = Math.min(width, height) * 0.26
      maskCtx.fillStyle = '#ffffff'
      maskCtx.textAlign = 'center'
      maskCtx.textBaseline = 'middle'
      maskCtx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
      maskCtx.fillText('jeff', width / 2, height / 2)
    }

    const maskData = maskCtx?.getImageData(0, 0, width, height).data

    for (let y = spacing * 0.6; y <= height - spacing * 0.6; y += spacing) {
      for (let x = spacing * 0.6; x <= width - spacing * 0.6; x += spacing) {
        const px = x + (rng() - 0.5) * jitter
        const py = y + (rng() - 0.5) * jitter
        const shape = SHAPES[Math.floor(rng() * SHAPES.length)]
        const size = spacing * (0.16 + rng() * 0.14)
        const rotation = (rng() - 0.5) * 0.9
        const sampleX = Math.min(width - 1, Math.max(0, Math.round(px)))
        const sampleY = Math.min(height - 1, Math.max(0, Math.round(py)))
        const idx = maskData ? (sampleY * width + sampleX) * 4 + 3 : 0
        const isName = maskData ? maskData[idx] > 16 : false

        points.push({
          baseX: px,
          baseY: py,
          x: px,
          y: py,
          vx: 0,
          vy: 0,
          shape,
          size,
          rotation,
          isName,
        })
      }
    }

    pointsRef.current = points
  }

  const drawShape = (ctx: CanvasRenderingContext2D, shape: ShapeKind, size: number) => {
    if (shape === 'triangle') {
      ctx.beginPath()
      ctx.moveTo(0, -size)
      ctx.lineTo(size, size)
      ctx.lineTo(-size, size)
      ctx.closePath()
      ctx.stroke()
      return
    }

    if (shape === 'square') {
      ctx.strokeRect(-size, -size, size * 2, size * 2)
      return
    }

    ctx.beginPath()
    ctx.moveTo(-size, size)
    ctx.lineTo(size, -size)
    ctx.stroke()
  }

  const drawShapes = (ctx: CanvasRenderingContext2D, delta: number) => {
    const { width, height, spacing, lineWidth } = layoutRef.current
    ctx.clearRect(0, 0, width, height)

    ctx.lineWidth = lineWidth
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const pointer = pointerRef.current
    const influenceRadius = Math.max(120, width * 0.28)
    const maxOffset = Math.max(8, spacing * 1.3)
    const maxTotalOffset = Math.max(10, spacing * 1.5)
    const spring = 0.08
    const damping = 0.7

    const bitRadius = Math.max(60, width * 0.14)
    const bitStrength = Math.max(3.5, spacing * 0.85)

    for (const point of pointsRef.current) {
      let offsetX = 0
      let offsetY = 0

      if (pointer.active) {
        const dx = point.baseX - pointer.x
        const dy = point.baseY - pointer.y
        const dist = Math.hypot(dx, dy)

        if (dist < influenceRadius) {
          const power = 1 - dist / influenceRadius
          const force = power * power
          const norm = dist === 0 ? 0 : 1 / dist
          const push = force * maxOffset
          const swirl = force * maxOffset * 0.35

          offsetX += dx * norm * push + -dy * norm * swirl
          offsetY += dy * norm * push + dx * norm * swirl
        }
      }

      for (const bit of particlesRef.current) {
        const dx = point.baseX - bit.x
        const dy = point.baseY - bit.y
        const dist = Math.hypot(dx, dy)

        if (dist < bitRadius) {
          const life = 1 - bit.age / bit.ttl
          const power = (1 - dist / bitRadius) * life
          const norm = dist === 0 ? 0 : 1 / dist
          const push = power * bitStrength

          offsetX += dx * norm * push
          offsetY += dy * norm * push
        }
      }

      const total = Math.hypot(offsetX, offsetY)
      if (total > maxTotalOffset) {
        const scale = maxTotalOffset / total
        offsetX *= scale
        offsetY *= scale
      }

      const targetX = point.baseX + offsetX
      const targetY = point.baseY + offsetY

      point.vx += (targetX - point.x) * spring
      point.vy += (targetY - point.y) * spring
      point.vx *= damping
      point.vy *= damping

      const motionScale = prefersReducedMotionRef.current ? 0.6 : 1
      point.x += point.vx * motionScale
      point.y += point.vy * motionScale

      ctx.save()
      ctx.strokeStyle = point.isName ? colorRef.current.name : colorRef.current.sea
      ctx.translate(point.x, point.y)
      ctx.rotate(point.rotation + (point.vx + point.vy) * 0.02)
      drawShape(ctx, point.shape, point.size)
      ctx.restore()
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-56 sm:h-64 overflow-hidden rounded-md bg-stone-50/70 dark:bg-stone-900/40"
    >
      <span ref={seaColorRef} className="sr-only text-stone-400 dark:text-stone-600">
        sea
      </span>
      <span ref={nameColorRef} className="sr-only text-stone-900 dark:text-stone-100">
        name
      </span>

      <canvas
        ref={shapeCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
      <canvas
        ref={binaryCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
    </div>
  )
}

export default LabHeaderExperiment01
