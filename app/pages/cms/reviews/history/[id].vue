<script setup lang="ts">
import { reviewHistoryActionLabels, reviewHistoryKindLabels, type ReviewHistoryDetail } from '~~/shared/types/cms-review-history'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
const route = useRoute()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, error } = await useAsyncData(`cms:review-history:${route.params.id}`, () =>
  requestFetch<ReviewHistoryDetail>(`/api/cms/reviews/history/${route.params.id}`))
if (!data.value) throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: '审核历史不存在或无法读取' })
const detail = computed(() => data.value!)
useHead(() => ({ title: `${detail.value.entry.title} · 审核历史 · Vinci 内容管理后台` }))
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'medium', hour12: false }).format(new Date(value))
</script>

<template>
  <section class="cms-page">
    <NuxtLink class="cms-back-link" to="/cms/reviews/history">← 返回审核历史</NuxtLink>
    <header class="cms-page-header"><p class="cms-eyebrow">REVIEW RECORD</p><h1>{{ detail.entry.title }}</h1><p>{{ reviewHistoryKindLabels[detail.entry.kind] }} · {{ reviewHistoryActionLabels[detail.entry.action] }}</p></header>
    <section class="cms-panel">
      <dl class="history-summary">
        <div><dt>审核 / 操作人</dt><dd>{{ detail.entry.actorLabel }}</dd></div>
        <div><dt>提交人</dt><dd>{{ detail.entry.submitterLabel }}</dd></div>
        <div><dt>处理时间（北京时间）</dt><dd>{{ time(detail.entry.createdAt) }}</dd></div>
        <div v-if="detail.operation"><dt>操作内容</dt><dd>{{ detail.operation }}</dd></div>
      </dl>
      <h2>审核备注</h2><p class="history-text">{{ detail.entry.note || '未填写审核备注' }}</p>
      <NuxtLink v-if="detail.entry.batchId" class="cms-button cms-button-quiet" :to="{ path: '/cms/reviews/history', query: { batch: detail.entry.batchId } }">查看同批处理记录</NuxtLink>
    </section>
    <p v-if="detail.entry.legacy" class="cms-alert">这条记录由已有数据补录。当时的完整内容和身份快照未保存，名称按补录时的信息展示；未记录的审核人明确标为“历史记录未保存”。</p>
    <p v-if="detail.entry.action === 'failed'" class="cms-alert cms-alert-error">这是一次未完成的操作，不代表审核驳回。下方展示操作失败后读取的申请内容。</p>
    <section class="cms-panel history-content">
      <h2>当时的内容与变更</h2>
      <div v-if="detail.changes.length" class="cms-table-wrap"><table class="cms-table history-diff"><thead><tr><th>字段</th><th>变更前</th><th>申请 / 变更后</th></tr></thead><tbody>
        <tr v-for="change in detail.changes" :key="change.field"><th>{{ change.field }}</th><td><pre>{{ change.before }}</pre></td><td><pre>{{ change.after }}</pre></td></tr>
      </tbody></table></div>
      <p v-else class="cms-muted">{{ detail.entry.legacy ? '历史记录未保存当时的完整内容。' : '本次操作没有字段变化。' }}</p>
    </section>
  </section>
</template>

<style scoped>
.history-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
.history-summary dt { color: var(--muted); font-size: .85rem; }
.history-summary dd { margin: .35rem 0 0; overflow-wrap: anywhere; }
.history-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.history-content { margin-top: 1.5rem; }
.history-diff { table-layout: fixed; width: 100%; min-width: 640px; }
.history-diff th:first-child { width: 7.5rem; }
.history-diff td { vertical-align: top; }
.history-diff pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .9rem; line-height: 1.65; margin: 0; max-height: 32rem; overflow-y: auto; }
@media (max-width: 700px) { .history-summary { grid-template-columns: 1fr; } }
</style>
