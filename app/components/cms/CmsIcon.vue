<script setup lang="ts">
type CmsIconName =
  | 'dashboard'
  | 'articles'
  | 'drafts'
  | 'reviews'
  | 'members'
  | 'accounts'
  | 'profile'
  | 'external'
  | 'logout'
  | 'plus'
  | 'arrow'
  | 'activity'
  | 'spark'

defineProps<{
  name: CmsIconName
}>()
</script>

<template>
  <svg
    class="cms-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="name === 'dashboard'">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </g>
    <g v-else-if="name === 'articles'">
      <path d="M6 2.75h8.5L19 7.25V21H6z" />
      <path d="M14 2.75v5h5M9 12h6M9 16h6" />
    </g>
    <g v-else-if="name === 'drafts'">
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4M4 20h16" />
    </g>
    <g v-else-if="name === 'reviews'">
      <path d="M9 3h6l1 2h3v16H5V5h3z" />
      <path d="m8.5 13 2.2 2.2 4.8-5" />
    </g>
    <g v-else-if="name === 'members'">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13h0a5.5 5.5 0 0 1 5.5 5.5V20M16 5.5a3 3 0 0 1 0 5.8M17.5 14a5 5 0 0 1 3 4.6V20" />
    </g>
    <g v-else-if="name === 'accounts'">
      <path d="M12 2.75 20 6v5.5c0 4.8-3.35 8.35-8 9.75-4.65-1.4-8-4.95-8-9.75V6z" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" />
    </g>
    <g v-else-if="name === 'profile'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </g>
    <g v-else-if="name === 'external'">
      <path d="M14 5h5v5M11 13l8-8" />
      <path d="M19 13v6H5V5h6" />
    </g>
    <g v-else-if="name === 'logout'">
      <path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" />
    </g>
    <g v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </g>
    <g v-else-if="name === 'arrow'">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </g>
    <g v-else-if="name === 'activity'">
      <path d="M3 12h4l2.2-6 4.2 12 2.1-6H21" />
    </g>
    <g v-else>
      <path d="m12 2 1.45 5.05L18.5 8.5l-5.05 1.45L12 15l-1.45-5.05L5.5 8.5l5.05-1.45zM18.5 15l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
    </g>
  </svg>
</template>
