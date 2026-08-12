<script setup lang="ts">
import {
  cmsDraftStatuses,
  type CmsBatchActionResult,
  type CmsDraftStatus,
  type CmsDraftSummary
} from '~~/shared/types/cms-drafts'

const BATCH_SUBMIT_CONFIRMATION = 'BATCH_SUBMIT_FOR_REVIEW'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '我的草稿 · Vinci 内容管理后台' })
const { session, csrfHeaders } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
type ActiveDraftStatus = Exclude<CmsDraftStatus, 'published'>
const activeDraftStatuses = cmsDraftStatuses.filter(
  (item): item is ActiveDraftStatus => item !== 'published'
)
const draftView = ref<'active' | 'published'>('active')
const selectedStatus = ref<'' | ActiveDraftStatus>('')
const showDeleted = ref(false)
const query = computed(() => ({
  status: draftView.value === 'published' ? 'published' : selectedStatus.value || undefined,
  view: draftView.value === 'active' && !selectedStatus.value ? 'active' : undefined,
  deleted: showDeleted.value || undefined,
  scope: isAdmin.value ? 'all' : 'mine'
}))
const { data, status: loadStatus, error, refresh } = await useFetch<{ drafts: CmsDraftSummary[] }>(
  '/api/cms/drafts',
  { query }
)
const actionBusyId = ref('')
const actionError = ref('')
const batchMessage = ref('')
const selectedDraftIds = ref<string[]>([])
const batchBusy = ref(false)
const drafts = computed(() => data.value?.drafts ?? [])
const eligibleDrafts = computed(() => drafts.value.filter(draft =>
  !draft.isDeleted && draft.status === 'draft' && draft.ownerUserId === session.value?.user.id
))
const allEligibleSelected = computed(() => eligibleDrafts.value.length > 0
  && eligibleDrafts.value.every(draft => selectedDraftIds.value.includes(draft.id)))

const setDraftView = (view: 'active' | 'published') => {
  draftView.value = view
  selectedStatus.value = ''
  selectedDraftIds.value = []
  batchMessage.value = ''
  actionError.value = ''
}

watch(drafts, (items) => {
  const validIds = new Set(items.filter(item => !item.isDeleted && item.status === 'draft'
    && item.ownerUserId === session.value?.user.id).map(item => item.id))
  selectedDraftIds.value = selectedDraftIds.value.filter(id => validIds.has(id))
})

const toggleAllEligible = () => {
  selectedDraftIds.value = allEligibleSelected.value
    ? []
    : eligibleDrafts.value.map(draft => draft.id)
}

const batchSubmit = async () => {
  const items = eligibleDrafts.value
    .filter(draft => selectedDraftIds.value.includes(draft.id))
    .map(draft => ({ id: draft.id, version: draft.version }))
  if (!items.length || !window.confirm(`确定批量提交 ${items.length} 篇草稿审核吗？系统会逐篇检查版本与编辑锁。`)) return
  batchBusy.value = true
  actionError.value = ''
  batchMessage.value = ''
  try {
    const response = await $fetch<{ results: CmsBatchActionResult[] }>('/api/cms/drafts/batch-submit', {
      method: 'POST', headers: csrfHeaders(), body: { items, confirm: BATCH_SUBMIT_CONFIRMATION }
    })
    const succeeded = response.results.filter(item => item.ok).length
    const failures = response.results.filter(item => !item.ok)
    batchMessage.value = `批量提交完成：成功 ${succeeded} 篇，失败 ${failures.length} 篇。`
    actionError.value = failures.length ? failures.map(item => item.message).join('；') : ''
    selectedDraftIds.value = []
    await refresh()
  } catch (error: any) {
    actionError.value = error?.data?.message || '批量提交审核失败'
  } finally { batchBusy.value = false }
}

