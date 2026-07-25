<script setup lang="ts">
import type { CmsDashboardStats } from '../../../shared/types/cms-dashboard'

definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '工作台 · Vinci 内容管理后台' })

const { session } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, status, error, refresh } = await useAsyncData('cms:dashboard', () =>
  requestFetch<{ stats: CmsDashboardStats }>('/api/cms/dashboard')
)
const stats = computed(() => data.value?.stats)
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header">
      <p class="cms-eyebrow">
        DASHBOARD
      </p>
      <h1>你好，{{ session?.user.account }}</h1>
      <p>从这里查看正式文章、草稿、审核与成员资料的最新状态。</p>
    </header>

    <p v-if="status === 'pending'" class="cms-muted">正在汇总后台数据…</p>
    <div v-else-if="error" class="cms-alert cms-alert-error" role="alert">
      <span>{{ error.message || '统计加载失败' }}</span>
      <button class="cms-button cms-button-quiet" type="button" @click="refresh()">重试</button>
    </div>
    <div class="cms-card-grid">
      <NuxtLink class="cms-card cms-card-link" to="/cms/articles">
        <span>正式文章</span><strong>{{ stats?.articles.published ?? '—' }}</strong>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" to="/cms/drafts">
        <span>{{ stats?.drafts.scope === 'all' ? '全部活动草稿' : '我的活动草稿' }}</span>
        <strong>{{ stats?.drafts.total ?? '—' }}</strong>
      </NuxtLink>
      <NuxtLink
        class="cms-card cms-card-link"
        :to="session?.user.roles.includes('admin') ? '/cms/reviews' : '/cms/drafts'"
      >
        <span>{{ session?.user.roles.includes('admin') ? '待审核' : '我的待审核' }}</span>
        <strong>{{ session?.user.roles.includes('admin') ? (stats?.pendingReviews ?? '—') : (stats?.drafts.byStatus.pending_review ?? '—') }}</strong>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" to="/cms/members">
        <span>成员档案</span><strong>{{ stats?.members ?? '—' }}</strong>
      </NuxtLink>
      <NuxtLink
        v-if="session?.user.roles.includes('admin')"
        class="cms-card cms-card-link"
        to="/cms/articles?status=deleted"
      >
        <span>已删除文章</span><strong>{{ stats?.articles.deleted ?? '—' }}</strong>
      </NuxtLink>
      <article class="cms-card">
        <span>当前角色</span><strong>{{ session?.user.roles.join('、') }}</strong>
      </article>
    </div>
  </section>
</template>
