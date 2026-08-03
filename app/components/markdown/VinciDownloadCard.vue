<script setup lang="ts">
const props = withDefaults(defineProps<{
  href?: string
  title?: string
  description?: string
  size?: string
}>(), {
  href: '',
  title: '资料下载',
  description: '',
  size: ''
})

const safeHref = computed(() => {
  const href = props.href.trim()
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href
  try {
    const url = new URL(href)
    return ['http:', 'https:'].includes(url.protocol) ? href : ''
  } catch {
    return ''
  }
})
</script>

<template>
  <a
    v-if="safeHref"
    class="vinci-download-card"
    :href="safeHref"
  >
    <span class="vinci-download-card-icon" aria-hidden="true">↓</span>
    <span>
      <strong>{{ title }}</strong>
      <small v-if="description">{{ description }}</small>
    </span>
    <span v-if="size" class="vinci-download-card-size">{{ size }}</span>
  </a>
  <p v-else class="vinci-content-component-error">下载地址无效或使用了不安全协议。</p>
</template>
