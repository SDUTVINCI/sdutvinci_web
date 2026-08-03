<script setup lang="ts">
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const { session, logout } = useCmsSession()
const route = useRoute()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const canImport = computed(() => isAdmin.value
  || (session.value?.user.roles.includes('content_importer') ?? false))
const loggingOut = ref(false)
const displayName = computed(() =>
  session.value?.user.member?.name || session.value?.user.account || '当前用户'
)
const avatarUrl = computed(() =>
  resolveStaticMediaUrl(session.value?.user.member?.avatarUrl || '/images/logo.png')
)
const navItems = computed(() => [
  { to: '/cms', code: '01', label: '工作台', caption: 'OVERVIEW', icon: 'dashboard' as const },
  { to: '/cms/articles', code: '02', label: '文章', caption: 'ARTICLES', icon: 'articles' as const },
  { to: '/cms/drafts', code: '03', label: '草稿', caption: 'DRAFTS', icon: 'drafts' as const },
  ...(isAdmin.value
    ? [{ to: '/cms/reviews', code: '04', label: '审核', caption: 'REVIEWS', icon: 'reviews' as const }]
    : []),
  ...(canImport.value
    ? [{ to: '/cms/content-imports', code: 'IM', label: '外部内容导入', caption: 'PR IMPORT', icon: 'activity' as const }]
    : []),
  {
    to: '/cms/members',
    code: isAdmin.value ? '05' : '04',
    label: '成员',
    caption: 'MEMBERS',
    icon: 'members' as const
  },
  {
    to: '/cms/users',
    code: isAdmin.value ? '06' : '05',
    label: isAdmin.value ? '账号管理' : '账号安全',
    caption: 'ACCOUNTS',
    icon: 'accounts' as const
  },
  {
    to: '/cms/profile',
    code: isAdmin.value ? '07' : '06',
    label: '个人资料',
    caption: 'PROFILE',
    icon: 'profile' as const
  }
])
const sectionTitle = computed(() => {
  const section = route.path.split('/')[2] || ''
  return {
    articles: '内容',
    drafts: '草稿',
    reviews: '审核',
    'content-imports': '外部内容导入',
    members: '成员',
    users: '账号',
    profile: '个人资料'
  }[section] || '工作台'
})

const handleLogout = async () => {
  loggingOut.value = true
  try {
    await logout()
    await navigateTo('/cms/login')
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="cms-shell">
    <aside class="cms-sidebar">
      <NuxtLink
        class="cms-brand"
        to="/cms"
      >
        <span class="cms-brand-mark">
          <img src="https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp" alt="">
        </span>
        <span class="cms-brand-copy">
          <strong>Vinci 机器人队</strong>
          <small>CONTENT OPERATIONS</small>
        </span>
        <span class="cms-brand-signal" aria-hidden="true" />
      </NuxtLink>

      <div class="cms-sidebar-heading">
        <p class="cms-sidebar-label">WORKSPACE</p>
        <span><i /> ONLINE</span>
      </div>
      <nav
        class="cms-nav"
        aria-label="后台导航"
      >
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
        >
          <span class="cms-nav-icon">
            <CmsIcon :name="item.icon" />
          </span>
          <span class="cms-nav-copy">
            <strong>{{ item.label }}</strong>
            <small>{{ item.caption }}</small>
          </span>
          <span class="cms-nav-code">{{ item.code }}</span>
        </NuxtLink>
        <span class="cms-nav-hint">
          <span class="cms-nav-hint-icon">
            <CmsIcon name="activity" />
          </span>
          <strong>{{ isAdmin ? 'ADMIN CONTROL' : 'MEMBER ACCESS' }}</strong>
          <span>{{ isAdmin ? '管理员可审核内容、接管编辑锁并维护成员资料' : '成员可以保存草稿、提交审核并在审核前撤回' }}</span>
        </span>
      </nav>

      <div class="cms-sidebar-user">
        <NuxtLink class="cms-user-identity" to="/cms/profile">
          <img :src="avatarUrl" :alt="`${displayName}的头像`">
          <span class="cms-user-presence" aria-hidden="true" />
          <span class="cms-user-copy">
            <strong>{{ displayName }}</strong>
            <small>@{{ session?.user.account }}</small>
          </span>
          <span class="cms-user-role">{{ isAdmin ? 'ADMIN' : 'MEMBER' }}</span>
        </NuxtLink>
        <div class="cms-user-actions">
          <NuxtLink class="cms-button cms-button-link cms-button-quiet" to="/">
            <CmsIcon name="external" />
            <span>官网</span>
          </NuxtLink>
          <button
            class="cms-button cms-button-quiet"
            type="button"
            :disabled="loggingOut"
            @click="handleLogout"
          >
            <CmsIcon name="logout" />
            <span>{{ loggingOut ? '退出中…' : '退出' }}</span>
          </button>
        </div>
      </div>
    </aside>

    <main class="cms-main">
      <header class="cms-workspace-bar">
        <div class="cms-workspace-context">
          <span class="cms-workspace-icon">
            <CmsIcon name="spark" />
          </span>
          <p>
            <small>VINCI CMS</small>
            <strong>{{ sectionTitle }}</strong>
          </p>
        </div>
        <div class="cms-workspace-tools">
          <span class="cms-workspace-health">
            <i class="cms-workspace-dot" aria-hidden="true" />
            系统在线
          </span>
          <NuxtLink to="/">
            查看官网
            <CmsIcon name="external" />
          </NuxtLink>
        </div>
      </header>
      <div class="cms-main-content">
        <slot />
      </div>
    </main>
  </div>
</template>
