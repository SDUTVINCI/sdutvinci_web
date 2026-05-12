<script setup lang="ts">
const route = useRoute()

const navItems = [
  { label: '首页', to: '/' },
  { label: '成果', to: '/research' },
  { label: '成员', to: '/team' }
]

const isActive = (to: string) => {
  if (to === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(to)
}
</script>

<template>
  <header class="site-header">
    <NuxtLink class="brand" to="/" aria-label="返回首页">
      <img class="brand-logo" src="/images/logo.png" alt="Vinci 机器人队标志">
      <span class="brand-copy">
        <span class="brand-title">山理工 Vinci 机器人队</span>
        <span class="brand-subtitle">创新，无畏，团结，拼搏</span>
      </span>
    </NuxtLink>

    <nav class="site-nav" aria-label="主导航">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        class="nav-link"
        :class="{ active: isActive(item.to) }"
        :to="item.to"
      >
        {{ item.label }}
      </NuxtLink>
    </nav>
  </header>
</template>
