<script setup lang="ts">
defineProps<{
  name: 'arrow' | 'chevron' | 'document' | 'lock' | 'search'
}>()
</script>

<template>
  <svg
    class="wiki-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="name === 'search'">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m16 16 4.2 4.2" />
    </g>
    <g v-else-if="name === 'lock'">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </g>
    <g v-else-if="name === 'document'">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4M9 12h6M9 16h4" />
    </g>
    <path v-else-if="name === 'chevron'" d="m8 10 4 4 4-4" />
    <path v-else d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
</template>
