<script setup lang="ts">
import type { CmsDraftSummary } from '../../../../shared/types/cms-drafts'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '我的草稿 · Vinci 内容管理后台' })
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data } = await useAsyncData('cms:drafts:list', () =>
  requestFetch<{ drafts: CmsDraftSummary[] }>('/api/cms/drafts')
)

const statusLabels: Record<CmsDraftSummary['status'], string> = {
  draft: '草稿',
  pending_review: '待审核',
  rejected: '已驳回',
  approved: '已通过',
  published: '已发布',
  withdrawn: '已撤回'
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">MY DRAFTS</p>
        <h1>我的草稿</h1>
        <p>重新打开后会恢复数据库中的最后保存版本。草稿不会改变前台文章。</p>
      </div>
      <NuxtLink class="cms-button cms-button-primary cms-button-link" to="/cms/articles/new">
        新建文章草稿
      </NuxtLink>
    </header>

    <div class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>类型</th>
            <th>集合</th>
            <th>状态</th>
            <th>草稿版本</th>
            <th>最后保存</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in data?.drafts ?? []" :key="draft.id">
            <td><NuxtLink :to="`/cms/drafts/${draft.id}`">{{ draft.title }}</NuxtLink></td>
            <td>{{ draft.articleId ? '已有文章修改' : '新文章' }}</td>
            <td><span class="cms-badge">{{ draft.collection }}</span></td>
            <td><span class="cms-badge">{{ statusLabels[draft.status] }}</span></td>
            <td>{{ draft.version }}</td>
            <td>{{ new Date(draft.updatedAt).toLocaleString('zh-CN') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.drafts.length" class="cms-empty">还没有草稿。</p>
    </div>
  </section>
</template>
