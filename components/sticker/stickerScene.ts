// WebGL2 scene for the peelable name sticker.
//
// The sticker is a subdivided quad textured with the die-cut artwork. Peeling
// wraps everything on the near side of a moving fold line around a cylinder,
// so the lifted material genuinely rolls and shows its backing, rather than
// creasing along a straight hinge. A second pass draws the same deformed
// geometry flattened onto the page as a contact shadow.

import { paintShadow, paintSticker, StickerPalette } from './stickerArt'
import {
  CANVAS_BLEED,
  EdgeHit,
  GRAB_BAND,
  Point,
  STAGE_MARGIN,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  blobPoints,
  extentFrom,
  isInsideBlob,
  nearestEdge,
} from './stickerShape'

const COLS = 60
const ROWS = 48
const OUTLINE_POINTS = 120

/** How far the free edge lifts on hover alone. */
const HINT_FOLD = 17
const MAX_TILT = 0.17
const CAMERA_DISTANCE = 1100
/** Fraction of the available travel after which the sticker comes off. */
const DETACH_AT = 0.82
/** Curl kept while the sticker is off the page, so it does not look rigid. */
const AIRBORNE_FOLD = 0.16
const AIRBORNE_LIFT = 96

// Radius of the roll per unit of fold. A fatter tube than a strict
// half-cylinder (which would be 1/PI): seen from a camera looking straight
// down at the page, a thin roll foreshortens into a flat crease, while this
// keeps enough of the curved surface facing the viewer to read as vinyl
// lifting off the paper.
const ROLL_RATIO = 0.42
/** Angle swept by the material between the fold line and the free edge. */
const ROLL_ANGLE = 1 / ROLL_RATIO
/** Distance the free edge travels per unit of fold. */
const PULL_RATIO = Math.hypot(
  1 - ROLL_RATIO * Math.sin(ROLL_ANGLE),
  ROLL_RATIO * (1 - Math.cos(ROLL_ANGLE)),
)

// Physics runs on a fixed step, decoupled from the display's refresh rate, so
// the springs feel identical on 60Hz and 120Hz screens and stay stable through
// a dropped frame.
const STEP = 1 / 240
const MAX_FRAME = 0.05

// Spring tunings as [stiffness, damping]. The ones driven directly by the
// pointer sit just under critical damping, so the sticker keeps up with the
// cursor without wobbling; the return home stays deliberately soft.
const FOLD_DRAG: [number, number] = [1400, 66]
const FOLD_REST: [number, number] = [260, 30]
const FOLLOW_DRAG: [number, number] = [1000, 56]
const LIFT_DRAG: [number, number] = [160, 24]
const FOLLOW_HOME: [number, number] = [88, 12.5]
const LIFT_HOME: [number, number] = [52, 11]
const TILT: [number, number] = [380, 35]
const GLOSS: [number, number] = [90, 16]

type Mode = 'idle' | 'peel' | 'airborne' | 'settle'

type Spring = { value: number; velocity: number }

const spring = (state: Spring, target: number, [stiffness, damping]: [number, number], dt: number) => {
  const acceleration = (target - state.value) * stiffness - state.velocity * damping
  state.velocity += acceleration * dt
  state.value += state.velocity * dt
}

const settledAt = (state: Spring, target: number, tolerance: number) =>
  Math.abs(state.value - target) < tolerance && Math.abs(state.velocity) < tolerance * 10

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// --- matrices -------------------------------------------------------------

type Mat4 = Float32Array

const identity = (): Mat4 =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

const multiply = (a: Mat4, b: Mat4, out: Mat4): Mat4 => {
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

const perspective = (fovY: number, aspect: number, near: number, far: number): Mat4 => {
  const f = 1 / Math.tan(fovY / 2)
  const range = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, 2 * near * far * range, 0,
  ])
}

