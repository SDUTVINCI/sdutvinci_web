<script setup lang="ts">
import type { HomePromoSlide } from '~/data/home-promos'

const props = withDefaults(defineProps<{
  slides: HomePromoSlide[]
  autoplayMs?: number
}>(), {
  autoplayMs: 6500
})

const activeIndex = ref(0)
const isPaused = ref(false)
let timer: number | null = null
let pointerStartX: number | null = null
let didSwipe = false

const stopAutoplay = () => {
  if (!timer) return

  window.clearInterval(timer)
  timer = null
}

const startAutoplay = () => {
  stopAutoplay()

  if (
    isPaused.value
    || props.slides.length < 2
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return

  timer = window.setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % props.slides.length
  }, props.autoplayMs)
}

const selectSlide = (index: number) => {
  activeIndex.value = (index + props.slides.length) % props.slides.length
  startAutoplay()
}

const moveSlide = (offset: number) => {
  selectSlide(activeIndex.value + offset)
}

const toggleAutoplay = () => {
  isPaused.value = !isPaused.value
  isPaused.value ? stopAutoplay() : startAutoplay()
}

const handleFocusOut = (event: FocusEvent) => {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && (event.currentTarget as HTMLElement).contains(nextTarget)) return

  startAutoplay()
}

const handlePointerDown = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return

  pointerStartX = event.clientX
}

const handlePointerUp = (event: PointerEvent) => {
  if (pointerStartX === null) return

  const distance = event.clientX - pointerStartX
  pointerStartX = null

  if (Math.abs(distance) < 48) return

  didSwipe = true
  moveSlide(distance > 0 ? -1 : 1)
  window.setTimeout(() => {
    didSwipe = false
  }, 0)
}

const handleLinkClick = (event: MouseEvent) => {
  if (didSwipe) event.preventDefault()
}

watch(() => props.slides.length, (length) => {
  if (!length) {
    activeIndex.value = 0
    stopAutoplay()
    return
  }

  if (activeIndex.value >= length) activeIndex.value = 0
  startAutoplay()
})

onMounted(startAutoplay)
onBeforeUnmount(stopAutoplay)
</script>

<template>
  <section
    v-if="slides.length"
    class="promo-carousel"
    aria-roledescription="carousel"
    aria-label="Vinci 精选内容"
    @mouseenter="stopAutoplay"
    @mouseleave="startAutoplay"
    @focusin="stopAutoplay"
    @focusout="handleFocusOut"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointercancel="pointerStartX = null"
  >
    <div class="promo-viewport">
      <NuxtLink
        v-for="(slide, index) in slides"
        :key="slide.href"
        class="promo-slide"
        :class="[`is-${slide.tone}`, { 'is-active': index === activeIndex }]"
        :to="slide.href"
        :aria-hidden="index !== activeIndex"
        :aria-label="`${slide.title}，${slide.cta}`"
        :tabindex="index === activeIndex ? 0 : -1"
        @click="handleLinkClick"
      >
        <img
          class="promo-image"
          :src="slide.image"
          :alt="slide.imageAlt"
          :style="{ objectPosition: slide.position || 'center' }"
          :loading="index === 0 ? 'eager' : 'lazy'"
        >
        <span class="promo-shade" aria-hidden="true" />
        <span class="promo-grid" aria-hidden="true" />

        <span class="promo-copy">
          <span class="promo-kicker">{{ slide.kicker }}</span>
          <strong>
            <span v-if="slide.highlight" class="promo-title-highlight">{{ slide.highlight }}</span>{{ slide.highlight ? slide.title.slice(slide.highlight.length) : slide.title }}
          </strong>
          <span class="promo-summary">{{ slide.summary }}</span>
          <span class="promo-cta">
            {{ slide.cta }}
            <span aria-hidden="true">↗</span>
          </span>
        </span>
      </NuxtLink>

      <button class="promo-arrow promo-arrow-prev" type="button" aria-label="上一张宣传内容" @click="moveSlide(-1)">
        <span aria-hidden="true">←</span>
      </button>
      <button class="promo-arrow promo-arrow-next" type="button" aria-label="下一张宣传内容" @click="moveSlide(1)">
        <span aria-hidden="true">→</span>
      </button>

      <div class="promo-index" aria-label="选择宣传内容">
        <button
          v-for="(slide, index) in slides"
          :key="`promo-index-${slide.href}`"
          type="button"
          :class="{ 'is-active': index === activeIndex }"
          :aria-label="`显示第 ${index + 1} 张：${slide.title}`"
          :aria-current="index === activeIndex ? 'true' : undefined"
          @click="selectSlide(index)"
        >
          <span class="promo-index-line" aria-hidden="true" />
          <span class="promo-index-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        </button>
      </div>

      <button
        class="promo-play-toggle"
        type="button"
        :aria-label="isPaused ? '继续自动轮播' : '暂停自动轮播'"
        :title="isPaused ? '继续自动轮播' : '暂停自动轮播'"
        @click="toggleAutoplay"
      >
        <span aria-hidden="true">{{ isPaused ? '▶' : 'Ⅱ' }}</span>
      </button>
    </div>
  </section>
</template>
