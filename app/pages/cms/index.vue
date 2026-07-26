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
      <h1>你好，{{ session?.user.member?.name || session?.user.account }}</h1>
      <p>从这里查看正式文章、草稿、审核与成员资料的最新状态。</p>
    </header>

    <p v-if="status === 'pending'" class="cms-muted">正在汇总后台数据…</p>
    <div v-else-if="error" class="cms-alert cms-alert-error" role="alert">
      <span>{{ error.message || '统计加载失败' }}</span>
      <button class="cms-button cms-button-quiet" type="button" @click="refresh()">重试</button>
    </div>
    <div class="cms-card-grid cms-dashboard-grid">
      <NuxtLink class="cms-card cms-card-link" data-tone="cyan" to="/cms/articles">
        <span class="cms-card-index">01 / CONTENT</span>
        <span class="cms-card-label">正式文章</span>
        <strong>{{ stats?.articles.published ?? '—' }}</strong>
        <small>查看已发布的内容</small>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" data-tone="red" to="/cms/drafts">
        <span class="cms-card-index">02 / DRAFTS</span>
        <span class="cms-card-label">{{ stats?.drafts.scope === 'all' ? '全部活动草稿' : '我的活动草稿' }}</span>
        <strong>{{ stats?.drafts.total ?? '—' }}</strong>
        <small>继续编写与协作</small>
      </NuxtLink>
      <NuxtLink
        class="cms-card cms-card-link"
        data-tone="gold"
        :to="session?.user.roles.includes('admin') ? '/cms/reviews' : '/cms/drafts'"
      >
        <span class="cms-card-index">03 / REVIEWS</span>
        <span class="cms-card-label">{{ session?.user.roles.includes('admin') ? '待审核' : '我的待审核' }}</span>
        <strong>{{ session?.user.roles.includes('admin') ? (stats?.pendingReviews ?? '—') : (stats?.drafts.byStatus.pending_review ?? '—') }}</strong>
        <small>查看内容审核状态</small>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" data-tone="green" to="/cms/members">
        <span class="cms-card-index">04 / MEMBERS</span>
        <span class="cms-card-label">成员档案</span>
        <strong>{{ stats?.members ?? '—' }}</strong>
        <small>维护团队公开资料</small>
      </NuxtLink>
      <NuxtLink
        v-if="session?.user.roles.includes('admin')"
        class="cms-card cms-card-link"
        data-tone="red"
        to="/cms/articles?status=deleted"
      >
        <span class="cms-card-index">05 / ARCHIVE</span>
        <span class="cms-card-label">已删除文章</span>
        <strong>{{ stats?.articles.deleted ?? '—' }}</strong>
        <small>查看可恢复的内容</small>
      </NuxtLink>
      <article class="cms-card cms-card-role" data-tone="cyan">
        <span class="cms-card-index">{{ session?.user.roles.includes('admin') ? '06' : '05' }} / IDENTITY</span>
        <span class="cms-card-label">当前角色</span>
        <strong>{{ session?.user.roles.join('、') }}</strong>
        <small>当前会话的权限范围</small>
      </article>
    </div>
  </section>
</template>
