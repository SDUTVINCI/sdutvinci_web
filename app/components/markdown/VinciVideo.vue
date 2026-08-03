<script setup lang="ts">
const props = withDefaults(defineProps<{
  src?: string
  title?: string
}>(), {
  src: '',
  title: '视频'
})

const safeSource = computed(() => {
  const source = props.src.trim()
  if (source.startsWith('/')) return source
  try {
    const url = new URL(source)
    return ['http:', 'https:'].includes(url.protocol) ? source : ''
  } catch {
    return ''
  }
})
</script>

<template>
  <figure class="vinci-video-embed">
    <div v-if="safeSource" class="vinci-video-embed-frame">
      <iframe
        :src="safeSource"
        :title="title"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      />
    </div>
    <p v-else class="vinci-content-component-error">视频地址无效或使用了不安全协议。</p>
    <figcaption v-if="title">{{ title }}</figcaption>
  </figure>
</template>