const composeModel = (
  out: Mat4,
  tx: number,
  ty: number,
  tz: number,
  rotX: number,
  rotY: number,
): Mat4 => {
  const cx = Math.cos(rotX)
  const sx = Math.sin(rotX)
  const cy = Math.cos(rotY)
  const sy = Math.sin(rotY)

  // Column-major rotateY * rotateX, then translation.
  out[0] = cy
  out[1] = 0
  out[2] = -sy
  out[3] = 0
  out[4] = sy * sx
  out[5] = cx
  out[6] = cy * sx
  out[7] = 0
  out[8] = sy * cx
  out[9] = -sx
  out[10] = cy * cx
  out[11] = 0
  out[12] = tx
  out[13] = ty
  out[14] = tz
  out[15] = 1
  return out
}

// --- shaders --------------------------------------------------------------

// Shared by both passes: takes a grid vertex to its curled position, plus the
// surface normal there.
const DEFORM = `
const float PI = 3.14159265359;
const float ROLL_RATIO = ${ROLL_RATIO.toFixed(4)};

void deform (vec2 uv, out vec3 position, out vec3 normal) {
  vec2 plane = vec2((uv.x - 0.5) * uSize.x, (0.5 - uv.y) * uSize.y);
  position = vec3(plane, 0.0);
  normal = vec3(0.0, 0.0, 1.0);

  if (uFold <= 0.25) return;

  float radius = uFold * ROLL_RATIO;
  vec2 perp = vec2(-uDir.y, uDir.x);
  vec2 rel = plane - uGrab;
  float along = dot(rel, uDir);
  float across = dot(rel, perp);

  if (along >= uFold) return;

  float theta = (uFold - along) / radius;
  float wrapped = min(theta, PI);
  // Past a half turn the material has folded fully back on itself and simply
  // lies flat on top, so continue it in a straight flap instead of spiralling.
  float overshoot = max(theta - PI, 0.0) * radius;
  float rolled = uFold - radius * sin(wrapped) + overshoot;

  position = vec3(uGrab + uDir * rolled + perp * across, radius * (1.0 - cos(wrapped)));
  normal = vec3(uDir * sin(wrapped), cos(wrapped));
}
`

const STICKER_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform vec2 uSize;
uniform vec2 uGrab;
uniform vec2 uDir;
uniform float uFold;
uniform mat4 uModel;
uniform mat4 uViewProj;

out vec2 vUv;
out vec3 vNormal;
out vec3 vWorld;
${DEFORM}
void main () {
  vec3 position;
  vec3 normal;
  deform(aUv, position, normal);

  vec4 world = uModel * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * normal;
  vUv = aUv;
  gl_Position = uViewProj * world;
}`

const STICKER_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in vec3 vWorld;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec3 uBacking;
uniform vec3 uCamera;
uniform float uGloss;
uniform float uSweep;
uniform float uSweepStrength;

void main () {
  vec4 texel = texture(uTexture, vUv);
  if (texel.a < 0.02) discard;

  bool front = gl_FrontFacing;
  vec3 normal = normalize(vNormal) * (front ? 1.0 : -1.0);
  vec3 base = front ? texel.rgb : uBacking;

  vec3 lightDir = normalize(vec3(-0.32, 0.58, 0.75));
  vec3 viewDir = normalize(uCamera - vWorld);
  vec3 halfway = normalize(lightDir + viewDir);

  float diffuse = 0.88 + 0.12 * max(dot(normal, lightDir), 0.0);
  float specular = pow(max(dot(normal, halfway), 0.0), 64.0) * uGloss;

  vec3 color = base * diffuse + specular;

  // One-off gloss sweep on load.
  float band = 1.0 - smoothstep(0.0, 0.17, abs(dot(vUv - 0.5, normalize(vec2(0.86, -0.5))) - uSweep));
  color += band * uSweepStrength * (front ? 1.0 : 0.35);

  if (!front) color *= 0.92;

  outColor = vec4(clamp(color, 0.0, 1.0), texel.a);
}`

const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform vec2 uSize;
uniform vec2 uGrab;
uniform vec2 uDir;
uniform float uFold;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uSkew;
uniform vec2 uContactOffset;

