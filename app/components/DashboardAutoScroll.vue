<script setup lang="ts">
const props = withDefaults(defineProps<{ label: string; suspended?: boolean; headingClass?: string }>(), { headingClass: 'dashboard-list-heading' })
const viewport = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const overflow = ref(false)
const desktop = ref(false)
const paused = ref(false)
const hovering = ref(false)
const focused = ref(false)
const hidden = ref(false)
const running = computed(() => desktop.value && overflow.value && !paused.value && !hovering.value && !focused.value && !hidden.value && !props.suspended)
let observer: ResizeObserver | undefined
let media: MediaQueryList | undefined
let frame = 0
let previous = 0
let holdUntil = 0
let position = 0
let atEnd = false

const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0 }
const tick = (time: number) => {
  const element = viewport.value
  if (!running.value || !element) { stop(); return }
  if (!previous) { position = element.scrollTop; holdUntil = time + 1500 }
  const elapsed = previous ? Math.min(64, time - previous) : 0
  previous = time
  if (time >= holdUntil) {
    if (atEnd) { position = 0; atEnd = false; holdUntil = time + 1500 }
    else position = Math.min(element.scrollHeight - element.clientHeight, position + elapsed * .022)
    element.scrollTop = position
    if (!atEnd && position >= element.scrollHeight - element.clientHeight - .5) { atEnd = true; holdUntil = time + 2000 }
  }
  frame = requestAnimationFrame(tick)
}
const measure = () => {
  if (!viewport.value) return
  overflow.value = viewport.value.scrollHeight > viewport.value.clientHeight + 1
  position = viewport.value.scrollTop
  atEnd = false
}
const visibility = () => { hidden.value = document.hidden }
const device = () => { desktop.value = Boolean(media?.matches) }
const manualScroll = () => { paused.value = true }
const focusOut = (event: FocusEvent) => { focused.value = Boolean(event.relatedTarget && viewport.value?.contains(event.relatedTarget as Node)) }
watch(running, value => { stop(); if (value) frame = requestAnimationFrame(tick) })
onMounted(() => {
  media = matchMedia('(min-width: 1000px)')
  paused.value = matchMedia('(prefers-reduced-motion: reduce)').matches
  device(); visibility()
  media.addEventListener('change', device)
  document.addEventListener('visibilitychange', visibility)
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
  if (content.value) observer.observe(content.value)
  measure()
})
onBeforeUnmount(() => { stop(); observer?.disconnect(); media?.removeEventListener('change', device); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <div class="dashboard-scroll-block" :data-scroll-label="label" :data-scrolling="running">
    <div :class="headingClass">
      <slot name="heading" />
      <button v-if="desktop" type="button" class="dashboard-scroll-toggle" :disabled="!overflow" :aria-label="`${paused ? '继续' : '暂停'}${label}滚动`" :aria-pressed="paused" @click="paused = !paused">{{ !overflow ? '无需滚动' : paused ? '继续滚动' : '暂停滚动' }}</button>
    </div>
    <slot name="description" />
    <div ref="viewport" class="dashboard-scroll-viewport" :tabindex="overflow ? 0 : undefined" :aria-label="`${label}列表`" @mouseenter="hovering = true" @mouseleave="hovering = false" @focusin="focused = true" @focusout="focusOut" @wheel.passive="manualScroll" @touchstart.passive="manualScroll" @keydown="['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes($event.key) && manualScroll()">
      <div ref="content"><slot /></div>
    </div>
  </div>
</template>