const changeDeletionState = async (draft: CmsDraftSummary) => {
  if (!draft.isDeleted && !window.confirm('确定将这个草稿移入已删除吗？正式文章不会受影响。')) return
  actionBusyId.value = draft.id
  actionError.value = ''
  try {
    if (draft.isDeleted) {
      await $fetch(`/api/cms/drafts/${draft.id}/restore`, {
        method: 'POST',
        headers: csrfHeaders()
      })
    } else {
      await $fetch(`/api/cms/drafts/${draft.id}`, {
        method: 'DELETE',
        headers: csrfHeaders()
      })
    }
    await refresh()
  } catch (error: any) {
    actionError.value = error?.data?.message || `${draft.isDeleted ? '恢复' : '删除'}草稿失败`
  } finally {
    actionBusyId.value = ''
  }
}

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
        <h1>{{ isAdmin ? '草稿管理' : '我的草稿' }}</h1>
        <p>{{ isAdmin ? '管理员可以查看全部用户的活动草稿，并在独立视图中查阅已发布历史。' : '活动草稿不会改变前台文章；已发布记录保留在独立历史视图中。' }}</p>
      </div>
      <NuxtLink class="cms-button cms-button-primary cms-button-link" to="/cms/articles/new">
        新建文章草稿
      </NuxtLink>
    </header>

    <div class="cms-draft-view-switch" aria-label="草稿视图">
      <button
        type="button"
        :class="{ 'is-active': draftView === 'active' }"
        :aria-pressed="draftView === 'active'"
        @click="setDraftView('active')"
      >
        <strong>活动草稿</strong>
        <span>编辑、审核与待发布内容</span>
      </button>
      <button
        type="button"
        :class="{ 'is-active': draftView === 'published' }"
        :aria-pressed="draftView === 'published'"
        @click="setDraftView('published')"
      >
        <strong>已发布历史</strong>
        <span>只读记录，可重新发起编辑</span>
      </button>
    </div>

    <div class="cms-toolbar cms-drafts-toolbar">
      <label v-if="draftView === 'active'">
        <span>活动状态</span>
        <select v-model="selectedStatus">
          <option value="">全部活动状态</option>
          <option v-for="item in activeDraftStatuses" :key="item" :value="item">{{ statusLabels[item] }}</option>
        </select>
      </label>
      <p v-else class="cms-draft-history-copy">
        已发布记录不会计入活动草稿数量。打开记录后可以从当前正式文章继续编辑。
      </p>
      <label class="cms-checkbox-label">
        <input v-model="showDeleted" type="checkbox">
        <span>查看已删除草稿</span>
      </label>
      <div v-if="draftView === 'active'" class="cms-draft-batch-actions">
        <button
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="!eligibleDrafts.length || batchBusy"
          @click="toggleAllEligible"
        >{{ allEligibleSelected ? '取消全选可提交草稿' : '全选可提交草稿' }}</button>
        <button
          class="cms-button cms-button-primary"
          type="button"
          :disabled="!selectedDraftIds.length || batchBusy"
          @click="batchSubmit"
        >{{ batchBusy ? '正在逐篇提交…' : `批量提交审核（${selectedDraftIds.length}）` }}</button>
      </div>
    </div>
    <p v-if="batchMessage" class="cms-alert">{{ batchMessage }}</p>
    <p v-if="actionError" class="cms-alert cms-alert-error">{{ actionError }}</p>
    <p v-if="loadStatus === 'pending'" class="cms-muted">正在加载草稿…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '草稿加载失败' }}</p>

    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th v-if="draftView === 'active'">选择</th>
            <th>标题</th>
            <th>类型</th>
            <th v-if="isAdmin">创建者</th>
            <th>集合</th>
            <th>状态</th>
            <th>草稿版本</th>
            <th>最后保存</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in data?.drafts ?? []" :key="draft.id">
            <td v-if="draftView === 'active'">
              <input
                v-model="selectedDraftIds"
                type="checkbox"
                :value="draft.id"
                :aria-label="`选择草稿：${draft.title}`"
                :disabled="draft.isDeleted || draft.status !== 'draft' || draft.ownerUserId !== session?.user.id"
              >
            </td>
            <td>
              <NuxtLink v-if="!draft.isDeleted" :to="`/cms/drafts/${draft.id}`">{{ draft.title }}</NuxtLink>
              <span v-else>{{ draft.title }}</span>
            </td>
            <td>{{ draft.articleId ? '已有文章修改' : '新文章' }}</td>
            <td v-if="isAdmin">@{{ draft.ownerAccount }}</td>
            <td><span class="cms-badge">{{ draft.collection }}</span></td>
            <td><span class="cms-badge" :class="{ 'cms-badge-danger': draft.isDeleted }">{{ draft.isDeleted ? '已删除' : statusLabels[draft.status] }}</span></td>
            <td>{{ draft.version }}</td>
            <td>{{ new Date(draft.updatedAt).toLocaleString('zh-CN') }}</td>
            <td>
              <button
                class="cms-button"
                :class="draft.isDeleted ? 'cms-button-quiet' : 'cms-button-danger'"
                type="button"
                :disabled="actionBusyId === draft.id"
                @click="changeDeletionState(draft)"
              >
                {{ actionBusyId === draft.id ? '处理中…' : draft.isDeleted ? '恢复' : '删除' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.drafts.length" class="cms-empty">
        {{ draftView === 'published' ? '还没有已发布历史。' : '当前没有活动草稿。' }}
      </p>
    </div>
  </section>
</template>
