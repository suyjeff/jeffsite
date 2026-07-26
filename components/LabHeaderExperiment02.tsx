import React, { useEffect, useRef } from 'react'

type Rgb = [number, number, number]

type Layout = {
  width: number
  height: number
  dpr: number
  fontSize: number
  glyphPx: number
}

type Vec2 = {
  x: number
  y: number
}

const NAME = 'Jeff Su'

const FONT_STACK = 'Lars, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

// Matches Tailwind's tracking-tight, applied to the offscreen text.
const TRACKING = -0.025

const MAX_GLYPHS = 16

// Packed 5x5 bitmaps, sparse -> dense. Bit (x, y) lives at (4 - x) + 5 * y.
const CHARSETS: Record<string, number[]> = {
  ascii: [0, 128, 131200, 14336, 459200, 469440, 4357252, 18157905, 11512810, 15724526],
  blocks: [0, 328000, 22041621, 22369621, 11512810, 33554431],
  binary: [0, 4591758, 15324974],
}

const PARAMS = {
  radius: 0.4,
  softness: 1,
  scale: 2,
  spacing: 1,
  backgroundOpacity: 0,
  contrast: 1,
  brightness: 0,
  invert: 0,
  strength: 1,
  baseStrength: 0,
  followSpeed: 3,
  charset: 'ascii',
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
// The packed glyphs need 25 bits, and int/uint default to mediump here.
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uContent;
uniform vec2 uResolution;
uniform float uGlyphPx;
uniform float uSpacing;
uniform uint uGlyphs[16];
uniform int uGlyphCount;
uniform float uRadius;
uniform float uSoftness;
uniform vec2 uPointer;
uniform float uActive;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uPaperOpacity;
uniform float uLod;
uniform float uContrast;
uniform float uBrightness;
uniform float uInvert;
uniform float uStrength;
uniform float uBase;

#define S(a, b, t) smoothstep(a, b, t)

float glyphBit (int index, ivec2 p) {
  if (p.x < 0 || p.x > 4 || p.y < 0 || p.y > 4) return 0.0;
  uint bits = uGlyphs[index];
  return float((bits >> uint((4 - p.x) + 5 * p.y)) & 1u);
}

float hash21 (vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main () {
  vec2 uv = vUv;

  float cellPx = (5.0 + 2.0 * uSpacing) * uGlyphPx;
  vec2 frag = uv * uResolution;
  vec2 cell = floor(frag / cellPx);
  vec2 cellUv = (cell + 0.5) * cellPx / uResolution;

  float aspect = uResolution.x / uResolution.y;
  float dist = length((cellUv - uPointer) * vec2(aspect, 1.0));
  float radius = max(uRadius * uActive, 1e-4);
  float inner = radius * (1.0 - clamp(uSoftness, 0.0, 1.0));
  float lens = (1.0 - S(inner, radius, dist)) * uActive;
  float mask = clamp(max(lens, clamp(uBase, 0.0, 1.0)), 0.0, 1.0)
    * clamp(uStrength, 0.0, 1.0);

  float apply = mask < 0.003 ? 0.0 : step(hash21(cell), mask);

  // Outside the lens the name is passed through at full resolution, so the
  // header stays legible and only the lens is redrawn as glyphs.
  if (apply < 0.5) {
    float coverage = textureLod(uContent, vec2(uv.x, 1.0 - uv.y), 0.0).a;
    outColor = vec4(uInk * coverage, coverage);
    return;
  }

  float density = textureLod(uContent, vec2(cellUv.x, 1.0 - cellUv.y), uLod).a;
  density = clamp((density - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0);
  density = mix(density, 1.0 - density, clamp(uInvert, 0.0, 1.0));

  int index = min(int(density * float(uGlyphCount)), uGlyphCount - 1);

  ivec2 local = ivec2(floor((frag - cell * cellPx) / uGlyphPx));
  int pad = int(uSpacing);
  float on = glyphBit(index, ivec2(local.x - pad, local.y - pad));

  vec3 glyphColor = mix(uPaper, uInk, clamp(0.45 + density, 0.0, 1.0));
  vec3 col = mix(uPaper, glyphColor, on);
  float alpha = mix(clamp(uPaperOpacity, 0.0, 1.0) * density, 1.0, on);
  outColor = vec4(col * alpha, alpha);
}
`

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const parseRgb = (value: string): Rgb => {
  const parts = value.match(/-?[\d.]+/g)
  if (!parts || parts.length < 3) {
    return [0, 0, 0]
  }
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255]
}

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('unable to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(log || 'unable to compile shader')
  }
  return shader
}

const createProgram = (gl: WebGL2RenderingContext) => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) {
    throw new Error('unable to create program')
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(log || 'unable to link program')
  }
  return program
}

const LabHeaderExperiment02 = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nameRef = useRef<HTMLHeadingElement>(null)
  const inkColorRef = useRef<HTMLSpanElement>(null)
  const paperColorRef = useRef<HTMLSpanElement>(null)

  const layoutRef = useRef<Layout>({ width: 0, height: 0, dpr: 1, fontSize: 64, glyphPx: 2 })
  const colorRef = useRef<{ ink: Rgb; paper: Rgb }>({ ink: [0, 0, 0], paper: [1, 1, 1] })
  const pointerRef = useRef<Vec2>({ x: 0.5, y: 0.5 })
  const pointerTargetRef = useRef<Vec2>({ x: 0.5, y: 0.5 })
  const activeRef = useRef({ value: 0, target: 0 })
  const prefersReducedMotionRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const container = containerRef.current
    const canvas = canvasRef.current
    const name = nameRef.current
    const inkSwatch = inkColorRef.current
    const paperSwatch = paperColorRef.current

    if (!container || !canvas || !name || !inkSwatch || !paperSwatch) {
      return
    }

    const source = document.createElement('canvas')
    const sourceCtx = source.getContext('2d')

    if (!sourceCtx) {
      return
    }

    const motionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    const themeQuery = window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null

    prefersReducedMotionRef.current = motionQuery ? motionQuery.matches : false

    let gl: WebGL2RenderingContext | null = null
    let program: WebGLProgram | null = null
    let vao: WebGLVertexArrayObject | null = null
    let buffer: WebGLBuffer | null = null
    let texture: WebGLTexture | null = null
    let uniforms: Record<string, WebGLUniformLocation | null> = {}
    let ready = false

    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: true,
      }) as WebGL2RenderingContext | null

      if (!gl) {
        throw new Error('webgl2 unavailable')
      }

      program = createProgram(gl)

      buffer = gl.createBuffer()
      vao = gl.createVertexArray()
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      )
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)

      texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const names = [
        'uContent',
        'uResolution',
        'uGlyphPx',
        'uSpacing',
        'uGlyphCount',
        'uRadius',
        'uSoftness',
        'uPointer',
        'uActive',
        'uInk',
        'uPaper',
        'uPaperOpacity',
        'uLod',
        'uContrast',
        'uBrightness',
        'uInvert',
        'uStrength',
        'uBase',
      ]

      uniforms = names.reduce<Record<string, WebGLUniformLocation | null>>((acc, key) => {
        acc[key] = gl ? gl.getUniformLocation(program as WebGLProgram, key) : null
        return acc
      }, {})

      uniforms.uGlyphs =
        gl.getUniformLocation(program, 'uGlyphs') ||
        gl.getUniformLocation(program, 'uGlyphs[0]')

      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.clearColor(0, 0, 0, 0)

      ready = true
    } catch (error) {
      ready = false
    }

    if (!ready || !gl || !program) {
      canvas.style.display = 'none'
      name.style.opacity = '1'
      return
    }

    const context = gl
    const shaderProgram = program

    canvas.style.display = ''

    const glyphs = new Uint32Array(MAX_GLYPHS)
    const charset = CHARSETS[PARAMS.charset] || CHARSETS.ascii
    const glyphCount = Math.min(charset.length, MAX_GLYPHS)
    for (let i = 0; i < glyphCount; i += 1) {
      glyphs[i] = charset[i] >>> 0
    }

    const readColors = () => {
      colorRef.current = {
        ink: parseRgb(window.getComputedStyle(inkSwatch).color),
        paper: parseRgb(window.getComputedStyle(paperSwatch).color),
      }
    }

    const tracked = sourceCtx as CanvasRenderingContext2D & { letterSpacing?: string }
    const supportsTracking = typeof tracked.letterSpacing === 'string'

    const setFont = (size: number) => {
      if (supportsTracking) {
        tracked.letterSpacing = `${(TRACKING * size).toFixed(2)}px`
      }
      sourceCtx.font = `700 ${size}px ${FONT_STACK}`
    }

    const measureFontSize = (width: number, height: number) => {
      const probe = 100
      setFont(probe)
      const ratio = sourceCtx.measureText(NAME).width / probe || 3.2
      const byWidth = (width * 0.88) / ratio
      const byHeight = height * 0.58
      return Math.max(24, Math.min(byWidth, byHeight))
    }

    const drawSource = () => {
      const { width, height, dpr, fontSize } = layoutRef.current

      source.width = Math.max(1, Math.round(width * dpr))
      source.height = Math.max(1, Math.round(height * dpr))
      sourceCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sourceCtx.clearRect(0, 0, width, height)

      // A white-on-transparent coverage map: only the alpha channel is read by
      // the shader, so mipmap averaging gives an exact per-cell density.
      sourceCtx.fillStyle = '#ffffff'
      sourceCtx.textAlign = 'center'
      sourceCtx.textBaseline = 'alphabetic'
      setFont(fontSize)

      const metrics = sourceCtx.measureText(NAME)
      const ascent = metrics.actualBoundingBoxAscent
      const descent = metrics.actualBoundingBoxDescent
      const baseline =
        typeof ascent === 'number' && typeof descent === 'number'
          ? height / 2 + (ascent - descent) / 2
          : height / 2 + fontSize * 0.35

      sourceCtx.fillText(NAME, width / 2, baseline)

      context.bindTexture(context.TEXTURE_2D, texture)
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false)
      context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        context.RGBA,
        context.UNSIGNED_BYTE,
        source
      )
      context.generateMipmap(context.TEXTURE_2D)
    }

    const render = () => {
      const { width, height, glyphPx } = layoutRef.current
      if (width < 1 || height < 1) {
        return
      }

      const cellPx = (5 + 2 * PARAMS.spacing) * glyphPx
      const lod = Math.max(0, Math.log2(cellPx) - 1)

      context.viewport(0, 0, canvas.width, canvas.height)
      context.clear(context.COLOR_BUFFER_BIT)
      context.useProgram(shaderProgram)
      context.bindVertexArray(vao)

      context.activeTexture(context.TEXTURE0)
      context.bindTexture(context.TEXTURE_2D, texture)
      context.uniform1i(uniforms.uContent, 0)

      context.uniform2f(uniforms.uResolution, canvas.width, canvas.height)
      context.uniform1f(uniforms.uGlyphPx, glyphPx)
      context.uniform1f(uniforms.uSpacing, PARAMS.spacing)
      context.uniform1uiv(uniforms.uGlyphs, glyphs)
      context.uniform1i(uniforms.uGlyphCount, glyphCount)
      context.uniform1f(uniforms.uRadius, PARAMS.radius)
      context.uniform1f(uniforms.uSoftness, PARAMS.softness)
      context.uniform2f(uniforms.uPointer, pointerRef.current.x, pointerRef.current.y)
      context.uniform1f(uniforms.uActive, activeRef.current.value)
      context.uniform3fv(uniforms.uInk, colorRef.current.ink)
      context.uniform3fv(uniforms.uPaper, colorRef.current.paper)
      context.uniform1f(uniforms.uPaperOpacity, PARAMS.backgroundOpacity)
      context.uniform1f(uniforms.uLod, lod)
      context.uniform1f(uniforms.uContrast, PARAMS.contrast)
      context.uniform1f(uniforms.uBrightness, PARAMS.brightness)
      context.uniform1f(uniforms.uInvert, PARAMS.invert)
      context.uniform1f(uniforms.uStrength, PARAMS.strength)
      context.uniform1f(uniforms.uBase, PARAMS.baseStrength)

      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
      context.bindVertexArray(null)
    }

    let frameId = 0
    let running = false
    let lastTime = 0

    const step = (timestamp: number) => {
      const delta = Math.min(1 / 30, Math.max(0, (timestamp - lastTime) / 1000))
      lastTime = timestamp

      const pointer = pointerRef.current
      const target = pointerTargetRef.current
      const active = activeRef.current

      const ease = prefersReducedMotionRef.current
        ? 1
        : 1 - Math.exp(-delta * PARAMS.followSpeed)
      const activeEase = prefersReducedMotionRef.current
        ? 1
        : 1 - Math.exp(-delta * PARAMS.followSpeed * 2)

      pointer.x += (target.x - pointer.x) * ease
      pointer.y += (target.y - pointer.y) * ease
      active.value += (active.target - active.value) * activeEase

      const settled =
        Math.abs(target.x - pointer.x) < 0.0005 &&
        Math.abs(target.y - pointer.y) < 0.0005 &&
        Math.abs(active.target - active.value) < 0.002

      if (settled) {
        pointer.x = target.x
        pointer.y = target.y
        active.value = active.target
      }

      render()

      if (settled) {
        running = false
        frameId = 0
        return
      }

      frameId = window.requestAnimationFrame(step)
    }

    const kick = () => {
      if (running) {
        return
      }
      running = true
      lastTime = performance.now()
      frameId = window.requestAnimationFrame(step)
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        return
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const fontSize = measureFontSize(rect.width, rect.height)

      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      // Glyph cells track the type size so the name stays readable as ascii at
      // any card width, capped at the reference default of 2 for very big type.
      const glyphScale = clamp(fontSize / 100, 1, PARAMS.scale)

      layoutRef.current = {
        width: rect.width,
        height: rect.height,
        dpr,
        fontSize,
        glyphPx: glyphScale * dpr,
      }

      readColors()
      drawSource()
      render()

      // The DOM heading is the fallback: it only steps aside once the canvas
      // has actually painted the name at a real size.
      name.style.opacity = '0'
    }

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(container)
    updateSize()

    const setTarget = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        return
      }
      pointerTargetRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
      }
    }

    const handlePointerEnter = (event: PointerEvent) => {
      setTarget(event)
      pointerRef.current = { ...pointerTargetRef.current }
      activeRef.current.target = 1
      kick()
    }

    const handlePointerMove = (event: PointerEvent) => {
      setTarget(event)
      activeRef.current.target = 1
      kick()
    }

    const handlePointerOut = () => {
      activeRef.current.target = 0
      kick()
    }

    container.addEventListener('pointerenter', handlePointerEnter)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerdown', handlePointerMove)
    container.addEventListener('pointerleave', handlePointerOut)
    container.addEventListener('pointercancel', handlePointerOut)

    const handleMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotionRef.current = event.matches
    }

    const handleThemeChange = () => {
      readColors()
      render()
    }

    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', handleMotionChange)
    }
    if (themeQuery && themeQuery.addEventListener) {
      themeQuery.addEventListener('change', handleThemeChange)
    }

    let disposed = false

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(() => {
          if (disposed) {
            return
          }
          updateSize()
        })
        .catch(() => undefined)
    }

    return () => {
      disposed = true
      resizeObserver.disconnect()
      container.removeEventListener('pointerenter', handlePointerEnter)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerdown', handlePointerMove)
      container.removeEventListener('pointerleave', handlePointerOut)
      container.removeEventListener('pointercancel', handlePointerOut)
      if (motionQuery && motionQuery.removeEventListener) {
        motionQuery.removeEventListener('change', handleMotionChange)
      }
      if (themeQuery && themeQuery.removeEventListener) {
        themeQuery.removeEventListener('change', handleThemeChange)
      }
      window.cancelAnimationFrame(frameId)
      running = false
      context.deleteTexture(texture)
      context.deleteBuffer(buffer)
      context.deleteVertexArray(vao)
      context.deleteProgram(shaderProgram)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-56 sm:h-64 overflow-hidden rounded-md bg-stone-50/70 dark:bg-stone-900/40"
    >
      <span ref={inkColorRef} className="sr-only text-stone-900 dark:text-stone-100">
        ink
      </span>
      <span ref={paperColorRef} className="sr-only text-stone-400 dark:text-stone-600">
        paper
      </span>

      <h2
        ref={nameRef}
        className="absolute inset-0 flex items-center justify-center px-4 text-center text-5xl sm:text-7xl font-bold tracking-tight leading-none text-stone-900 dark:text-stone-100 select-none pointer-events-none"
      >
        {NAME}
      </h2>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
    </div>
  )
}

export default LabHeaderExperiment02
