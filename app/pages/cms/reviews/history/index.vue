<script setup lang="ts">
import { reviewHistoryActionLabels, reviewHistoryActions, reviewHistoryKindLabels, reviewHistoryKinds, type ReviewHistoryPage } from '~~/shared/types/cms-review-history'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '审核历史 · Vinci 内容管理后台' })
const route = useRoute()
const router = useRouter()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const readFilter = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const filters = reactive({ query: readFilter('query'), kind: readFilter('kind'), action: readFilter('action'), reviewer: readFilter('reviewer'), from: readFilter('from'), to: readFilter('to') })
const historyQuery = computed(() => route.query)
const { data, status, error, refresh } = await useAsyncData('cms:review-history', () =>
  requestFetch<ReviewHistoryPage>('/api/cms/reviews/history', { query: historyQuery.value }), { watch: [historyQuery] })
watch(historyQuery, () => { for (const key of Object.keys(filters) as Array<keyof typeof filters>) filters[key] = readFilter(key) })
const applyFilters = () => router.push({ path: '/cms/reviews/history', query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) })
const resetFilters = () => {
  for (const key of Object.keys(filters) as Array<keyof typeof filters>) filters[key] = ''
  return router.push('/cms/reviews/history')
}
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / (data.value?.pageSize || 25))))
const goToPage = (page: number) => router.push({ path: '/cms/reviews/history', query: { ...route.query, page: String(page) } })
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
</script>

<template>
  <section class="cms-page">
    <NuxtLink class="cms-back-link" to="/cms/reviews">← 返回审核中心</NuxtLink>
    <header class="cms-page-header cms-page-header-actions">
      <div><p class="cms-eyebrow">REVIEW HISTORY</p><h1>审核历史</h1><p>查看文章、成员和账号申请的处理记录，时间均为北京时间。</p></div>
      <button class="cms-button cms-button-quiet" type="button" :disabled="status === 'pending'" @click="refresh()">刷新</button>
    </header>
    <form class="cms-panel history-filters" @submit.prevent="applyFilters">
      <label class="history-search">搜索<input v-model="filters.query" type="search" maxlength="100" placeholder="标题、姓名、账号或审核人"></label>
      <label>审核类型<select v-model="filters.kind"><option value="">全部类型</option><option v-for="kind in reviewHistoryKinds" :key="kind" :value="kind">{{ reviewHistoryKindLabels[kind] }}</option></select></label>
      <label>处理结果<select v-model="filters.action"><option value="">全部结果</option><option v-for="action in reviewHistoryActions" :key="action" :value="action">{{ reviewHistoryActionLabels[action] }}</option></select></label>
      <label>审核人<select v-model="filters.reviewer"><option value="">全部审核人</option><option v-for="reviewer in data?.reviewers" :key="reviewer.id" :value="reviewer.id">{{ reviewer.label }}</option></select></label>
      <label>开始日期<input v-model="filters.from" type="date"></label>
      <label>结束日期<input v-model="filters.to" type="date" :min="filters.from || undefined"></label>
      <div class="history-filter-actions"><button class="cms-button cms-button-primary" type="submit">查询</button><button class="cms-button cms-button-quiet" type="button" @click="resetFilters">重置</button></div>
    </form>
    <p v-if="route.query.batch" class="cms-alert">当前只显示同一批次的处理记录。<NuxtLink to="/cms/reviews/history">查看全部历史</NuxtLink></p>
    <p v-if="status === 'pending'" class="cms-muted" role="status">正在加载审核历史…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error" role="alert">加载失败，请检查筛选条件或刷新重试。</p>
    <section v-else class="cms-panel">
      <p class="cms-muted">共 {{ data?.total || 0 }} 条记录</p>
      <div v-if="data?.items.length" class="cms-table-wrap">
        <table class="cms-table history-table">
          <thead><tr><th>处理时间</th><th>类型 / 审核对象</th><th>提交人</th><th>审核 / 操作人</th><th>结果</th><th>备注</th><th>详情</th></tr></thead>
          <tbody><tr v-for="item in data.items" :key="item.id">
            <td class="history-time">{{ time(item.createdAt) }}<small v-if="item.legacy">历史补录</small></td>
            <td><small>{{ reviewHistoryKindLabels[item.kind] }}</small><strong>{{ item.title }}</strong></td>
            <td>{{ item.submitterLabel }}</td><td>{{ item.actorLabel }}</td>
            <td><span class="history-result" :data-result="item.action">{{ reviewHistoryActionLabels[item.action] }}</span></td>
            <td class="history-note">{{ item.note || '未填写备注' }}</td>
            <td><NuxtLink :to="`/cms/reviews/history/${item.id}`">查看详情</NuxtLink><NuxtLink v-if="item.batchId" class="history-batch" :to="{ path: '/cms/reviews/history', query: { batch: item.batchId } }">同批记录</NuxtLink></td>
          </tr></tbody>
        </table>
      </div>
      <div v-else class="history-empty"><strong>暂无符合条件的审核历史</strong><p>可以调整筛选条件，新的处理记录会在这里保留。</p></div>
      <nav v-if="data && (data.total > data.pageSize || data.page > 1)" class="history-pagination" aria-label="审核历史分页">
        <button class="cms-button cms-button-quiet" type="button" :disabled="data.page <= 1" @click="goToPage(data.page - 1)">上一页</button>
        <span>第 {{ data.page }} / {{ pageCount }} 页</span>
        <button class="cms-button cms-button-quiet" type="button" :disabled="data.page >= pageCount" @click="goToPage(data.page + 1)">下一页</button>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.history-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.history-filters label { display: grid; gap: .45rem; font-weight: 600; }
.history-filters input, .history-filters select { min-width: 0; width: 100%; padding: .65rem .75rem; border: 1px solid var(--line); border-radius: .65rem; background: var(--surface); color: inherit; font: inherit; }
.history-filter-actions, .history-pagination { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.history-filter-actions { grid-column: 1 / -1; }
.history-table { min-width: 900px; }
.history-table td { vertical-align: top; }
.history-table small, .history-table strong { display: block; }
.history-table small { color: var(--muted); font-size: .8rem; margin-bottom: .25rem; }
.history-time { white-space: nowrap; }
.history-note { max-width: 20rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.history-result { display: inline-block; white-space: nowrap; padding: .2rem .55rem; border-radius: 1rem; background: #e6f2eb; color: #1c6741; font-weight: 600; }
.history-result[data-result="rejected"], .history-result[data-result="failed"] { background: #fbeaea; color: #a42525; }
.history-result[data-result="published"] { background: #e6f0f8; color: #215879; }
.history-batch { display: block; margin-top: .5rem; }
.history-empty { text-align: center; padding: 3rem 1rem; }
.history-pagination { justify-content: center; margin-top: 1.5rem; }
@media (max-width: 760px) { .history-filters { grid-template-columns: 1fr; } }
</style>