out vec2 vUv;
out float vHeight;
${DEFORM}
void main () {
  vec3 position;
  vec3 normal;
  deform(aUv, position, normal);

  vec4 world = uModel * vec4(position, 1.0);
  vHeight = max(world.z, 0.0);
  vUv = aUv;
  // A small constant offset keeps a contact shadow visible even when the
  // sticker lies flat, where the height-driven skew contributes nothing.
  gl_Position = uViewProj * vec4(world.xy + uSkew * vHeight + uContactOffset, 0.0, 1.0);
}`

const SHADOW_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vHeight;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uOpacity;

void main () {
  // Coarser mips the higher the material sits: the shadow softens as it lifts.
  float lod = clamp(vHeight * 0.035, 0.0, 5.0);
  float alpha = textureLod(uTexture, vUv, lod).a;
  float falloff = 1.0 / (1.0 + vHeight * 0.013);
  float value = alpha * uOpacity * falloff;
  if (value < 0.004) discard;
  outColor = vec4(uColor, value);
}`

// --- scene ----------------------------------------------------------------

export type StickerScene = {
  setPalette: (palette: StickerPalette) => void
  resize: () => void
  destroy: () => void
}

type Options = {
  palette: StickerPalette
}

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown shader error'
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

const link = (gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Could not create program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'Unknown link error'
    gl.deleteProgram(program)
    throw new Error(log)
  }
  return program
}

const uniformsOf = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
  const locations: Record<string, WebGLUniformLocation | null> = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i)
    if (info) locations[info.name] = gl.getUniformLocation(program, info.name)
  }
  return locations
}

const uploadTexture = (gl: WebGL2RenderingContext, source: TexImageSource) => {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.generateMipmap(gl.TEXTURE_2D)
  return texture
}

