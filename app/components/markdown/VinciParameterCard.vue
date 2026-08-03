<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
}>(), {
  title: '参数'
})
</script>

<template>
  <section class="vinci-parameter-card">
    <header>{{ title }}</header>
    <div class="vinci-content-component-body">
      <slot />
    </div>
  </section>
</template>
