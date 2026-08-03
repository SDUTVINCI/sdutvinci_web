<script setup lang="ts">
import type { CmsDashboardStats } from '../../../shared/types/cms-dashboard'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

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
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const displayName = computed(() =>
  session.value?.user.member?.name || session.value?.user.account || '队员'
)
const avatarUrl = computed(() =>
  resolveStaticMediaUrl(session.value?.user.member?.avatarUrl || '/images/logo.png')
)
</script>

<template>
  <section class="cms-page cms-dashboard">
    <header class="cms-dashboard-hero">
      <div class="cms-dashboard-hero-copy">
        <p class="cms-dashboard-kicker">
          <span><CmsIcon name="spark" /></span>
          TEAM CONTENT COMMAND
        </p>
        <h1>欢迎回来，<em>{{ displayName }}</em></h1>
        <p>管理 Vinci 的每一次记录、审核与发布，让团队成果稳定抵达前台。</p>
        <div class="cms-dashboard-actions">
          <NuxtLink class="cms-button cms-button-primary cms-button-link" to="/cms/articles/new">
            <CmsIcon name="plus" />
            新建文章
          </NuxtLink>
          <NuxtLink
            class="cms-button cms-button-link cms-button-dashboard"
            :to="isAdmin ? '/cms/reviews' : '/cms/drafts'"
          >
            {{ isAdmin ? '处理待审核' : '继续写草稿' }}
            <CmsIcon name="arrow" />
          </NuxtLink>
        </div>
      </div>
      <div class="cms-dashboard-identity">
        <span class="cms-dashboard-orbit" aria-hidden="true" />
        <img :src="avatarUrl" :alt="`${displayName}的头像`">
        <div>
          <span>ACTIVE OPERATOR</span>
          <strong>{{ displayName }}</strong>
          <small>{{ isAdmin ? 'ADMINISTRATOR' : 'TEAM MEMBER' }}</small>
        </div>
      </div>
      <div class="cms-dashboard-meta">
        <span><i /> SYSTEM READY</span>
        <span>{{ isAdmin ? '全局内容权限' : '个人内容权限' }}</span>
        <span>GIT VERSIONED</span>
      </div>
    </header>

    <p v-if="status === 'pending'" class="cms-muted">正在汇总后台数据…</p>
    <div v-else-if="error" class="cms-alert cms-alert-error" role="alert">
      <span>{{ error.message || '统计加载失败' }}</span>
      <button class="cms-button cms-button-quiet" type="button" @click="refresh()">重试</button>
    </div>

    <div class="cms-section-heading">
      <div>
        <p class="cms-eyebrow">LIVE OVERVIEW</p>
        <h2>内容概览</h2>
      </div>
      <p>数据来自当前 CMS 工作区</p>
    </div>

    <div class="cms-card-grid cms-dashboard-grid">
      <article class="cms-card cms-card-role" data-tone="green">
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="activity" /></span>
          <span class="cms-card-index">03:00 / RECONCILIATION</span>
        </span>
        <span class="cms-card-label">最近全量对账</span>
        <span class="cms-card-metric">
          <strong>
            {{ stats?.reconciliation
              ? ({ succeeded: '成功', failed: '失败', busy: '互斥跳过', processing: '进行中' }[stats.reconciliation.status])
              : '尚未运行' }}
          </strong>
        </span>
        <span v-if="stats?.reconciliation" class="cms-card-footer">
          {{ new Date(stats.reconciliation.completedAt || stats.reconciliation.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}
          · {{ stats.reconciliation.differenceCount }} 项差异
          <template v-if="stats.reconciliation.resultCommitHash">
            · {{ stats.reconciliation.resultCommitHash.slice(0, 12) }}
          </template>
        </span>
        <span v-else class="cms-card-footer">Asia/Shanghai 每日凌晨 3 点</span>
        <small v-if="stats?.reconciliation?.summary" class="cms-muted">
          {{ stats.reconciliation.summary }}
        </small>
      </article>
      <NuxtLink class="cms-card cms-card-link" data-tone="cyan" to="/cms/articles">
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="articles" /></span>
          <span class="cms-card-index">01 / CONTENT</span>
        </span>
        <span class="cms-card-label">正式文章</span>
        <span class="cms-card-metric"><strong>{{ stats?.articles.published ?? '—' }}</strong><small>篇</small></span>
        <span class="cms-card-footer">查看已发布内容 <CmsIcon name="arrow" /></span>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" data-tone="red" to="/cms/drafts">
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="drafts" /></span>
          <span class="cms-card-index">02 / DRAFTS</span>
        </span>
        <span class="cms-card-label">{{ stats?.drafts.scope === 'all' ? '全部活动草稿' : '我的活动草稿' }}</span>
        <span class="cms-card-metric"><strong>{{ stats?.drafts.total ?? '—' }}</strong><small>份</small></span>
        <span class="cms-card-footer">继续编写与协作 <CmsIcon name="arrow" /></span>
      </NuxtLink>
      <NuxtLink
        class="cms-card cms-card-link"
        data-tone="gold"
        :to="session?.user.roles.includes('admin') ? '/cms/reviews' : '/cms/drafts'"
      >
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="reviews" /></span>
          <span class="cms-card-index">03 / REVIEWS</span>
        </span>
        <span class="cms-card-label">{{ session?.user.roles.includes('admin') ? '待审核' : '我的待审核' }}</span>
        <span class="cms-card-metric"><strong>{{ session?.user.roles.includes('admin') ? (stats?.pendingReviews ?? '—') : (stats?.drafts.byStatus.pending_review ?? '—') }}</strong><small>项</small></span>
        <span class="cms-card-footer">查看审核状态 <CmsIcon name="arrow" /></span>
      </NuxtLink>
      <NuxtLink class="cms-card cms-card-link" data-tone="green" to="/cms/members">
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="members" /></span>
          <span class="cms-card-index">04 / MEMBERS</span>
        </span>
        <span class="cms-card-label">成员档案</span>
        <span class="cms-card-metric"><strong>{{ stats?.members ?? '—' }}</strong><small>人</small></span>
        <span class="cms-card-footer">维护公开资料 <CmsIcon name="arrow" /></span>
      </NuxtLink>
      <NuxtLink
        v-if="session?.user.roles.includes('admin')"
        class="cms-card cms-card-link"
        data-tone="red"
        to="/cms/articles?status=deleted"
      >
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="activity" /></span>
          <span class="cms-card-index">05 / ARCHIVE</span>
        </span>
        <span class="cms-card-label">已删除文章</span>
        <span class="cms-card-metric"><strong>{{ stats?.articles.deleted ?? '—' }}</strong><small>篇</small></span>
        <span class="cms-card-footer">查看可恢复内容 <CmsIcon name="arrow" /></span>
      </NuxtLink>
      <article class="cms-card cms-card-role" data-tone="cyan">
        <span class="cms-card-top">
          <span class="cms-card-icon"><CmsIcon name="accounts" /></span>
          <span class="cms-card-index">{{ session?.user.roles.includes('admin') ? '06' : '05' }} / IDENTITY</span>
        </span>
        <span class="cms-card-label">当前角色</span>
        <span class="cms-card-metric"><strong>{{ session?.user.roles.join('、') }}</strong></span>
        <span class="cms-card-footer">当前会话权限范围</span>
      </article>
    </div>

    <section class="cms-dashboard-flow">
      <div class="cms-section-heading">
        <div>
          <p class="cms-eyebrow">PUBLISHING FLOW</p>
          <h2>内容工作流</h2>
        </div>
        <p>从灵感到正式发布，每一步都有记录</p>
      </div>
      <div class="cms-flow-steps">
        <NuxtLink to="/cms/articles/new">
          <span class="cms-flow-index">01</span>
          <span class="cms-flow-icon"><CmsIcon name="drafts" /></span>
          <strong>创建草稿</strong>
          <small>整理内容与媒体资源</small>
        </NuxtLink>
        <NuxtLink :to="isAdmin ? '/cms/reviews' : '/cms/drafts'">
          <span class="cms-flow-index">02</span>
          <span class="cms-flow-icon"><CmsIcon name="reviews" /></span>
          <strong>协作审核</strong>
          <small>处理意见与版本冲突</small>
        </NuxtLink>
        <NuxtLink to="/cms/articles">
          <span class="cms-flow-index">03</span>
          <span class="cms-flow-icon"><CmsIcon name="articles" /></span>
          <strong>安全发布</strong>
          <small>Git 留痕并同步到前台</small>
        </NuxtLink>
      </div>
    </section>
  </section>
</template>
