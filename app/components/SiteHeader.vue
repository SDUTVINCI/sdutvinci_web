<script setup lang="ts">
const route = useRoute()

type Theme = 'light' | 'dark'

const navItems = [
  { label: '首页', to: '/' },
  { label: '成果', to: '/research' },
  { label: '项目', to: '/projects' },
  { label: '成员', to: '/team' },
  { label: '新闻', to: '/news' },
  { label: 'Wiki', to: '/wiki' },
  { label: '纳新', to: '/recruitment' },
  { label: '联系', to: '/contact' }
]

const theme = ref<Theme>('light')
const showMobileNav = ref(false)

const isActive = (to: string) => {
  if (to === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(to)
}

const applyTheme = (nextTheme: Theme, persist = true) => {
  theme.value = nextTheme

  if (!import.meta.client) return

  document.documentElement.dataset.theme = nextTheme

  if (persist) {
    localStorage.setItem('vinci-theme', nextTheme)
  }
}

const preferredTheme = () => {
  if (!import.meta.client) return 'light'

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const toggleTheme = () => {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

const closeMobileNav = () => {
  showMobileNav.value = false
}

const toggleMobileNav = () => {
  showMobileNav.value = !showMobileNav.value
}

const themeLabel = computed(() => theme.value === 'dark' ? '切换浅色模式' : '切换深色模式')
const themeIcon = computed(() => theme.value === 'dark' ? '☀' : '☾')
const mobileNavLabel = computed(() => showMobileNav.value ? '关闭导航菜单' : '打开导航菜单')

watch(() => route.fullPath, () => {
  closeMobileNav()
})

onMounted(() => {
  const storedTheme = localStorage.getItem('vinci-theme')
  applyTheme(storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : preferredTheme(), Boolean(storedTheme))
})
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

    <div class="header-actions">
      <button
        v-if="showMobileNav"
        class="mobile-nav-backdrop"
        type="button"
        aria-label="关闭导航"
        @click="closeMobileNav"
      />

      <nav
        id="site-navigation"
        class="site-nav"
        :class="{ 'is-open': showMobileNav }"
        aria-label="主导航"
      >
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          class="nav-link"
          :class="{ active: isActive(item.to) }"
          :to="item.to"
          @click="closeMobileNav"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <button
        class="theme-toggle"
        type="button"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="toggleTheme"
      >
        <span class="theme-toggle-icon" aria-hidden="true">{{ themeIcon }}</span>
        <span class="visually-hidden">{{ themeLabel }}</span>
      </button>

      <button
        class="nav-toggle"
        :class="{ 'is-open': showMobileNav }"
        type="button"
        :aria-expanded="showMobileNav"
        aria-controls="site-navigation"
        :aria-label="mobileNavLabel"
        :title="mobileNavLabel"
        @click="toggleMobileNav"
      >
        <span class="nav-toggle-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span class="visually-hidden">{{ mobileNavLabel }}</span>
      </button>
    </div>
  </header>
</template>
