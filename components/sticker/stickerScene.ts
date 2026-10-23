// WebGL2 scene for the peelable name sticker.
//
// The sticker is a subdivided quad textured with the die-cut artwork. Peeling
// wraps everything on the near side of a moving fold line around a cylinder,
// so the lifted material genuinely rolls and shows its backing, rather than
// creasing along a straight hinge. A second pass draws the same deformed
// geometry flattened onto the page as a contact shadow.
//
// Once it comes off the page it can be carried anywhere in the window, held by
// the point that was grabbed, and flies home when let go.

import { paintShadow, paintSticker, StickerPalette } from './stickerArt'
import {
  CANVAS_BLEED,
  GRAB_BAND,
  Point,
  STAGE_MARGIN,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  blobPoints,
  extentFrom,
  isInsideBlob,
  nearestEdge,
  supportPoint,
} from './stickerShape'

const COLS = 60
const ROWS = 48
const OUTLINE_POINTS = 120

/** How far the free edge lifts on hover alone. */
const HINT_FOLD = 20
const MAX_TILT = 0.17
const CAMERA_DISTANCE = 1100

// Coming off the page. Grabbed near an edge and pulled back across itself, the
// sticker folds over with the grabbed point riding under the pointer, and comes
// away once the flap covers DETACH_FLAP of it. Grabbed anywhere else, or pulled
// away from itself, it pops off after a few pixels: there is nothing to fold.
/** Grabbed within this share of its length from the trailing edge, a pull folds it back. */
const FOLD_BACK_ZONE = 0.3
const DETACH_FLAP = 0.34
/** Pointer travel before a sticker that can't fold back pops off; a finger gets a little more. */
const POP_DISTANCE = 9
const POP_DISTANCE_TOUCH = 14

// In the air: held up off the page, swinging a little round the point it is
// held by, the trailing edge curling in the wind of its own travel.
const AIRBORNE_LIFT = 72
const AIR_CURL = 7
const AIR_CURL_PER_SPEED = 0.012
const AIR_CURL_MAX = 24
/** The flick of the trailing edge as it comes unstuck. */
const POP_CURL = 34
const POP_TIME = 0.16
const MAX_SWING = 0.22
const SWING_PER_SPEED = 0.00022

// Radius of the roll per unit of fold. A fatter tube than a strict
// half-cylinder (which would be 1/PI): seen from a camera looking straight
// down at the page, a thin roll foreshortens into a flat crease, while this
// keeps enough of the curved surface facing the viewer to read as vinyl
// lifting off the paper. Capped, so a long fold-back stays a tight roll of
// vinyl instead of a tube.
const ROLL_RATIO = 0.42
const RADIUS_MAX = 9

const rollRadius = (fold: number) => Math.min(fold * ROLL_RATIO, RADIUS_MAX)

/** How far along the fold direction the material at the fold's origin ends up. */
const foldReach = (fold: number) => {
  const radius = rollRadius(fold)
  if (radius <= 0) return 0
  const theta = fold / radius
  return fold - radius * Math.sin(Math.min(theta, Math.PI)) + Math.max(fold - Math.PI * radius, 0)
}

