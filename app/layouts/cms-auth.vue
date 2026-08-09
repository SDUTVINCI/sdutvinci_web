<script setup lang="ts">
type Theme = 'light' | 'dark'
const theme = ref<Theme>('light')
const themeLabel = computed(() => theme.value === 'dark' ? '切换浅色模式' : '切换深色模式')
const themeIcon = computed(() => theme.value === 'dark' ? '☀' : '☾')

const applyTheme = (nextTheme: Theme, persist = true) => {
  theme.value = nextTheme
  if (!import.meta.client) return

  document.documentElement.dataset.theme = nextTheme
  if (persist) {
    try {
      localStorage.setItem('vinci-theme', nextTheme)
    } catch {
      // Restricted browsers may deny storage; the current page still switches.
    }
  }
}

const toggleTheme = () => {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  const activeTheme = document.documentElement.dataset.theme
  const initialTheme = activeTheme === 'light' || activeTheme === 'dark'
    ? activeTheme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  applyTheme(initialTheme, false)
})
</script>

<template>
  <div class="cms-auth-shell">
    <div class="cms-auth-ambient" aria-hidden="true">
      <span />
      <span />
    </div>

    <header class="cms-auth-topbar">
      <NuxtLink
        class="cms-auth-brand"
        to="/"
      >
        <img src="https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp" alt="">
        <span>
          <strong>山理工 Vinci 机器人队</strong>
          <small><span aria-hidden="true">←</span> 返回官方网站</small>
        </span>
      </NuxtLink>
      <div class="cms-auth-tools">
        <button
          class="cms-theme-toggle cms-auth-theme-toggle"
          type="button"
          :aria-label="themeLabel"
          :title="themeLabel"
          :aria-pressed="theme === 'dark'"
          @click="toggleTheme"
        >
          <span aria-hidden="true">{{ themeIcon }}</span>
          <span>{{ themeLabel }}</span>
        </button>
        <p class="cms-auth-system-mark">
          <span>VINCI</span>
          TEAM OPERATIONS
        </p>
      </div>
    </header>

    <main class="cms-auth-main">
      <slot />
    </main>

    <footer class="cms-auth-footer">
      <span>SDUT · ROBOCON</span>
      <span>CONTENT SYSTEM / 2026</span>
    </footer>
  </div>
</template>