const toRgb = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = parseInt(full, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

export const createStickerScene = (
  canvas: HTMLCanvasElement,
  hitArea: HTMLElement,
  options: Options,
): StickerScene | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: false,
    stencil: false,
  })
  if (!gl || gl.isContextLost()) return null

  let stickerProgram: WebGLProgram
  let shadowProgram: WebGLProgram
  try {
    stickerProgram = link(gl, STICKER_VERT, STICKER_FRAG)
    shadowProgram = link(gl, SHADOW_VERT, SHADOW_FRAG)
  } catch (error) {
    console.warn('Sticker header could not initialise WebGL:', error)
    return null
  }

  const stickerUniforms = uniformsOf(gl, stickerProgram)
  const shadowUniforms = uniformsOf(gl, shadowProgram)

  // Grid geometry. Only UVs are stored; positions are derived in the shader.
  const uvs = new Float32Array((COLS + 1) * (ROWS + 1) * 2)
  let cursor = 0
  for (let row = 0; row <= ROWS; row += 1) {
    for (let col = 0; col <= COLS; col += 1) {
      uvs[cursor] = col / COLS
      uvs[cursor + 1] = row / ROWS
      cursor += 2
    }
  }

  const indices = new Uint16Array(COLS * ROWS * 6)
  let index = 0
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const topLeft = row * (COLS + 1) + col
      const topRight = topLeft + 1
      const bottomLeft = topLeft + COLS + 1
      const bottomRight = bottomLeft + 1
      indices[index] = topLeft
      indices[index + 1] = bottomLeft
      indices[index + 2] = topRight
      indices[index + 3] = topRight
      indices[index + 4] = bottomLeft
      indices[index + 5] = bottomRight
      index += 6
    }
  }

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const vertexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  gl.bindVertexArray(null)

  let palette = options.palette
  let stickerTexture: WebGLTexture | null = null
  const shadowCanvas = paintShadow()
  const shadowTexture = shadowCanvas ? uploadTexture(gl, shadowCanvas) : null

  const buildStickerTexture = () => {
    const painted = paintSticker(palette)
    if (!painted) return
    if (stickerTexture) gl.deleteTexture(stickerTexture)
    stickerTexture = uploadTexture(gl, painted)
  }

  buildStickerTexture()

  // Outline, in sticker-local pixels with the origin at the top-left.
  const outline = blobPoints(OUTLINE_POINTS)

  const model = identity()
  const viewProj = identity()
  const size = new Float32Array([STICKER_WIDTH, STICKER_HEIGHT])
  const stage = canvas.parentElement ?? canvas

  // --- layout ---------------------------------------------------------------
  //
  // The stage is the layout box the sticker sits in and is clamped to. The
  // canvas is not the size of the stage: it is the sticker plus CANVAS_BLEED of
  // headroom on every side, and it travels with the sticker. Lift, tilt and
  // curl therefore always have room to be drawn wherever the sticker is, and
  // the GPU only ever clears and composites a sticker-sized surface.
  let stageLeft = 0
  let stageTop = 0
  let stageRectStale = true
  let stageWidth = 1
  let stageHeight = 1
  let anchorX = 0
  let anchorY = 0
  let dpr = 1

  const fold: Spring = { value: 0, velocity: 0 }
  const offsetX: Spring = { value: 0, velocity: 0 }
  const offsetY: Spring = { value: 0, velocity: 0 }
  const offsetZ: Spring = { value: 0, velocity: 0 }
  const tiltX: Spring = { value: 0, velocity: 0 }
  const tiltY: Spring = { value: 0, velocity: 0 }
  const gloss: Spring = { value: 0.15, velocity: 0 }

  // Where each spring is heading. Worked out once per frame from the pointer,
  // then integrated over however many fixed steps the frame needs.
  let foldTarget = 0
  let targetX = 0
  let targetY = 0
  let targetZ = 0
  let tiltTargetX = 0
  let tiltTargetY = 0
  let glossTarget = 0.15

  // Hover response, computed when the pointer moves rather than every frame.
  let hoverTiltX = 0
  let hoverTiltY = 0
  let hoverFold = 0
  let hoverGloss = 0.15

  let mode: Mode = 'idle'
  let grab: Point = { x: 0, y: 0 }
  let direction: Point = { x: 1, y: 0 }
  let inward: Point = { x: 1, y: 0 }
  let extent = STICKER_WIDTH
  let pointerId: number | null = null
  let pointerInside = false
  let pointer: Point = { x: 0, y: 0 }
  let dragStart: Point = { x: 0, y: 0 }
  let sweep = -1
  let sweepStrength = 0
  let sweepDone = false
  let elapsed = 0
  let accumulator = 0
  let frame = 0
  let running = false
  let destroyed = false
  let lastTime = 0

  const cameraPosition = new Float32Array([0, 0, CAMERA_DISTANCE])
  let backingRgb = toRgb(palette.backing)
  let shadowRgb = toRgb(palette.shadow)

  /** Sticker-local coordinates (origin top-left, y down) for a stage point. */
  const toLocal = (stageX: number, stageY: number): Point => ({
    x: stageX - (anchorX + offsetX.value),
    y: stageY - (anchorY - offsetY.value),
  })

  const setLayout = () => {
    const rect = stage.getBoundingClientRect()
    stageLeft = rect.left
    stageTop = rect.top
    stageRectStale = false
    stageWidth = Math.max(1, rect.width)
    stageHeight = Math.max(1, rect.height)
    // Flush with the text column; the die-cut's own inset supplies the optical
    // margin a round shape wants.
    anchorX = 0
    anchorY = Math.max(STAGE_MARGIN, (stageHeight - STICKER_HEIGHT) / 2)

    const canvasWidth = STICKER_WIDTH + CANVAS_BLEED * 2
    const canvasHeight = STICKER_HEIGHT + CANVAS_BLEED * 2
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(canvasWidth * dpr)
    const height = Math.round(canvasHeight * dpr)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    canvas.style.left = `${anchorX - CANVAS_BLEED}px`
    canvas.style.top = `${anchorY - CANVAS_BLEED}px`
    canvas.style.width = `${canvasWidth}px`
    canvas.style.height = `${canvasHeight}px`
    canvasX = NaN
    canvasY = NaN

    const fovY = 2 * Math.atan(canvasHeight / 2 / CAMERA_DISTANCE)
    const projection = perspective(fovY, canvasWidth / canvasHeight, 1, 4000)
    const view = identity()
    view[14] = -CAMERA_DISTANCE
    multiply(projection, view, viewProj)

    // The hit area covers the sticker plus its grab band, and stops at the
    // bottom of the stage so it never sits over the text below.
    const top = anchorY - GRAB_BAND
    const bottom = Math.min(stageHeight, anchorY + STICKER_HEIGHT + GRAB_BAND)
    hitArea.style.left = `${anchorX - GRAB_BAND}px`
    hitArea.style.top = `${top}px`
    hitArea.style.width = `${STICKER_WIDTH + GRAB_BAND * 2}px`
    hitArea.style.height = `${bottom - top}px`
  }

  const clampOffset = () => {
    const minX = -anchorX + STAGE_MARGIN
    const maxX = stageWidth - STICKER_WIDTH - anchorX - STAGE_MARGIN
    const minY = -(stageHeight - STICKER_HEIGHT - anchorY - STAGE_MARGIN)
    const maxY = anchorY - STAGE_MARGIN
    offsetX.value = clamp(offsetX.value, Math.min(minX, 0), Math.max(maxX, 0))
    offsetY.value = clamp(offsetY.value, Math.min(minY, 0), Math.max(maxY, 0))
  }

  const aimAt = (hit: EdgeHit) => {
    grab = hit.point
    inward = hit.inward
    direction = hit.inward
    extent = Math.max(24, extentFrom(outline, hit.point, hit.inward))
  }

  const updateHover = () => {
    hoverTiltX = 0
    hoverTiltY = 0
    hoverFold = 0
    hoverGloss = 0.15
    if (mode !== 'idle' || !pointerInside) return

    const centreX = anchorX + offsetX.value + STICKER_WIDTH / 2
    const centreY = anchorY - offsetY.value + STICKER_HEIGHT / 2
    hoverTiltY = -clamp((pointer.x - centreX) / (STICKER_WIDTH * 0.75), -1, 1) * MAX_TILT
    hoverTiltX = -clamp((pointer.y - centreY) / (STICKER_HEIGHT * 0.75), -1, 1) * MAX_TILT

    const local = toLocal(pointer.x, pointer.y)
    const hit = nearestEdge(outline, local.x, local.y)
    if (hit.distance < GRAB_BAND) {
      const proximity = 1 - hit.distance / GRAB_BAND
      aimAt(hit)
      hoverFold = HINT_FOLD * proximity * proximity
      hoverGloss = 0.24
    }
  }

  const peelTarget = () => {
    const dragX = pointer.x - dragStart.x
    const dragY = -(pointer.y - dragStart.y)
    // Outward normal in shader space (y up). `inward` is stored in local space
    // (y down), so negating it and flipping y leaves x negated and y as-is.
    const outX = -inward.x
    const outY = inward.y

    const along = dragX * outX + dragY * outY
    const perpX = dragX - outX * along
    const perpY = dragY - outY * along
    const pull = Math.max(0, along) + 0.35 * Math.hypot(perpX, perpY)

    const dragLength = Math.hypot(dragX, dragY)
    if (dragLength > 6) {
      // The fold axis leans into whichever way the pointer is pulling, so the
      // curl reads as a response to the gesture rather than a fixed animation.
      const pullX = -dragX / dragLength
      const pullY = -dragY / dragLength
      const inX = inward.x
      const inY = -inward.y
      const alignment = pullX * inX + pullY * inY
      if (alignment > 0.15) {
        const mixX = inX * 0.4 + pullX * 0.6
        const mixY = inY * 0.4 + pullY * 0.6
        const length = Math.hypot(mixX, mixY) || 1
        direction = { x: mixX / length, y: -mixY / length }
      } else {
        direction = inward
      }
    }

    const target = clamp(pull / PULL_RATIO, 0, extent * 1.04)
    if (target > extent * DETACH_AT) mode = 'airborne'
    return target
  }

  const updateTargets = () => {
    if (mode === 'settle') {
      const home =
        Math.abs(fold.value) < 0.35 &&
        Math.abs(offsetX.value) < 0.35 &&
        Math.abs(offsetY.value) < 0.35 &&
        Math.abs(offsetZ.value) < 0.35 &&
        Math.abs(fold.velocity) < 6 &&
        Math.abs(offsetX.velocity) < 6 &&
        Math.abs(offsetY.velocity) < 6
      if (home) {
        mode = 'idle'
        updateHover()
      }
    }

    foldTarget = 0
    targetX = 0
    targetY = 0
    targetZ = 0
    tiltTargetX = 0
    tiltTargetY = 0
    glossTarget = 0.15

    if (mode === 'peel') {
      foldTarget = peelTarget()
      glossTarget = 0.28
    }

    if (mode === 'airborne') {
      foldTarget = extent * AIRBORNE_FOLD
      targetX = pointer.x - dragStart.x
      targetY = -(pointer.y - dragStart.y)
      targetZ = AIRBORNE_LIFT
      // Flutter: lean into the direction of travel.
      tiltTargetY = clamp(offsetX.velocity * 0.0005, -0.4, 0.4)
      tiltTargetX = clamp(-offsetY.velocity * 0.0005, -0.4, 0.4)
      glossTarget = 0.36
    }

    if (mode === 'idle') {
      foldTarget = hoverFold
      tiltTargetX = hoverTiltX
      tiltTargetY = hoverTiltY
      glossTarget = hoverGloss
    }
  }

  const integrate = (dt: number) => {
    const dragging = mode === 'peel' || mode === 'airborne'
    spring(fold, foldTarget, dragging ? FOLD_DRAG : FOLD_REST, dt)
    fold.value = Math.max(0, fold.value)

    if (mode === 'airborne') {
      spring(offsetX, targetX, FOLLOW_DRAG, dt)
      spring(offsetY, targetY, FOLLOW_DRAG, dt)
      spring(offsetZ, targetZ, LIFT_DRAG, dt)
    } else {
      // Softer on the way home so it floats back down rather than snapping.
      spring(offsetX, targetX, FOLLOW_HOME, dt)
      spring(offsetY, targetY, FOLLOW_HOME, dt)
      spring(offsetZ, targetZ, LIFT_HOME, dt)
    }

    spring(tiltX, tiltTargetX, TILT, dt)
    spring(tiltY, tiltTargetY, TILT, dt)
    spring(gloss, glossTarget, GLOSS, dt)
    clampOffset()
  }

  const springs: [Spring, () => number, number][] = [
    [fold, () => foldTarget, 0.05],
    [offsetX, () => targetX, 0.05],
    [offsetY, () => targetY, 0.05],
    [offsetZ, () => targetZ, 0.05],
    [tiltX, () => tiltTargetX, 0.0005],
    [tiltY, () => tiltTargetY, 0.0005],
    [gloss, () => glossTarget, 0.002],
  ]

  // At rest means nothing would visibly change on the next frame. A pointer
  // resting on the sticker no longer keeps the loop alive; the next move
  // wakes it.
  const atRest = () =>
    mode === 'idle' &&
    pointerId === null &&
    sweepDone &&
    springs.every(([state, target, tolerance]) => settledAt(state, target(), tolerance))

  let hitX = NaN
  let hitY = NaN
  let canvasX = NaN
  let canvasY = NaN

  const draw = () => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.CULL_FACE)

    // The canvas follows the sticker in whole device pixels, so the browser
    // never resamples it; the sub-pixel remainder goes into the model matrix.
    const screenX = offsetX.value
    const screenY = -offsetY.value
    const snappedX = Math.round(screenX * dpr) / dpr
    const snappedY = Math.round(screenY * dpr) / dpr
    if (snappedX !== canvasX || snappedY !== canvasY) {
      canvasX = snappedX
      canvasY = snappedY
      canvas.style.transform = `translate3d(${snappedX}px, ${snappedY}px, 0)`
    }
    composeModel(
      model,
      screenX - snappedX,
      -(screenY - snappedY),
      offsetZ.value,
      tiltX.value,
      tiltY.value,
    )

    // Grab point in shader space: origin at the sticker centre, y up.
    const grabX = grab.x - STICKER_WIDTH / 2
    const grabY = STICKER_HEIGHT / 2 - grab.y

    gl.bindVertexArray(vao)

    if (shadowTexture) {
      gl.useProgram(shadowProgram)
      gl.disable(gl.DEPTH_TEST)
      gl.depthMask(false)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, shadowTexture)
      gl.uniform1i(shadowUniforms.uTexture ?? null, 0)
      gl.uniform2fv(shadowUniforms.uSize ?? null, size)
      gl.uniform2f(shadowUniforms.uGrab ?? null, grabX, grabY)
      gl.uniform2f(shadowUniforms.uDir ?? null, direction.x, -direction.y)
      gl.uniform1f(shadowUniforms.uFold ?? null, fold.value)
      gl.uniformMatrix4fv(shadowUniforms.uModel ?? null, false, model)
      gl.uniformMatrix4fv(shadowUniforms.uViewProj ?? null, false, viewProj)
      gl.uniform2f(shadowUniforms.uSkew ?? null, 0.18, -0.22)
      gl.uniform2f(shadowUniforms.uContactOffset ?? null, 1.5, -2.5)
      gl.uniform3f(shadowUniforms.uColor ?? null, shadowRgb[0], shadowRgb[1], shadowRgb[2])
      gl.uniform1f(shadowUniforms.uOpacity ?? null, palette.shadowAlpha)
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
    }

    if (stickerTexture) {
      gl.useProgram(stickerProgram)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, stickerTexture)
      gl.uniform1i(stickerUniforms.uTexture ?? null, 0)
      gl.uniform2fv(stickerUniforms.uSize ?? null, size)
      gl.uniform2f(stickerUniforms.uGrab ?? null, grabX, grabY)
      gl.uniform2f(stickerUniforms.uDir ?? null, direction.x, -direction.y)
      gl.uniform1f(stickerUniforms.uFold ?? null, fold.value)
      gl.uniformMatrix4fv(stickerUniforms.uModel ?? null, false, model)
      gl.uniformMatrix4fv(stickerUniforms.uViewProj ?? null, false, viewProj)
      gl.uniform3fv(stickerUniforms.uCamera ?? null, cameraPosition)
      gl.uniform3f(stickerUniforms.uBacking ?? null, backingRgb[0], backingRgb[1], backingRgb[2])
      gl.uniform1f(stickerUniforms.uGloss ?? null, gloss.value)
      gl.uniform1f(stickerUniforms.uSweep ?? null, sweep)
      gl.uniform1f(stickerUniforms.uSweepStrength ?? null, sweepStrength)
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
    }

    gl.bindVertexArray(null)

    // Keep the hit area over the sticker as it travels, so a sticker still
    // floating home can be caught again where it is.
    const x = Math.round(offsetX.value)
    const y = Math.round(-offsetY.value)
    if (x !== hitX || y !== hitY) {
      hitX = x
      hitY = y
      hitArea.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
  }

  const tick = (time: number) => {
    if (destroyed) return
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - lastTime) / 1000))
    lastTime = time
    elapsed += dt

    // A single gloss sweep shortly after the page reveal settles.
    if (!sweepDone) {
      const start = 0.7
      const duration = 0.9
      if (elapsed >= start + duration) {
        sweepStrength = 0
        sweepDone = true
      } else if (elapsed >= start) {
        const progress = (elapsed - start) / duration
        sweep = -0.85 + progress * 1.7
        sweepStrength = Math.sin(Math.PI * progress) * 0.26
      }
    }

    updateTargets()
    accumulator += dt
    while (accumulator >= STEP) {
      integrate(STEP)
      accumulator -= STEP
    }

    if (atRest()) {
      // Land exactly on target so the resting frame is pixel-stable.
      for (const [state, target] of springs) {
        state.value = target()
        state.velocity = 0
      }
      draw()
      running = false
      return
    }

    draw()
    frame = window.requestAnimationFrame(tick)
  }

  const wake = () => {
    if (destroyed || running) return
    running = true
    accumulator = 0
    lastTime = performance.now()
    frame = window.requestAnimationFrame(tick)
  }

  // --- pointer --------------------------------------------------------------

  const markStageRectStale = () => {
    stageRectStale = true
  }

  const stagePoint = (event: PointerEvent): Point => {
    // Reading layout on every pointer event forces style recalculation while
    // the page reveal is still animating; read it once and refresh only after
    // a scroll or resize.
    if (stageRectStale) {
      const rect = stage.getBoundingClientRect()
      stageLeft = rect.left
      stageTop = rect.top
      stageRectStale = false
    }
    return { x: event.clientX - stageLeft, y: event.clientY - stageTop }
  }

  const canGrab = (point: Point) => {
    const local = toLocal(point.x, point.y)
    if (isInsideBlob(outline, local.x, local.y)) return true
    return nearestEdge(outline, local.x, local.y).distance < GRAB_BAND
  }

  const onPointerMove = (event: PointerEvent) => {
    pointer = stagePoint(event)
    if (pointerId === null) {
      pointerInside = true
      hitArea.style.cursor = canGrab(pointer) ? 'grab' : 'default'
      updateHover()
    }
    wake()
  }

  const onPointerDown = (event: PointerEvent) => {
    const point = stagePoint(event)
    if (!canGrab(point)) return

    pointer = point
    dragStart = point
    pointerInside = true
    pointerId = event.pointerId
    hitArea.style.cursor = 'grabbing'

    const local = toLocal(point.x, point.y)
    aimAt(nearestEdge(outline, local.x, local.y))
    mode = 'peel'

    try {
      hitArea.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort.
    }
    event.preventDefault()
    wake()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return
    try {
      hitArea.releasePointerCapture(event.pointerId)
    } catch {
      // Already released.
    }
    mode = 'settle'
    pointerId = null
    // Touch pointers cease to exist on release; a mouse is still hovering.
    pointerInside = event.pointerType === 'mouse'
    hitArea.style.cursor = pointerInside && canGrab(stagePoint(event)) ? 'grab' : 'default'
    wake()
  }

  const onPointerLeave = () => {
    if (pointerId !== null) return
    pointerInside = false
    hitArea.style.cursor = 'default'
    updateHover()
    wake()
  }

  hitArea.style.pointerEvents = 'auto'
  // The sticker owns every gesture that starts on it, so a peel works in any
  // direction on touch screens; the rest of the header still scrolls the page.
  hitArea.style.touchAction = 'none'
  hitArea.addEventListener('pointermove', onPointerMove)
  hitArea.addEventListener('pointerenter', onPointerMove)
  hitArea.addEventListener('pointerdown', onPointerDown)
  hitArea.addEventListener('pointerup', onPointerUp)
  hitArea.addEventListener('pointercancel', onPointerUp)
  hitArea.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('scroll', markStageRectStale, { capture: true, passive: true })
  window.addEventListener('resize', markStageRectStale, { passive: true })

  const onContextLost = (event: Event) => {
    event.preventDefault()
    running = false
    window.cancelAnimationFrame(frame)
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  setLayout()
  // Paint once now, before the canvas is revealed, so the hand-off from the
  // static fallback never shows an empty frame.
  draw()
  wake()

  return {
    setPalette(next) {
      palette = next
      backingRgb = toRgb(next.backing)
      shadowRgb = toRgb(next.shadow)
      buildStickerTexture()
      draw()
      wake()
    },
    resize() {
      setLayout()
      clampOffset()
      draw()
      wake()
    },
    destroy() {
      destroyed = true
      running = false
      window.cancelAnimationFrame(frame)
      hitArea.removeEventListener('pointermove', onPointerMove)
      hitArea.removeEventListener('pointerenter', onPointerMove)
      hitArea.removeEventListener('pointerdown', onPointerDown)
      hitArea.removeEventListener('pointerup', onPointerUp)
      hitArea.removeEventListener('pointercancel', onPointerUp)
      hitArea.removeEventListener('pointerleave', onPointerLeave)
      hitArea.style.pointerEvents = 'none'
      hitArea.style.touchAction = ''
      hitArea.style.cursor = ''
      window.removeEventListener('scroll', markStageRectStale, true)
      window.removeEventListener('resize', markStageRectStale)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      if (stickerTexture) gl.deleteTexture(stickerTexture)
      if (shadowTexture) gl.deleteTexture(shadowTexture)
      gl.deleteBuffer(vertexBuffer)
      gl.deleteBuffer(indexBuffer)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(stickerProgram)
      gl.deleteProgram(shadowProgram)
    },
  }
}
