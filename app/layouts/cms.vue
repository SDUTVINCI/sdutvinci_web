<script setup lang="ts">
const { session, logout } = useCmsSession()
const route = useRoute()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const loggingOut = ref(false)
const displayName = computed(() =>
  session.value?.user.member?.name || session.value?.user.account || '当前用户'
)
const avatarUrl = computed(() =>
  session.value?.user.member?.avatarUrl || '/images/logo.png'
)
const sectionTitle = computed(() => {
  const section = route.path.split('/')[2] || ''
  return {
    articles: '内容',
    drafts: '草稿',
    reviews: '审核',
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
        <img src="/images/logo.png" alt="">
        <span>
          <strong>Vinci 机器人队</strong>
          <small>内容管理后台</small>
        </span>
      </NuxtLink>

      <p class="cms-sidebar-label">
        WORKSPACE
      </p>
      <nav
        class="cms-nav"
        aria-label="后台导航"
      >
        <NuxtLink to="/cms">
          <span class="cms-nav-code">01</span>
          <span class="cms-nav-copy">
            <strong>工作台</strong>
            <small>OVERVIEW</small>
          </span>
        </NuxtLink>
        <NuxtLink to="/cms/articles">
          <span class="cms-nav-code">02</span>
          <span class="cms-nav-copy">
            <strong>文章</strong>
            <small>ARTICLES</small>
          </span>
        </NuxtLink>
        <NuxtLink to="/cms/drafts">
          <span class="cms-nav-code">03</span>
          <span class="cms-nav-copy">
            <strong>草稿</strong>
            <small>DRAFTS</small>
          </span>
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/cms/reviews">
          <span class="cms-nav-code">04</span>
          <span class="cms-nav-copy">
            <strong>审核</strong>
            <small>REVIEWS</small>
          </span>
        </NuxtLink>
        <NuxtLink to="/cms/members">
          <span class="cms-nav-code">{{ isAdmin ? '05' : '04' }}</span>
          <span class="cms-nav-copy">
            <strong>成员</strong>
            <small>MEMBERS</small>
          </span>
        </NuxtLink>
        <NuxtLink to="/cms/users">
          <span class="cms-nav-code">{{ isAdmin ? '06' : '05' }}</span>
          <span class="cms-nav-copy">
            <strong>{{ isAdmin ? '账号管理' : '账号安全' }}</strong>
            <small>ACCOUNTS</small>
          </span>
        </NuxtLink>
        <NuxtLink to="/cms/profile">
          <span class="cms-nav-code">{{ isAdmin ? '07' : '06' }}</span>
          <span class="cms-nav-copy">
            <strong>个人资料</strong>
            <small>PROFILE</small>
          </span>
        </NuxtLink>
        <span class="cms-nav-hint">
          <strong>ACCESS SCOPE</strong>
          <span>{{ isAdmin ? '管理员可审核内容、接管编辑锁并维护成员资料' : '成员可以保存草稿、提交审核并在审核前撤回' }}</span>
        </span>
      </nav>

      <div class="cms-sidebar-user">
        <NuxtLink class="cms-user-identity" to="/cms/profile">
          <img :src="avatarUrl" :alt="`${displayName}的头像`">
          <span class="cms-user-copy">
            <strong>{{ displayName }}</strong>
            <small>@{{ session?.user.account }}</small>
          </span>
          <span class="cms-user-role">{{ isAdmin ? 'ADMIN' : 'MEMBER' }}</span>
        </NuxtLink>
        <div class="cms-user-actions">
          <NuxtLink class="cms-button cms-button-link cms-button-quiet" to="/">
            返回网站
          </NuxtLink>
          <button
            class="cms-button cms-button-quiet"
            type="button"
            :disabled="loggingOut"
            @click="handleLogout"
          >
            {{ loggingOut ? '正在退出…' : '退出' }}
          </button>
        </div>
      </div>
    </aside>

    <main class="cms-main">
      <header class="cms-workspace-bar">
        <p>
          <span class="cms-workspace-dot" aria-hidden="true" />
          VINCI CMS
          <span aria-hidden="true">/</span>
          <strong>{{ sectionTitle }}</strong>
        </p>
        <NuxtLink to="/">
          查看官网
          <span aria-hidden="true">↗</span>
        </NuxtLink>
      </header>
      <div class="cms-main-content">
        <slot />
      </div>
    </main>
  </div>
</template>
