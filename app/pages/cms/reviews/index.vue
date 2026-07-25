<script setup lang="ts">
import type { CmsReviewSummary } from '../../../../shared/types/cms-reviews'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '待审核内容 · Vinci 内容管理后台' })
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, status, error, refresh } = await useAsyncData(
  'cms:reviews',
  () => requestFetch<{ reviews: CmsReviewSummary[] }>('/api/cms/reviews')
)
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">REVIEWS</p>
        <h1>待审核内容</h1>
        <p>审核通过后由管理员在文章详情执行正式发布；此处只处理审核决定。</p>
      </div>
      <button class="cms-button cms-button-quiet" type="button" @click="refresh()">
        刷新
      </button>
    </header>

    <p v-if="status === 'pending'" class="cms-muted">正在加载待审核内容…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">加载失败，请稍后重试。</p>
    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>提交者</th>
            <th>集合</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="review in data?.reviews ?? []" :key="review.id">
            <td><NuxtLink :to="`/cms/reviews/${review.id}`">{{ review.title }}</NuxtLink></td>
            <td>{{ review.owner.memberName || `@${review.owner.account}` }}</td>
            <td><span class="cms-badge">{{ review.collection }}</span></td>
            <td>{{ new Date(review.submittedAt).toLocaleString('zh-CN') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.reviews.length" class="cms-empty">目前没有待审核内容。</p>
    </div>
  </section>
</template>
