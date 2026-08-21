<script setup lang="ts">
type GalaxyParticle = {
  angle: number
  distance: number
  depth: number
  size: number
  alpha: number
  phase: number
  warmth: number
  armOffset: number
}

type FieldStar = {
  x: number
  y: number
  depth: number
  size: number
  alpha: number
  phase: number
  warmth: number
}

const canvas = ref<HTMLCanvasElement | null>(null)
const galaxyParticles: GalaxyParticle[] = []
const fieldStars: FieldStar[] = []

let animationFrame: number | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let reduceMotionQuery: MediaQueryList | null = null
let systemThemeQuery: MediaQueryList | null = null
let pageElement: HTMLElement | null = null
let width = 1
let height = 1
let deviceScale = 1
let lastFrame = 0
let reducedMotion = false
let darkMode = true
let pointerTargetX = 0
let pointerTargetY = 0
let pointerX = 0
let pointerY = 0
let pageVisible = true

const seededRandom = (() => {
  let seed = 0x19_09_20_13
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed / 4_294_967_296
  }
})()

for (let index = 0; index < 390; index += 1) {
  const arm = index % 3
  galaxyParticles.push({
    angle: seededRandom() * Math.PI * 2,
    distance: Math.pow(seededRandom(), 0.62),
    depth: 0.36 + seededRandom() * 0.64,
    size: 0.45 + seededRandom() * 1.85,
    alpha: 0.18 + seededRandom() * 0.62,
    phase: seededRandom() * Math.PI * 2,
    warmth: seededRandom(),
    armOffset: arm * Math.PI * 2 / 3 + (seededRandom() - 0.5) * 0.52
  })
}

for (let index = 0; index < 180; index += 1) {
  fieldStars.push({
    x: seededRandom(),
    y: seededRandom(),
    depth: 0.25 + seededRandom() * 0.75,
    size: 0.35 + seededRandom() * 1.55,
    alpha: 0.16 + seededRandom() * 0.56,
    phase: seededRandom() * Math.PI * 2,
    warmth: seededRandom()
  })
}

const readTheme = () => {
  const explicitTheme = document.documentElement.dataset.theme
  darkMode = explicitTheme === 'dark' || (explicitTheme !== 'light' && Boolean(systemThemeQuery?.matches))
}

const resize = () => {
  const target = canvas.value
  if (!target || !pageElement) return
  const rect = pageElement.getBoundingClientRect()
  width = Math.max(1, Math.round(rect.width))
  height = Math.max(1, Math.round(pageElement.scrollHeight))
  deviceScale = Math.min(window.devicePixelRatio || 1, 1.6)
  target.width = Math.round(width * deviceScale)
  target.height = Math.round(height * deviceScale)
  target.style.width = `${width}px`
  target.style.height = `${height}px`
  draw(performance.now())
}

const starColor = (warmth: number, alpha: number) => {
  if (darkMode) {
    if (warmth > 0.9) return `rgba(255, 236, 176, ${alpha})`
    if (warmth > 0.56) return `rgba(117, 226, 241, ${alpha})`
    return `rgba(151, 184, 255, ${alpha})`
  }
  if (warmth > 0.9) return `rgba(163, 119, 33, ${alpha})`
  if (warmth > 0.56) return `rgba(14, 130, 155, ${alpha})`
  return `rgba(54, 92, 151, ${alpha})`
}

