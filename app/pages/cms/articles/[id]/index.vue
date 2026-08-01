<script setup lang="ts">
import type { CmsArticleDetail } from '../../../../../shared/types/cms-articles'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { session, csrfHeaders } = useCmsSession()
const openingDraft = ref(false)
const draftError = ref('')
const actionMessage = ref('')
const actionError = ref('')
const actionBusy = ref(false)
const retryingExport = ref(false)
const autoOpening = ref(false)
const returnTo = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return /^\/(news|wiki)(\/|$)/.test(value) && !value.includes('\\') ? value : ''
})

const { data, refresh } = await useAsyncData(`cms:article:${id}`, () =>
  requestFetch<{ article: CmsArticleDetail }>(`/api/cms/articles/${id}`)
)
const article = computed(() => data.value?.article)
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)

if (!article.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在' })
}

useHead(() => ({ title: `${article.value?.title || '文章'} · Vinci 内容管理后台` }))

const openDraft = async () => {
  if (article.value?.isDeleted) return
  openingDraft.value = true
  draftError.value = ''
  try {
    const result = await $fetch<{ draft: { id: string } }>('/api/cms/drafts', {
      method: 'POST',
      headers: csrfHeaders(),
      body: { kind: 'existing', articleId: id }
    })
    await navigateTo({
      path: `/cms/drafts/${result.draft.id}`,
      query: returnTo.value ? { returnTo: returnTo.value } : undefined
    })
  } catch (error: any) {
    draftError.value = error?.data?.message || '打开草稿失败'
  } finally {
    openingDraft.value = false
  }
}

const changeDeletionState = async (restore: boolean) => {
  if (!isAdmin.value || actionBusy.value) return
  if (
    !restore
    && !window.confirm(
      '确定删除正式文章吗？DB-first 会立即下线并写 Outbox；legacy_git 回滚模式沿用原 Git 删除。'
    )
  ) return
  actionBusy.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    const endpoint = restore
      ? `/api/cms/articles/${id}/restore-deleted`
      : `/api/cms/articles/${id}/delete`
    const result = await $fetch<{ result: {
      commitHash: string | null
      revisionId: string | null
      revisionNumber: number | null
      exportStatus: string
    } }>(endpoint, {
      method: 'POST',
      headers: csrfHeaders()
    })
    actionMessage.value = result.result.revisionId
      ? `${restore ? '文章已恢复' : '文章已删除'}，当前 Revision #${result.result.revisionNumber}；等待导出。`
      : `${restore ? '文章已恢复' : '文章已删除'}，Git Commit：${result.result.commitHash}`
    await refresh()
  } catch (error: any) {
    actionError.value = error?.data?.message || `${restore ? '恢复' : '删除'}失败`
  } finally {
    actionBusy.value = false
  }
}

