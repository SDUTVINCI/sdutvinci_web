<script setup lang="ts">
import type { Mesh, Program, Renderer } from 'ogl'

const container = ref<HTMLDivElement | null>(null)
const webglFailed = ref(false)

let renderer: Renderer | null = null
let program: Program | null = null
let mesh: Mesh | null = null
let animationFrame: number | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let reduceMotionQuery: MediaQueryList | null = null
let systemThemeQuery: MediaQueryList | null = null
let coarsePointerQuery: MediaQueryList | null = null
let pageElement: HTMLElement | null = null
let disposed = false
let reducedMotion = false
let darkMode = true
let lastAnimationTick = 0
let frameAccumulator = 0
let smoothingElapsed = 0
let targetMouseX = 0.5
let targetMouseY = 0.5
let smoothMouseX = 0.5
let smoothMouseY = 0.5
let targetMouseActive = 0
let smoothMouseActive = 0

const DESKTOP_FRAME_INTERVAL = 1000 / 120
const COARSE_POINTER_FRAME_INTERVAL = 1000 / 60
const SMOOTHING_BASE_INTERVAL = 1000 / 30

const frameInterval = () => coarsePointerQuery?.matches
  ? COARSE_POINTER_FRAME_INTERVAL
  : DESKTOP_FRAME_INTERVAL

const dampingFactor = (baseFactor: number, deltaMs: number) => 1 - Math.pow(
  1 - baseFactor,
  Math.max(0, Math.min(deltaMs, 100)) / SMOOTHING_BASE_INTERVAL
)

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`

// Vue/WebGL port of the React Bits Galaxy fragment shader supplied for this page.
const fragmentShader = `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;
uniform bool uLightMode;
varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tri(float x) { return abs(fract(x) * 2.0 - 1.0); }
float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}
float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float Star(vec2 uv, float flare) {
  float d = max(length(uv), 0.001);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}
vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + offset;
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;
      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);
      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));
      vec2 pad = vec2(
        tris(seed * 34.0 + uTime * uSpeed / 10.0),
        tris(seed * 38.0 + uTime * uSpeed / 30.0)
      ) - 0.5;
      float star = Star(gv - offset - pad, flareSize);
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      star *= mix(1.0, twinkle, uTwinkleIntensity);
      col += star * size * base;
    }
  }
  return col;
}
void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;
  vec2 mouseNorm = uMouse - vec2(0.5);
  if (uAutoCenterRepulsion > 0.0) {
    float centerDist = length(uv);
    vec2 repulsion = normalize(uv) * (uAutoCenterRepulsion / (centerDist + 0.1));
    uv += repulsion * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  } else {
    uv += mouseNorm * 0.1 * uMouseActiveFactor;
  }
  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;
  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;
  vec3 col = vec3(0.0);
  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.32) * fade;
  }
  float alpha = min(smoothstep(0.0, 0.3, length(col)), 1.0);
  if (uLightMode) {
    float lightEnergy = clamp(length(col), 0.0, 1.0);
    float fineDust = smoothstep(0.004, 0.055, lightEnergy) * 0.075;
    float brightCore = smoothstep(0.018, 0.24, lightEnergy) * 0.225;
    col = mix(vec3(0.22, 0.32, 0.40), vec3(0.08, 0.40, 0.46), min(lightEnergy * 0.42, 0.34));
    alpha = min(fineDust + brightCore, 0.3);
  }
  gl_FragColor = uTransparent ? vec4(col, alpha) : vec4(col, 1.0);
}
`

const readTheme = () => {
  const explicitTheme = document.documentElement.dataset.theme
  darkMode = explicitTheme === 'dark' || (explicitTheme !== 'light' && Boolean(systemThemeQuery?.matches))
  if (program) {
    program.uniforms.uLightMode.value = !darkMode
    program.uniforms.uDensity.value = darkMode ? 1.42 : 1.68
    program.uniforms.uGlowIntensity.value = darkMode ? 0.48 : 0.14
    program.uniforms.uSaturation.value = darkMode ? 0.06 : 0
    program.uniforms.uTwinkleIntensity.value = darkMode ? 0.34 : 0.18
  }
}

const renderFrame = (timestamp: number, deltaMs = frameInterval()) => {
  if (!renderer || !program || !mesh) return
  if (!reducedMotion) {
    program.uniforms.uTime.value = timestamp * 0.001
    program.uniforms.uStarSpeed.value = timestamp * 0.001 * 0.5 / 10
  }
  const pointerFollow = dampingFactor(0.32, deltaMs)
  smoothMouseX += (targetMouseX - smoothMouseX) * pointerFollow
  smoothMouseY += (targetMouseY - smoothMouseY) * pointerFollow
  const activityFollow = dampingFactor(targetMouseActive > smoothMouseActive ? 0.24 : 0.12, deltaMs)
  smoothMouseActive += (targetMouseActive - smoothMouseActive) * activityFollow
  program.uniforms.uMouse.value[0] = smoothMouseX
  program.uniforms.uMouse.value[1] = smoothMouseY
  program.uniforms.uMouseActiveFactor.value = smoothMouseActive
  renderer.render({ scene: mesh })
}

const animate = (timestamp: number) => {
  if (lastAnimationTick === 0) lastAnimationTick = timestamp
  const elapsed = Math.min(timestamp - lastAnimationTick, 100)
  lastAnimationTick = timestamp
  frameAccumulator += elapsed
  smoothingElapsed += elapsed
  const targetInterval = frameInterval()
  if (frameAccumulator >= targetInterval - 0.5) {
    renderFrame(timestamp, smoothingElapsed)
    frameAccumulator %= targetInterval
    smoothingElapsed = 0
  }
  animationFrame = requestAnimationFrame(animate)
}

const startAnimation = () => {
  lastAnimationTick = 0
  frameAccumulator = 0
  smoothingElapsed = 0
  animationFrame = requestAnimationFrame(animate)
}

const resize = () => {
  if (!renderer || !program || !pageElement) return
  const width = Math.max(1, Math.round(pageElement.clientWidth))
  const height = Math.max(1, Math.round(pageElement.scrollHeight))
  const renderScale = Math.min(1, Math.sqrt(1_650_000 / (width * height)))
  renderer.setSize(Math.round(width * renderScale), Math.round(height * renderScale))
  const gl = renderer.gl
  gl.canvas.style.width = `${width}px`
  gl.canvas.style.height = `${height}px`
  program.uniforms.uResolution.value.set(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height)
  renderFrame(performance.now())
}

const handlePointerMove = (event: PointerEvent) => {
  if (!pageElement || reducedMotion) return
  const rect = pageElement.getBoundingClientRect()
  targetMouseX = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1)))
  targetMouseY = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(rect.height, 1)))
  targetMouseActive = 1
}
const handlePointerLeave = () => { targetMouseActive = 0 }

const handleMotionChange = () => {
  reducedMotion = Boolean(reduceMotionQuery?.matches)
  targetMouseActive = 0
  if (reducedMotion && animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
    smoothMouseActive = 0
    renderFrame(0)
  } else if (!reducedMotion && animationFrame === null) {
    startAnimation()
  }
}
const handleThemeChange = () => {
  readTheme()
  renderFrame(performance.now())
}
const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden' && animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  } else if (document.visibilityState !== 'hidden' && !reducedMotion && animationFrame === null) {
    startAnimation()
  } else if (document.visibilityState !== 'hidden') {
    renderFrame(performance.now())
  }
}

onMounted(async () => {
  pageElement = container.value?.parentElement || null
  if (!container.value || !pageElement) return
  reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  coarsePointerQuery = window.matchMedia('(pointer: coarse)')
  reducedMotion = reduceMotionQuery.matches
  readTheme()
  try {
    const { Renderer: OglRenderer, Program: OglProgram, Mesh: OglMesh, Color, Triangle } = await import('ogl')
    if (disposed || !container.value) return
    renderer = new OglRenderer({ alpha: true, premultipliedAlpha: false, dpr: 1 })
    const gl = renderer.gl
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    const geometry = new Triangle(gl)
    program = new OglProgram(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Color(1, 1, 1) },
        uFocal: { value: new Float32Array([0.5, 0.5]) },
        uRotation: { value: new Float32Array([1, 0]) },
        uStarSpeed: { value: 0.5 },
        uDensity: { value: darkMode ? 1.42 : 1.68 },
        uHueShift: { value: 210 },
        uSpeed: { value: 1 },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uGlowIntensity: { value: darkMode ? 0.48 : 0.14 },
        uSaturation: { value: darkMode ? 0.06 : 0 },
        uMouseRepulsion: { value: true },
        uTwinkleIntensity: { value: darkMode ? 0.34 : 0.18 },
        uRotationSpeed: { value: 0.035 },
        uRepulsionStrength: { value: 2 },
        uMouseActiveFactor: { value: 0 },
        uAutoCenterRepulsion: { value: 0 },
        uTransparent: { value: true },
        uLightMode: { value: !darkMode }
      }
    })
    mesh = new OglMesh(gl, { geometry, program })
    gl.canvas.setAttribute('aria-hidden', 'true')
    container.value.appendChild(gl.canvas)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(pageElement)
    themeObserver = new MutationObserver(handleThemeChange)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    reduceMotionQuery.addEventListener('change', handleMotionChange)
    systemThemeQuery.addEventListener('change', handleThemeChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    pageElement.addEventListener('pointermove', handlePointerMove, { passive: true })
    pageElement.addEventListener('pointerleave', handlePointerLeave, { passive: true })
    resize()
    if (!reducedMotion) startAnimation()
  } catch (error) {
    webglFailed.value = true
    console.warn('[organization-galaxy] WebGL background unavailable', error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  reduceMotionQuery?.removeEventListener('change', handleMotionChange)
  systemThemeQuery?.removeEventListener('change', handleThemeChange)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  pageElement?.removeEventListener('pointermove', handlePointerMove)
  pageElement?.removeEventListener('pointerleave', handlePointerLeave)
  const gl = renderer?.gl
  if (gl?.canvas.parentElement) gl.canvas.parentElement.removeChild(gl.canvas)
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  renderer = null
  program = null
  mesh = null
})
</script>

<template>
  <div ref="container" class="organization-galaxy-background" :class="{ 'is-fallback': webglFailed }" aria-hidden="true" />
</template>
