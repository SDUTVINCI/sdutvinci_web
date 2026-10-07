<script setup lang="ts">
import { highlightSearchText } from '~~/shared/utils/public-search'

const props = defineProps<{ text: string, query: string }>()
const parts = computed(() => highlightSearchText(props.text, props.query))
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
</template>

<style scoped>
mark {
  border-radius: 3px;
  padding: 0 2px;
  background: color-mix(in srgb, var(--gold) 22%, var(--surface));
  color: var(--ink);
}
</style>
