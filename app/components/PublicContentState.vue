<script setup lang="ts">
withDefaults(defineProps<{
  pending?: boolean
  error?: boolean
  loadingMessage?: string
  errorMessage?: string
  emptyMessage?: string
}>(), {
  pending: false,
  error: false,
  loadingMessage: '正在加载内容…',
  errorMessage: '内容暂时无法加载，请稍后重试。',
  emptyMessage: '暂时没有内容。'
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="public-content-state" :aria-busy="pending">
    <p v-if="pending" role="status">{{ loadingMessage }}</p>
    <template v-else-if="error">
      <p role="alert">{{ errorMessage }}</p>
      <button type="button" @click="$emit('retry')">重新加载</button>
    </template>
    <p v-else role="status">{{ emptyMessage }}</p>
  </div>
</template>

<style scoped>
.public-content-state {
  display: grid;
  justify-items: center;
  gap: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 32px 20px;
  background: var(--surface);
  color: var(--muted);
  text-align: center;
}

.public-content-state button {
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 18px;
  background: var(--surface-soft);
  color: var(--cyan);
  cursor: pointer;
  font: inherit;
  font-weight: 750;
}

.public-content-state button:hover {
  border-color: var(--cyan);
}

.public-content-state button:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 3px;
}
</style>