const retryExport = async () => {
  const jobId = article.value?.exportStatus.currentJobId
  if (!isAdmin.value || !jobId || retryingExport.value) return
  retryingExport.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    await $fetch(`/api/cms/content-export/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: csrfHeaders()
    })
    actionMessage.value = '导出任务已重新进入等待队列；数据库正式内容未发生变化。'
    await refresh()
  } catch (error: any) {
    actionError.value = error?.data?.message || '重新排队导出任务失败'
  } finally {
    retryingExport.value = false
  }
}

onMounted(async () => {
  if (route.query.edit === '1' && !autoOpening.value) {
    autoOpening.value = true
    await openDraft()
  }
})
</script>

<template>
  <section v-if="article" class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <NuxtLink class="cms-back-link" :to="returnTo || '/cms/articles'">
          ← {{ returnTo ? '返回原文章' : '返回文章列表' }}
        </NuxtLink>
        <p class="cms-eyebrow">{{ article.isDeleted ? 'DELETED' : 'PUBLISHED' }} · {{ article.collection }}</p>
        <h1>{{ article.title }}</h1>
        <p><code>{{ article.relativePath }}</code> · 稳定 ID：<code>{{ article.id }}</code></p>
      </div>
      <div class="cms-header-buttons">
        <NuxtLink class="cms-button cms-button-link cms-button-quiet" :to="`/cms/articles/${id}/history`">
          版本历史
        </NuxtLink>
        <button
          v-if="!article.isDeleted"
          class="cms-button cms-button-primary"
          type="button"
          :disabled="openingDraft"
          @click="openDraft"
        >
          {{ openingDraft ? '正在打开…' : '编辑草稿' }}
        </button>
        <button
          v-if="isAdmin"
          class="cms-button"
          :class="article.isDeleted ? 'cms-button-primary' : 'cms-button-danger'"
          type="button"
          :disabled="actionBusy"
          @click="changeDeletionState(article.isDeleted)"
        >
          {{ actionBusy ? '正在处理…' : article.isDeleted ? '恢复正式文章' : '删除正式文章' }}
        </button>
      </div>
    </header>
    <p v-if="draftError" class="cms-alert cms-alert-error">{{ draftError }}</p>
    <p v-if="actionMessage" class="cms-alert">{{ actionMessage }}</p>
    <p v-if="actionError" class="cms-alert cms-alert-error">{{ actionError }}</p>
    <p v-if="article.isDeleted" class="cms-alert cms-alert-error">
      {{
        article.exportStatus.state === 'not_applicable'
          ? '此正式文章已按 legacy_git 回滚模式删除；历史仍保留，管理员可以恢复。'
          : '此正式文章已从数据库当前状态删除；Revision 历史仍保留，管理员可以恢复。'
      }}
    </p>

    <div class="cms-detail-grid">
      <article class="cms-panel cms-preview">
        <h2>渲染预览</h2>
        <VinciMarkdownRenderer v-if="!article.isDeleted" :markdown="article.body" />
        <pre v-else class="cms-source">{{ article.body }}</pre>
      </article>
      <aside class="cms-panel cms-frontmatter">
        <h2>Frontmatter</h2>
        <dl>
          <template v-for="(value, key) in article.frontmatter" :key="key">
            <dt>{{ key }}</dt>
            <dd><pre>{{ typeof value === 'string' ? value : JSON.stringify(value, null, 2) }}</pre></dd>
          </template>
        </dl>
        <h2>内容校验</h2>
        <p class="cms-muted">SHA-256</p>
        <code class="cms-hash">{{ article.contentHash }}</code>
        <template v-if="article.currentRevision">
          <h2>当前 Revision</h2>
          <p>
            #{{ article.currentRevision.revisionNumber }}<br>
            <code>{{ article.currentRevision.id }}</code>
          </p>
        </template>
        <h2>内容仓库导出状态</h2>
        <p class="cms-muted">
          {{
            article.exportStatus.state === 'waiting_export'
              ? '等待导出'
              : article.exportStatus.state === 'synchronized'
                ? '数据库与最近导出版本一致'
                : article.exportStatus.state === 'export_behind'
                  ? '数据库版本领先最近导出版本'
                  : article.exportStatus.state === 'export_failed'
                    ? '最近导出失败，数据库正式状态不受影响'
                    : article.exportStatus.state === 'untracked'
                      ? '尚无可核对的导出版本'
                      : 'legacy_git 回滚模式'
          }}
        </p>
        <p v-if="article.exportStatus.latestExportedRevisionId" class="cms-muted">
          最近导出 Revision：<code>{{ article.exportStatus.latestExportedRevisionId }}</code>
        </p>
        <p v-if="article.exportStatus.latestExportedCommitHash" class="cms-muted">
          内容仓库 Commit：<code>{{ article.exportStatus.latestExportedCommitHash }}</code>
        </p>
        <p v-if="article.exportStatus.currentJobAttemptCount !== null" class="cms-muted">
          已尝试 {{ article.exportStatus.currentJobAttemptCount }} 次
          <template v-if="article.exportStatus.currentJobNextAttemptAt">
            · 下次：{{ new Date(article.exportStatus.currentJobNextAttemptAt).toLocaleString() }}
          </template>
        </p>
        <p v-if="article.exportStatus.currentJobLastErrorCode" class="cms-alert cms-alert-error">
          {{ article.exportStatus.currentJobLastErrorCode }}：
          {{ article.exportStatus.currentJobLastError || '导出失败详情已脱敏' }}
        </p>
        <button
          v-if="isAdmin && article.exportStatus.canRetry"
          class="cms-button cms-button-primary"
          type="button"
          :disabled="retryingExport"
          @click="retryExport"
        >
          {{ retryingExport ? '正在重新排队…' : '手动重试导出' }}
        </button>
      </aside>
    </div>
  </section>
</template>