const drawGlow = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
) => {
  const glow = context.createRadialGradient(x, y, 0, x, y, radius)
  glow.addColorStop(0, color)
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = glow
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

const draw = (timestamp: number) => {
  const target = canvas.value
  const context = target?.getContext('2d')
  if (!target || !context) return

  const elapsed = reducedMotion ? 0 : timestamp / 1000
  pointerX += (pointerTargetX - pointerX) * 0.035
  pointerY += (pointerTargetY - pointerY) * 0.035

  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
  context.clearRect(0, 0, width, height)

  const base = context.createLinearGradient(0, 0, width, height)
  if (darkMode) {
    base.addColorStop(0, '#07141f')
    base.addColorStop(0.48, '#081a2a')
    base.addColorStop(1, '#09171f')
  } else {
    base.addColorStop(0, '#f7fbfd')
    base.addColorStop(0.5, '#edf6fa')
    base.addColorStop(1, '#f8fbfc')
  }
  context.fillStyle = base
  context.fillRect(0, 0, width, height)

  const centerX = width * 0.52 + pointerX * 18
  const centerY = height * 0.57 + pointerY * 12
  const galaxyRadius = Math.min(width * 0.58, 690)

  drawGlow(
    context,
    centerX,
    centerY,
    galaxyRadius * 0.74,
    darkMode ? 'rgba(14, 117, 158, 0.12)' : 'rgba(33, 150, 179, 0.075)'
  )
  drawGlow(
    context,
    width * 0.14,
    height * 0.23,
    Math.min(width, height) * 0.28,
    darkMode ? 'rgba(38, 73, 150, 0.09)' : 'rgba(83, 125, 192, 0.06)'
  )
  drawGlow(
    context,
    width * 0.87,
    height * 0.72,
    Math.min(width, height) * 0.26,
    darkMode ? 'rgba(17, 128, 124, 0.07)' : 'rgba(54, 160, 148, 0.045)'
  )

  context.globalCompositeOperation = darkMode ? 'lighter' : 'source-over'

  for (const star of fieldStars) {
    const parallax = 4 + star.depth * 17
    const x = ((star.x * width + pointerX * parallax) % width + width) % width
    const y = ((star.y * height + pointerY * parallax * 0.64) % height + height) % height
    const twinkle = reducedMotion ? 0.82 : 0.66 + Math.sin(elapsed * (0.52 + star.depth) + star.phase) * 0.24
    const alpha = star.alpha * twinkle * (darkMode ? 0.82 : 0.54)
    const radius = star.size * (0.55 + star.depth * 0.66)
    context.fillStyle = starColor(star.warmth, alpha)
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
    if (star.size > 1.45 && darkMode) {
      drawGlow(context, x, y, radius * 6, starColor(star.warmth, alpha * 0.18))
    }
  }

  for (const particle of galaxyParticles) {
    const rotation = particle.angle + particle.armOffset + particle.distance * 5.7 + elapsed * 0.012 * particle.depth
    const radius = particle.distance * galaxyRadius
    const scatter = Math.sin(particle.phase * 3.1 + particle.distance * 9.2) * (18 + radius * 0.035)
    const x = centerX + Math.cos(rotation) * radius + Math.cos(rotation + Math.PI / 2) * scatter + pointerX * particle.depth * 7
    const y = centerY + Math.sin(rotation) * radius * 0.34 + Math.sin(rotation + Math.PI / 2) * scatter * 0.46 + pointerY * particle.depth * 5
    const fade = Math.pow(1 - particle.distance * 0.72, 1.3)
    const twinkle = reducedMotion ? 0.88 : 0.76 + Math.sin(elapsed * (0.7 + particle.depth) + particle.phase) * 0.2
    const alpha = particle.alpha * fade * twinkle * (darkMode ? 0.72 : 0.42)
    context.fillStyle = starColor(particle.warmth, alpha)
    context.beginPath()
    context.arc(x, y, particle.size * (0.48 + particle.depth * 0.58), 0, Math.PI * 2)
    context.fill()
  }

  context.globalCompositeOperation = 'source-over'
  const vignette = context.createRadialGradient(centerX, centerY, Math.min(width, height) * 0.12, centerX, centerY, Math.max(width, height) * 0.76)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, darkMode ? 'rgba(1, 8, 14, 0.34)' : 'rgba(236, 245, 248, 0.18)')
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)
}

const animate = (timestamp: number) => {
  if (timestamp - lastFrame >= 33) {
    draw(timestamp)
    lastFrame = timestamp
  }
  animationFrame = requestAnimationFrame(animate)
}

const handlePointerMove = (event: PointerEvent) => {
  if (!pageElement || reducedMotion) return
  const rect = pageElement.getBoundingClientRect()
  pointerTargetX = ((event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2
  pointerTargetY = ((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2
}

const handlePointerLeave = () => {
  pointerTargetX = 0
  pointerTargetY = 0
}

const handleMotionChange = () => {
  reducedMotion = Boolean(reduceMotionQuery?.matches)
  if (reducedMotion && animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
    pointerTargetX = 0
    pointerTargetY = 0
    pointerX = 0
    pointerY = 0
    draw(0)
  } else if (!animationFrame) {
    animationFrame = requestAnimationFrame(animate)
  }
}

const handleThemeChange = () => {
  readTheme()
  draw(performance.now())
}

const handleVisibilityChange = () => {
  pageVisible = document.visibilityState !== 'hidden'
  if (!pageVisible && animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  } else if (pageVisible && !reducedMotion && animationFrame === null) {
    animationFrame = requestAnimationFrame(animate)
  } else if (pageVisible) {
    draw(performance.now())
  }
}

onMounted(() => {
  pageElement = canvas.value?.parentElement || null
  if (!pageElement) return

  reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  reducedMotion = reduceMotionQuery.matches
  readTheme()

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
  if (!reducedMotion) animationFrame = requestAnimationFrame(animate)
})

onBeforeUnmount(() => {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  reduceMotionQuery?.removeEventListener('change', handleMotionChange)
  systemThemeQuery?.removeEventListener('change', handleThemeChange)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  pageElement?.removeEventListener('pointermove', handlePointerMove)
  pageElement?.removeEventListener('pointerleave', handlePointerLeave)
})
</script>

<template>
  <canvas ref="canvas" class="organization-galaxy-background" aria-hidden="true" />
</template>
