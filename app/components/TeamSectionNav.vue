<script setup lang="ts">
const route = useRoute()
const items = [
  { to: '/team', label: '成员名录', exact: true },
  { to: '/team/organization', label: '组织架构', exact: false }
]
</script>

<template>
  <nav class="team-section-nav" aria-label="团队页面导航">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :class="{ active: item.exact ? route.path === item.to : route.path.startsWith(item.to) }"
    >
      {{ item.label }}
    </NuxtLink>
  </nav>
</template>
