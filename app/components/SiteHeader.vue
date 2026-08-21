<script setup lang="ts">
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const route = useRoute()
const { session, loaded, loadSession, logout } = useCmsSession()

type Theme = 'light' | 'dark'

const navItems = [
  { label: '首页', to: '/' },
  { label: '成果', to: '/research' },
  { label: '项目', to: '/projects' },
  { label: '团队', to: '/team' },
  { label: '新闻', to: '/news' },
  { label: 'Wiki', to: '/wiki' },
  { label: '纳新', to: '/recruitment' },
  { label: '联系', to: '/contact' }
]

const theme = ref<Theme>('light')
const showMobileNav = ref(false)
const accountMenu = ref<HTMLDetailsElement | null>(null)
const loggingOut = ref(false)
const logoutError = ref('')

const displayName = computed(() =>
  session.value?.user.member?.name || session.value?.user.account || ''
)
const avatarUrl = computed(() =>
  resolveStaticMediaUrl(session.value?.user.member?.avatarUrl || '/images/logo.png')
)

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

const closeAccountMenu = () => {
  if (accountMenu.value) {
    accountMenu.value.open = false
  }
  logoutError.value = ''
}

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (
    accountMenu.value?.open
    && event.target instanceof Node
    && !accountMenu.value.contains(event.target)
  ) {
    closeAccountMenu()
  }
}

const handleDocumentKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeAccountMenu()
  }
}

const handleLogout = async () => {
  loggingOut.value = true
  logoutError.value = ''

  try {
    await logout()
    closeAccountMenu()
  } catch {
    logoutError.value = '退出失败，请稍后重试'
  } finally {
    loggingOut.value = false
  }
}

const themeLabel = computed(() => theme.value === 'dark' ? '切换浅色模式' : '切换深色模式')
const themeIcon = computed(() => theme.value === 'dark' ? '☀' : '☾')
const mobileNavLabel = computed(() => showMobileNav.value ? '关闭导航菜单' : '打开导航菜单')

watch(() => route.fullPath, () => {
  closeMobileNav()
  closeAccountMenu()
})

onMounted(() => {
  const storedTheme = localStorage.getItem('vinci-theme')
  applyTheme(storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : preferredTheme(), Boolean(storedTheme))
  void loadSession()
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeyDown)
})
</script>

<template>
  <header class="site-header">
    <NuxtLink class="brand" to="/" aria-label="返回首页">
      <img class="brand-logo" src="https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp" alt="Vinci 机器人队标志">
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

      <details
        v-if="session"
        ref="accountMenu"
        class="site-account"
      >
        <summary
          class="site-account-summary"
          aria-label="打开账号菜单"
        >
          <img
            class="site-account-avatar"
            :src="avatarUrl"
            :alt="`${displayName}的头像`"
          >
          <span class="site-account-name">{{ displayName }}</span>
          <span class="site-account-chevron" aria-hidden="true">⌄</span>
        </summary>

        <div class="site-account-menu">
          <div class="site-account-identity">
            <strong>{{ displayName }}</strong>
            <span>@{{ session.user.account }}</span>
          </div>
          <NuxtLink to="/cms" @click="closeAccountMenu">
            进入后台
          </NuxtLink>
          <NuxtLink to="/cms/profile" @click="closeAccountMenu">
            个人中心
          </NuxtLink>
          <button
            type="button"
            :disabled="loggingOut"
            @click="handleLogout"
          >
            {{ loggingOut ? '正在退出…' : '退出登录' }}
          </button>
          <p v-if="logoutError" class="site-account-error" role="alert">
            {{ logoutError }}
          </p>
        </div>
      </details>

      <NuxtLink
        v-else-if="loaded"
        class="site-login-link"
        to="/cms/login"
      >
        <span aria-hidden="true">↗</span>
        登录
      </NuxtLink>

      <span
        v-else
        class="site-account-loading"
        aria-label="正在确认登录状态"
      />

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
