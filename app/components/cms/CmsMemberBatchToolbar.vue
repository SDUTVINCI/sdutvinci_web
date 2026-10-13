<script setup lang="ts">
defineProps<{ title: string, total: number, selected: number, busy: boolean }>()
defineEmits<{ toggle: [], approve: [], reject: [] }>()
</script>
<template>
  <div class="cms-member-batch-toolbar" :aria-label="`${title}批量操作`">
    <strong>{{ title }}</strong><span>已选 {{ selected }} / {{ total }} 项</span>
    <button type="button" class="cms-button cms-button-quiet" :disabled="busy || !total" @click="$emit('toggle')">{{ total && selected === total ? '取消全选' : '全选' }}</button>
    <button type="button" class="cms-button cms-button-primary" :disabled="busy || !selected" @click="$emit('approve')">批量通过</button>
    <button type="button" class="cms-button" :disabled="busy || !selected" @click="$emit('reject')">批量拒绝</button>
  </div>
</template>
<style scoped>
.cms-member-batch-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
strong { margin-right: auto; } span { color: var(--ink-soft); font-size: .88rem; }
</style>
