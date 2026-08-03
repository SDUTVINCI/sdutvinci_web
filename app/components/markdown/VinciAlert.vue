<script setup lang="ts">
const props = withDefaults(defineProps<{
  tone?: string
  title?: string
}>(), {
  tone: 'info',
  title: '提示'
})

const normalizedTone = computed(() => (
  ['info', 'success', 'warning', 'danger'].includes(props.tone)
    ? props.tone
    : 'info'
))
</script>

<template>
  <aside class="vinci-content-alert" :data-tone="normalizedTone" role="note">
    <strong v-if="title">{{ title }}</strong>
    <div class="vinci-content-component-body">
      <slot />
    </div>
  </aside>
</template>