/** The fold that carries its origin `reach` pixels along: foldReach inverted (it is monotonic). */
const foldFor = (reach: number) => {
  let lo = 0
  let hi = reach * 2 + Math.PI * RADIUS_MAX
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (foldReach(mid) < reach) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Physics runs on a fixed step, decoupled from the display's refresh rate, so
// the springs feel identical on 60Hz and 120Hz screens and stay stable through
// a dropped frame.
const STEP = 1 / 240
const MAX_FRAME = 0.05

// Spring tunings as [stiffness, damping]. The ones driven directly by the
// pointer sit at or just under critical damping, so the sticker keeps up with
// the cursor without wobbling.
const FOLD_DRAG: [number, number] = [1600, 76]
const FOLD_AIR: [number, number] = [700, 44]
const FOLD_REST: [number, number] = [320, 32]
// In the hand the sticker tracks the pointer almost 1:1, smoothed over TRACK
// seconds; just after it comes unstuck, or is caught in the air, it catches up
// over CATCH seconds instead, so it doesn't teleport to the pointer.
const TRACK = 0.014
const CATCH = 0.04
const CATCH_FADE = 0.07
/** Smoothing of the travel velocity that drives lean, curl and swing. */
const VELOCITY_SMOOTH = 0.05
const FOLLOW_RETURN: [number, number] = [900, 60]
const LIFT: [number, number] = [520, 44]
const SWING: [number, number] = [170, 15]
const SWING_HOME: [number, number] = [700, 53]
const TILT: [number, number] = [380, 35]
const GLOSS: [number, number] = [90, 16]

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** Leaves at once, settles softly: half ease-in-out, half ease-out. */
const easeHome = (t: number) => (easeInOutCubic(t) + 1 - (1 - t) ** 3) / 2

type Mode = 'idle' | 'peel' | 'airborne' | 'return'
/** Which curl is on the sticker: an edge folding over (hover, peel) or the trailing edge in flight. */
type CurlKind = 'edge' | 'trail'

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

/**
 * Tilt (rotateY * rotateX) about the sticker's centre, then a swing in the
 * page's plane about the point it is held by (px, py), then translation.
 */
const composeModel = (
  out: Mat4,
  tx: number,
  ty: number,
  tz: number,
  rotX: number,
  rotY: number,
  swing: number,
  px: number,
  py: number,
): Mat4 => {
  const cx = Math.cos(rotX)
  const sx = Math.sin(rotX)
  const cy = Math.cos(rotY)
  const sy = Math.sin(rotY)
  const cz = Math.cos(swing)
  const sz = Math.sin(swing)

  // Columns of rotateY * rotateX.
  const a0 = cy, a1 = 0, a2 = -sy
  const b0 = sy * sx, b1 = cx, b2 = cy * sx
  const c0 = sy * cx, c1 = -sx, c2 = cy * cx

  // Column-major rotateZ * (rotateY * rotateX).
  out[0] = cz * a0 - sz * a1
  out[1] = sz * a0 + cz * a1
  out[2] = a2
  out[3] = 0
  out[4] = cz * b0 - sz * b1
  out[5] = sz * b0 + cz * b1
  out[6] = b2
  out[7] = 0
  out[8] = cz * c0 - sz * c1
  out[9] = sz * c0 + cz * c1
  out[10] = c2
  out[11] = 0
  // Swinging about the pivot rather than the origin: t + p - Rz p.
  out[12] = tx + px - (cz * px - sz * py)
  out[13] = ty + py - (sz * px + cz * py)
  out[14] = tz
  out[15] = 1
  return out
}

// --- shaders --------------------------------------------------------------

// Shared by both passes: takes a grid vertex to its curled position, plus the
// surface normal there.
const DEFORM = `
const float PI = 3.14159265359;

void deform (vec2 uv, out vec3 position, out vec3 normal) {
  vec2 plane = vec2((uv.x - 0.5) * uSize.x, (0.5 - uv.y) * uSize.y);
  position = vec3(plane, 0.0);
  normal = vec3(0.0, 0.0, 1.0);

  if (uFold <= 0.25) return;

  float radius = max(uRadius, 0.5);
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
uniform float uRadius;
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
uniform float uRadius;
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
  // The stage is the layout box the sticker rests in. The canvas is not the
  // size of the stage: it is the sticker plus CANVAS_BLEED of headroom on every
  // side, and it travels with the sticker, anywhere in the window. Lift, tilt,
  // swing and curl therefore always have room to be drawn wherever the sticker
  // is, and the GPU only ever clears and composites a sticker-sized surface.
  let stageLeft = 0
  let stageTop = 0
  let stageRectStale = true
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
  const swing: Spring = { value: 0, velocity: 0 }
  const gloss: Spring = { value: 0.15, velocity: 0 }

  // Where each spring is heading. Worked out once per frame from the pointer,
  // then integrated over however many fixed steps the frame needs.
  let foldTarget = 0
  let targetX = 0
  let targetY = 0
  let targetZ = 0
  let tiltTargetX = 0
  let tiltTargetY = 0
  let swingTarget = 0
  let glossTarget = 0.15

  // Hover response, computed when the pointer moves rather than every frame.
  let hoverTiltX = 0
  let hoverTiltY = 0
  let hoverFold = 0
  let hoverGloss = 0.15
  let hoverGrab: Point = { x: 0, y: 0 }
  let hoverDir: Point = { x: 1, y: 0 }

  // The curl on the sticker, in sticker-local pixels (origin top-left, y down):
  // material on the near side of a line `fold` pixels from `grab` along
  // `direction` rolls over. Switching to a different kind of curl first rolls
  // the current one flat, so the sticker never jumps from one shape to another.
  let curlKind: CurlKind = 'edge'
  let grab: Point = { x: 0, y: 0 }
  let direction: Point = { x: 1, y: 0 }
  // Direction of travel in flight, eased so the trailing curl swings round smoothly.
  let trail: Point = { x: 1, y: 0 }

  let mode: Mode = 'idle'
  let pointerId: number | null = null
  let pointerTouch = false
  let pointerInside = false
  let pointer: Point = { x: 0, y: 0 }
  // Where the held point was when the drag began, so the sticker's offset is
  // simply how far the pointer has travelled since.
  let pressPoint: Point = { x: 0, y: 0 }
  // The held point, sticker-local: what the pointer is pulling, and what the
  // sticker swings around in the air.
  let held: Point = { x: STICKER_WIDTH / 2, y: STICKER_HEIGHT / 2 }
  let popTimer = 0
  let catchUp = 0
  // Travel velocity in stage pixels per second (y down), smoothed.
  let travelX = 0
  let travelY = 0
  /** The hover lift showing when the press began, held until the drag outgrows it. */
  let pressFold = 0
  const flight = { x: 0, y: 0, z: 0, swing: 0, t: 0, duration: 1, arc: 0 }
  let sweep = -1
  let sweepStrength = 0
  let sweepStart = 0.7
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

  /** The held point in shader space (origin at the sticker centre, y up): the swing's pivot. */
  const pivotX = () => held.x - STICKER_WIDTH / 2
  const pivotY = () => STICKER_HEIGHT / 2 - held.y

  /** Sticker-local coordinates (origin top-left, y down) for a stage point, undoing travel and swing. */
  const toLocal = (stageX: number, stageY: number): Point => {
    const wx = stageX - anchorX - STICKER_WIDTH / 2 - offsetX.value - pivotX()
    const wy = -(stageY - anchorY - STICKER_HEIGHT / 2) - offsetY.value - pivotY()
    const c = Math.cos(-swing.value)
    const s = Math.sin(-swing.value)
    const x = wx * c - wy * s + pivotX()
    const y = wx * s + wy * c + pivotY()
    return { x: x + STICKER_WIDTH / 2, y: STICKER_HEIGHT / 2 - y }
  }

  /** Hold the sticker by a new point without it moving: re-pivot, and absorb the difference in the offset. */
  const holdAt = (point: Point) => {
    const oldX = pivotX()
    const oldY = pivotY()
    held = point
    const dx = pivotX() - oldX
    const dy = pivotY() - oldY
    const c = Math.cos(swing.value)
    const s = Math.sin(swing.value)
    // (Rz - I)(p' - p)
    offsetX.value += c * dx - s * dy - dx
    offsetY.value += s * dx + c * dy - dy
  }

  const setLayout = () => {
    const rect = stage.getBoundingClientRect()
    stageLeft = rect.left
    stageTop = rect.top
    stageRectStale = false
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
    // bottom of the stage so, at rest, it never sits over the text below.
    const top = anchorY - GRAB_BAND
    const bottom = Math.min(stageHeight, anchorY + STICKER_HEIGHT + GRAB_BAND)
    hitArea.style.left = `${anchorX - GRAB_BAND}px`
    hitArea.style.top = `${top}px`
    hitArea.style.width = `${STICKER_WIDTH + GRAB_BAND * 2}px`
    hitArea.style.height = `${bottom - top}px`
    hitPivotX = NaN
  }

  // Past the edge of the window the sticker follows on a rubber band, so it
  // can be flung at the edge but never lost off it.
  const rubber = (excess: number) => 48 * (1 - Math.exp(-excess / 120))
  const band = (value: number, min: number, max: number) =>
    value < min ? min - rubber(min - value) : value > max ? max + rubber(value - max) : value

  /** Keep a travel target inside the window. Offsets are stage-relative; y is up. */
  const inWindow = (x: number, y: number): Point => {
    const width = document.documentElement.clientWidth
    const height = window.innerHeight
    const homeLeft = stageLeft + anchorX
    const homeTop = stageTop + anchorY
    return {
      x: band(x, STAGE_MARGIN - homeLeft, width - STAGE_MARGIN - STICKER_WIDTH - homeLeft),
      y: band(y, homeTop - (height - STAGE_MARGIN - STICKER_HEIGHT), homeTop - STAGE_MARGIN),
    }
  }

  /** Ask for a curl. A different kind of curl waits until the current one has rolled flat. */
  const curl = (kind: CurlKind, at: Point, toward: Point, amount: number) => {
    if (kind === curlKind || fold.value < 0.75) {
      curlKind = kind
      grab = at
      direction = toward
      foldTarget = amount
    } else {
      foldTarget = 0
    }
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
      hoverGrab = hit.point
      hoverDir = hit.inward
      hoverFold = HINT_FOLD * proximity * proximity
      hoverGloss = 0.24
    }
  }

  const detach = () => {
    mode = 'airborne'
    popTimer = POP_TIME
    catchUp = 1
  }

  /** Stuck to the page, being pulled: fold back over itself, or pop off. */
  const peel = (dt: number) => {
    const dx = pointer.x - pressPoint.x
    const dy = pointer.y - pressPoint.y
    const length = Math.hypot(dx, dy)
    glossTarget = 0.28

    if (length < 1.5) {
      curl('edge', grab, direction, pressFold)
      return
    }

    const pull = { x: dx / length, y: dy / length }
    const behind = extentFrom(outline, held, { x: -pull.x, y: -pull.y })
    const total = behind + extentFrom(outline, held, pull)

    if (behind <= total * FOLD_BACK_ZONE) {
      // The held point rides under the pointer and everything behind the fold
      // turns over with it, showing the backing. The fold turns from the
      // hover lift's direction to the pull's over a few frames rather than at
      // once, and never drops below the lift that was already showing.
      const k = 1 - Math.exp(-dt * 30)
      const fx = direction.x + (pull.x - direction.x) * k
      const fy = direction.y + (pull.y - direction.y) * k
      const turn = Math.hypot(fx, fy) || 1
      const amount = Math.max(foldFor(length), pressFold)
      curl('edge', held, { x: fx / turn, y: fy / turn }, amount)
      if ((behind + amount) / total > DETACH_FLAP) detach()
      return
    }

    // Held somewhere a fold can't start, or pulled away from itself: the
    // trailing edge starts to lift, and a few pixels on it comes away.
    trail = pull
    curl('trail', supportPoint(outline, centre, { x: -pull.x, y: -pull.y }), pull, length * 2.4)
    if (length > (pointerTouch ? POP_DISTANCE_TOUCH : POP_DISTANCE)) detach()
  }

  const centre: Point = { x: STICKER_WIDTH / 2, y: STICKER_HEIGHT / 2 }

  /** Curl, lean and swing from the way the sticker is travelling. */
  const inFlight = (dt: number, curlScale: number) => {
    const vx = travelX
    const vy = travelY
    const speed = Math.hypot(vx, vy)

    if (speed > 40) {
      // Ease the direction of travel round rather than snapping it, so the curl
      // migrates along the outline.
      const k = 1 - Math.exp(-dt * 14)
      const tx = trail.x + (vx / speed - trail.x) * k
      const ty = trail.y + (vy / speed - trail.y) * k
      const length = Math.hypot(tx, ty) || 1
      trail = { x: tx / length, y: ty / length }
    }

    popTimer = Math.max(0, popTimer - dt)
    catchUp *= Math.exp(-dt / CATCH_FADE)
    const flick = POP_CURL * (popTimer / POP_TIME) ** 2
    const amount = (AIR_CURL + Math.min(speed * AIR_CURL_PER_SPEED, AIR_CURL_MAX)) * curlScale + flick
    curl('trail', supportPoint(outline, centre, { x: -trail.x, y: -trail.y }), trail, amount)

    // Lean into the direction of travel.
    tiltTargetY = clamp(vx * 0.0004, -0.34, 0.34)
    tiltTargetX = clamp(vy * 0.0004, -0.34, 0.34)

    // Held by one point, the rest of the sticker trails behind it: the swing
    // turns the lever from the held point to the centre away from the motion.
    const leverX = centre.x - held.x
    const leverY = centre.y - held.y
    const lever = Math.hypot(leverX, leverY)
    if (lever > 4) {
      const torque = (leverX * vy - leverY * vx) / lever
      swingTarget = clamp(torque * SWING_PER_SPEED, -MAX_SWING, MAX_SWING)
    }
  }

  const startReturn = () => {
    mode = 'return'
    flight.x = offsetX.value
    flight.y = offsetY.value
    flight.z = offsetZ.value
    flight.swing = swing.value
    flight.t = 0
    const distance = Math.hypot(flight.x, flight.y)
    flight.duration = clamp(0.3 + distance * 0.00042, 0.32, 0.62)
    flight.arc = Math.min(28, distance * 0.06)
  }

  const updateTargets = (dt: number) => {
    foldTarget = 0
    targetX = 0
    targetY = 0
    targetZ = 0
    tiltTargetX = 0
    tiltTargetY = 0
    swingTarget = 0
    glossTarget = 0.15

    if (mode === 'peel') peel(dt)

    if (mode === 'airborne') {
      const to = inWindow(pointer.x - pressPoint.x, -(pointer.y - pressPoint.y))
      targetX = to.x
      targetY = to.y
      targetZ = AIRBORNE_LIFT
      glossTarget = 0.34
      inFlight(dt, 1)
    }

    if (mode === 'return') {
      // Home on an arc: away briskly, settling into place, and down onto the
      // page at the very end, so it lands rather than slides.
      flight.t += dt
      const t = Math.min(1, flight.t / flight.duration)
      const eased = easeHome(t)
      targetX = flight.x * (1 - eased)
      targetY = flight.y * (1 - eased)
      targetZ = Math.max(0, flight.z * (1 - t ** 3) + flight.arc * Math.sin(Math.PI * t) * (1 - t))
      glossTarget = 0.3
      inFlight(dt, 1 - t)
      // Square to the page well before it touches down.
      swingTarget = flight.swing * (1 - easeInOutCubic(Math.min(1, t / 0.7)))
      if (t >= 1) {
        mode = 'idle'
        // A glint across the vinyl as it sticks back down.
        sweepStart = elapsed + 0.04
        sweepDone = false
        updateHover()
      }
    }

    if (mode === 'idle') {
      curl('edge', hoverFold > 0 ? hoverGrab : grab, hoverFold > 0 ? hoverDir : direction, hoverFold)
      tiltTargetX = hoverTiltX
      tiltTargetY = hoverTiltY
      glossTarget = hoverGloss
    }
  }

  const integrate = (dt: number) => {
    spring(fold, foldTarget, mode === 'peel' ? FOLD_DRAG : mode === 'idle' ? FOLD_REST : FOLD_AIR, dt)
    fold.value = Math.max(0, fold.value)

    if (mode === 'airborne') {
      const k = 1 - Math.exp(-dt / (TRACK + (CATCH - TRACK) * catchUp))
      for (const [axis, target] of [[offsetX, targetX], [offsetY, targetY]] as const) {
        const before = axis.value
        axis.value += (target - axis.value) * k
        // Kept as a spring velocity too, so letting go hands over without a hitch.
        axis.velocity = (axis.value - before) / dt
      }
    } else {
      spring(offsetX, targetX, FOLLOW_RETURN, dt)
      spring(offsetY, targetY, FOLLOW_RETURN, dt)
    }
    const v = 1 - Math.exp(-dt / VELOCITY_SMOOTH)
    travelX += (offsetX.velocity - travelX) * v
    travelY += (-offsetY.velocity - travelY) * v
    spring(offsetZ, targetZ, LIFT, dt)
    offsetZ.value = Math.max(0, offsetZ.value)

    spring(tiltX, tiltTargetX, TILT, dt)
    spring(tiltY, tiltTargetY, TILT, dt)
    spring(swing, swingTarget, mode === 'airborne' ? SWING : SWING_HOME, dt)
    spring(gloss, glossTarget, GLOSS, dt)
  }

  const springs: [Spring, () => number, number][] = [
    [fold, () => foldTarget, 0.05],
    [offsetX, () => targetX, 0.05],
    [offsetY, () => targetY, 0.05],
    [offsetZ, () => targetZ, 0.05],
    [tiltX, () => tiltTargetX, 0.0005],
    [tiltY, () => tiltTargetY, 0.0005],
    [swing, () => swingTarget, 0.0005],
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
  let hitSwing = NaN
  let hitPivotX = NaN
  let hitPivotY = NaN
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
      swing.value,
      pivotX(),
      pivotY(),
    )

    // Curl origin and direction in shader space: origin at the sticker centre, y up.
    const grabX = grab.x - STICKER_WIDTH / 2
    const grabY = STICKER_HEIGHT / 2 - grab.y
    const radius = rollRadius(fold.value)

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
      gl.uniform1f(shadowUniforms.uRadius ?? null, radius)
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
      gl.uniform1f(stickerUniforms.uRadius ?? null, radius)
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

    // Keep the hit area over the sticker as it travels and swings, so a
    // sticker on its way home can be caught again where it is.
    const x = Math.round(offsetX.value)
    const y = Math.round(-offsetY.value)
    const turn = Math.round(swing.value * 500) / 500
    if (held.x + GRAB_BAND !== hitPivotX || held.y + GRAB_BAND !== hitPivotY) {
      hitPivotX = held.x + GRAB_BAND
      hitPivotY = held.y + GRAB_BAND
      hitArea.style.transformOrigin = `${hitPivotX}px ${hitPivotY}px`
    }
    if (x !== hitX || y !== hitY || turn !== hitSwing) {
      hitX = x
      hitY = y
      hitSwing = turn
      hitArea.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${-turn}rad)`
    }
  }

  const tick = (time: number) => {
    if (destroyed) return
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - lastTime) / 1000))
    lastTime = time
    elapsed += dt

    // A gloss sweep shortly after the page reveal settles, and again whenever
    // the sticker lands back home.
    if (!sweepDone) {
      const duration = 0.9
      if (elapsed >= sweepStart + duration) {
        sweepStrength = 0
        sweepDone = true
      } else if (elapsed >= sweepStart) {
        const progress = (elapsed - sweepStart) / duration
        sweep = -0.85 + progress * 1.7
        sweepStrength = Math.sin(Math.PI * progress) * 0.26
      }
    }

    updateTargets(dt)
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
    pointerInside = true
    pointerId = event.pointerId
    pointerTouch = event.pointerType !== 'mouse'
    hitArea.style.cursor = 'grabbing'

    const local = toLocal(point.x, point.y)
    const edge = nearestEdge(outline, local.x, local.y)
    const away =
      mode === 'airborne' ||
      mode === 'return' ||
      Math.hypot(offsetX.value, offsetY.value) > 2 ||
      offsetZ.value > 2

    if (away) {
      // Caught off the page: it stays in the air and comes with the pointer from
      // exactly where it is.
      holdAt(edge.inside ? local : edge.point)
      mode = 'airborne'
      popTimer = 0
      catchUp = 1
    } else {
      // On the page: hold the point under the pointer, or the edge itself when
      // the press lands on or just off it, which is where the hover lift already is.
      holdAt(edge.inside && edge.distance > 10 ? local : edge.point)
      pressFold = 0
      if (hoverFold > 0 && curlKind === 'edge') {
        grab = hoverGrab
        direction = hoverDir
        // Pressed, the edge comes up a touch more than the hover lift, to say it has hold.
        pressFold = hoverFold + 6
      }
      mode = 'peel'
    }
    // The held point starts under the pointer; from here the offset is the pointer's travel.
    pressPoint = { x: point.x - offsetX.value, y: point.y + offsetY.value }

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
    if (mode === 'airborne') startReturn()
    else mode = 'idle'
    pointerId = null
    // Touch pointers cease to exist on release; a mouse is still hovering.
    pointerInside = event.pointerType === 'mouse'
    pointer = stagePoint(event)
    hitArea.style.cursor = pointerInside && mode === 'idle' && canGrab(pointer) ? 'grab' : 'default'
    updateHover()
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
