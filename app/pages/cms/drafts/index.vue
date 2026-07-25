<script setup lang="ts">
import {
  cmsDraftStatuses,
  type CmsDraftStatus,
  type CmsDraftSummary
} from '~~/shared/types/cms-drafts'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '我的草稿 · Vinci 内容管理后台' })
const { session, csrfHeaders } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const selectedStatus = ref<'' | CmsDraftStatus>('')
const showDeleted = ref(false)
const query = computed(() => ({
  status: selectedStatus.value || undefined,
  deleted: showDeleted.value || undefined,
  scope: isAdmin.value ? 'all' : 'mine'
}))
const { data, status: loadStatus, error, refresh } = await useFetch<{ drafts: CmsDraftSummary[] }>(
  '/api/cms/drafts',
  { query }
)
const actionBusyId = ref('')
const actionError = ref('')

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
        <p>{{ isAdmin ? '管理员可以查看、删除和恢复全部用户草稿。' : '重新打开后会恢复数据库中的最后保存版本。草稿不会改变前台文章。' }}</p>
      </div>
      <NuxtLink class="cms-button cms-button-primary cms-button-link" to="/cms/articles/new">
        新建文章草稿
      </NuxtLink>
    </header>

    <div class="cms-toolbar cms-toolbar-compact">
      <label>
        <span>草稿状态</span>
        <select v-model="selectedStatus">
          <option value="">全部状态</option>
          <option v-for="item in cmsDraftStatuses" :key="item" :value="item">{{ statusLabels[item] }}</option>
        </select>
      </label>
      <label class="cms-checkbox-label">
        <input v-model="showDeleted" type="checkbox">
        <span>查看已删除草稿</span>
      </label>
    </div>
    <p v-if="actionError" class="cms-alert cms-alert-error">{{ actionError }}</p>
    <p v-if="loadStatus === 'pending'" class="cms-muted">正在加载草稿…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '草稿加载失败' }}</p>

    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
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
      <p v-if="!data?.drafts.length" class="cms-empty">还没有草稿。</p>
    </div>
  </section>
</template>
