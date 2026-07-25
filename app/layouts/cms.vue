<script setup lang="ts">
const { session, logout } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const loggingOut = ref(false)

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
        <span>VINCI</span>
        <small>内容管理后台</small>
      </NuxtLink>

      <nav
        class="cms-nav"
        aria-label="后台导航"
      >
        <NuxtLink to="/cms">
          工作台
        </NuxtLink>
        <NuxtLink to="/cms/articles">
          文章
        </NuxtLink>
        <NuxtLink to="/cms/drafts">
          草稿
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/cms/reviews">
          审核
        </NuxtLink>
        <NuxtLink to="/cms/members">
          成员
        </NuxtLink>
        <NuxtLink to="/cms/profile">
          个人资料
        </NuxtLink>
        <span class="cms-nav-hint">{{ isAdmin ? '管理员可审核内容、接管编辑锁并维护成员资料' : '成员可以保存草稿、提交审核并在审核前撤回' }}</span>
      </nav>

      <div class="cms-sidebar-user">
        <strong>@{{ session?.user.account }}</strong>
        <button
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="loggingOut"
          @click="handleLogout"
        >
          {{ loggingOut ? '正在退出…' : '退出登录' }}
        </button>
      </div>
    </aside>

    <main class="cms-main">
      <slot />
    </main>
  </div>
</template>
