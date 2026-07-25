<script setup lang="ts">
import type { CmsDraft, CmsDraftStatus } from '../../../../shared/types/cms-drafts'
import type { CmsEditLockResponse } from '../../../../shared/types/cms-edit-locks'
import type {
  CmsReviewComparison,
  CmsReviewEvent
} from '../../../../shared/types/cms-reviews'
import type { CmsMember } from '../../../../shared/types/cms-members'
import CmsMarkdownVisualEditor from '../../../components/cms/CmsMarkdownVisualEditor.client.vue'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const { session, csrfHeaders } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch

const [
  { data: draftData },
  { data: memberData },
  { data: comparisonData },
  { data: eventData }
] = await Promise.all([
  useAsyncData(`cms:draft:${id}`, () =>
    requestFetch<{ draft: CmsDraft }>(`/api/cms/drafts/${id}`)
  ),
  useAsyncData('cms:draft:members', () =>
    requestFetch<{ members: CmsMember[] }>('/api/cms/members')
  ),
  useAsyncData(`cms:draft:${id}:comparison`, () =>
    requestFetch<{ comparison: CmsReviewComparison }>(
      `/api/cms/drafts/${id}/comparison`
    )
  ),
  useAsyncData(`cms:draft:${id}:events`, () =>
    requestFetch<{ events: CmsReviewEvent[] }>(
      `/api/cms/drafts/${id}/review-events`
    )
  )
])

if (!draftData.value?.draft) {
  throw createError({ statusCode: 404, statusMessage: '草稿不存在' })
}

const initial = draftData.value.draft
const title = ref(initial.title)
const description = ref(initial.description)
const body = ref(initial.body)
const authorKeys = ref(initial.authors.map(author => author.memberKey))
const status = ref<CmsDraftStatus>(initial.status)
const version = ref(initial.version)
const baseContentHash = ref(initial.baseContentHash)
const lastSavedAt = ref(initial.lastSavedAt)
const comparison = ref(comparisonData.value?.comparison || null)
const reviewEvents = ref(eventData.value?.events || [])
const mode = ref<'source' | 'visual'>('source')
const visualKey = ref(0)
const visualSource = ref('')
const visualChecking = ref(false)
const dirty = ref(false)
const saveState = ref<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved')
const message = ref('')
const mounted = ref(false)
const workflowBusy = ref(false)
const lockState = ref<'idle' | 'loading' | 'acquired' | 'blocked' | 'lost' | 'error'>('idle')
const lockResponse = ref<CmsEditLockResponse | null>(null)
const takeoverReason = ref('')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let visualCheckTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let saving = false
let saveQueued = false
let leaving = false

const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const isOwner = computed(() => initial.ownerUserId === session.value?.user.id)
const leaseId = computed(() => lockResponse.value?.lock.leaseId || null)
const canEdit = computed(() =>
  status.value === 'draft'
  && lockState.value === 'acquired'
  && Boolean(leaseId.value)
)
const canContinueEditing = computed(() =>
  ['rejected', 'withdrawn'].includes(status.value)
  && (isOwner.value || isAdmin.value)
)
const latestRejection = computed(() =>
  reviewEvents.value.find(event => event.action === 'rejected')
)

const statusLabels: Record<CmsDraftStatus, string> = {
  draft: '草稿',
  pending_review: '待审核',
  rejected: '已驳回',
  approved: '已审核通过',
  published: '已发布',
  withdrawn: '已撤回'
}

const clearHeartbeat = () => {
  clearInterval(heartbeatTimer)
  heartbeatTimer = undefined
}

const loseLock = (text: string) => {
  clearHeartbeat()
  lockState.value = 'lost'
  saveState.value = 'error'
  message.value = text
}

const heartbeat = async () => {
  if (!leaseId.value || leaving) return
  try {
    lockResponse.value = await $fetch<CmsEditLockResponse>(
      `/api/cms/drafts/${id}/lock`,
      {
        method: 'PUT',
        headers: csrfHeaders(),
        body: { leaseId: leaseId.value }
      }
    )
  } catch {
    loseLock('编辑锁已失效，当前页面已切换为只读，请重新获取编辑权。')
  }
}

const startHeartbeat = () => {
  clearHeartbeat()
  const interval = lockResponse.value?.heartbeatIntervalMs || 20_000
  heartbeatTimer = setInterval(heartbeat, interval)
}

const acquireLock = async (takeover = false) => {
  lockState.value = 'loading'
  message.value = ''
  try {
    const result = await $fetch<CmsEditLockResponse>(
      takeover
        ? `/api/cms/drafts/${id}/lock/takeover`
        : `/api/cms/drafts/${id}/lock`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: takeover ? { reason: takeoverReason.value || undefined } : undefined
      }
    )
    lockResponse.value = result
    lockState.value = result.acquired ? 'acquired' : 'blocked'
    if (result.acquired) {
      startHeartbeat()
      message.value = takeover
        ? '已接管编辑锁，原编辑者的旧租约已失效。'
        : '已取得编辑锁。'
    }
    return result.acquired
  } catch (error: any) {
    lockState.value = 'error'
    message.value = error?.data?.message || '获取编辑锁失败'
    return false
  }
}

const clearLocalLock = () => {
  clearHeartbeat()
  lockResponse.value = null
  lockState.value = 'idle'
}

const releaseLock = async (keepalive = false) => {
  const currentLease = leaseId.value
  if (!currentLease) return
  clearHeartbeat()
  if (keepalive && import.meta.client) {
    void fetch(`/api/cms/drafts/${id}/lock`, {
      method: 'DELETE',
      credentials: 'same-origin',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        ...csrfHeaders()
      },
      body: JSON.stringify({ leaseId: currentLease })
    })
  } else {
    await $fetch(`/api/cms/drafts/${id}/lock`, {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: { leaseId: currentLease }
    }).catch(() => undefined)
  }
  clearLocalLock()
}

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
}

const handlePageHide = () => {
  releaseLock(true)
}

useHead(() => ({ title: `${title.value} · 草稿 · Vinci 内容管理后台` }))

const saveLabel = computed(() => {
  if (!canEdit.value && status.value !== 'draft') return statusLabels[status.value]
  if (lockState.value === 'blocked') return '只读 · 其他用户正在编辑'
  if (lockState.value === 'lost') return '只读 · 编辑锁已失效'
  if (saveState.value === 'saving') return '正在保存…'
  if (saveState.value === 'dirty') return '有未保存修改'
  if (saveState.value === 'error') return '自动保存失败'
  if (saveState.value === 'conflict') return '草稿版本冲突'
  return `已保存 · ${new Date(lastSavedAt.value).toLocaleTimeString('zh-CN')}`
})

const snapshot = () => ({
  title: title.value,
  description: description.value,
  body: body.value,
  authorKeys: [...authorKeys.value],
  version: version.value,
  lockLeaseId: leaseId.value || ''
})

const sameAsSnapshot = (value: ReturnType<typeof snapshot>) =>
  title.value === value.title
  && description.value === value.description
  && body.value === value.body
  && authorKeys.value.join('\0') === value.authorKeys.join('\0')

const save = async (manual = false) => {
  if (!canEdit.value) return false
  if (saving) {
    saveQueued = true
    return false
  }
  saving = true
  clearTimeout(saveTimer)
  const value = snapshot()
  saveState.value = 'saving'
  message.value = ''

  try {
    const result = await $fetch<{ draft: CmsDraft }>(`/api/cms/drafts/${id}`, {
      method: 'PUT',
      headers: csrfHeaders(),
      body: value
    })
    version.value = result.draft.version
    lastSavedAt.value = result.draft.lastSavedAt
    dirty.value = !sameAsSnapshot(value)
    saveState.value = dirty.value ? 'dirty' : 'saved'
    if (manual) message.value = '草稿已手动保存。'
    return true
  } catch (error: any) {
    const code = error?.data?.data?.code
    const responseStatus = error?.statusCode || error?.status
    if (responseStatus === 409 && code !== 'PUBLISHED_VERSION_CONFLICT') {
      saveState.value = 'conflict'
    } else {
      saveState.value = 'error'
    }
    message.value = error?.data?.message || '草稿保存失败'
    if (message.value.includes('编辑锁')) loseLock(message.value)
    return false
  } finally {
    saving = false
    if (saveQueued) {
      saveQueued = false
      await save(false)
    }
  }
}

const scheduleSave = () => {
  if (!mounted.value || !canEdit.value || saveState.value === 'conflict') return
  dirty.value = true
  saveState.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(false), 1200)
}

watch([title, description, body, authorKeys], scheduleSave, { deep: true })

const switchMode = (next: 'source' | 'visual') => {
  message.value = ''
  clearTimeout(visualCheckTimer)
  if (next === 'source') {
    mode.value = 'source'
    visualChecking.value = false
    return
  }

  visualSource.value = body.value
  visualChecking.value = true
  visualKey.value += 1
  mode.value = 'visual'
  visualCheckTimer = setTimeout(() => {
    handleVisualError('初始化超时')
  }, 15_000)
}

const handleVisualReady = (serialized: string) => {
  clearTimeout(visualCheckTimer)
  if (serialized !== visualSource.value) {
    message.value = '已进入混合可视化模式；HTML、Vue 等扩展语法已作为只读区域保护。'
  }
  visualChecking.value = false
}

const handleVisualError = (error: string) => {
  clearTimeout(visualCheckTimer)
  body.value = visualSource.value
  mode.value = 'source'
  visualChecking.value = false
  message.value = `可视化编辑器无法加载，已返回源码模式：${error}`
}

const refreshComparison = async () => {
  const result = await $fetch<{ comparison: CmsReviewComparison }>(
    `/api/cms/drafts/${id}/comparison`
  )
  comparison.value = result.comparison
}

const refreshEvents = async () => {
  const result = await $fetch<{ events: CmsReviewEvent[] }>(
    `/api/cms/drafts/${id}/review-events`
  )
  reviewEvents.value = result.events
}

const submitReview = async () => {
  if (!canEdit.value || !leaseId.value) return
  workflowBusy.value = true
  message.value = ''
  try {
    if (dirty.value && !await save(true)) return
    const result = await $fetch<{ draft: CmsDraft }>(
      `/api/cms/drafts/${id}/submit`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: { version: version.value, lockLeaseId: leaseId.value }
      }
    )
    status.value = result.draft.status
    version.value = result.draft.version
    dirty.value = false
    clearLocalLock()
    await refreshEvents()
    message.value = '已提交审核，审核完成前可以撤回。'
  } catch (error: any) {
    message.value = error?.data?.message || '提交审核失败'
    if (error?.data?.data?.code === 'PUBLISHED_VERSION_CONFLICT') {
      await refreshComparison()
    }
  } finally {
    workflowBusy.value = false
  }
}

const withdrawReview = async () => {
  workflowBusy.value = true
  message.value = ''
  try {
    const result = await $fetch<{ draft: CmsDraft }>(
      `/api/cms/drafts/${id}/withdraw`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: { version: version.value }
      }
    )
    status.value = result.draft.status
    version.value = result.draft.version
    await refreshEvents()
    message.value = '审核提交已撤回；点击“继续编辑”后可重新修改。'
  } catch (error: any) {
    message.value = error?.data?.message || '撤回失败'
  } finally {
    workflowBusy.value = false
  }
}

const continueEditing = async () => {
  workflowBusy.value = true
  message.value = ''
  try {
    if (!await acquireLock() || !leaseId.value) return
    const result = await $fetch<{ draft: CmsDraft }>(
      `/api/cms/drafts/${id}/reopen`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: { version: version.value, lockLeaseId: leaseId.value }
      }
    )
    status.value = result.draft.status
    version.value = result.draft.version
    await refreshEvents()
    message.value = '草稿已恢复为可编辑状态。'
  } catch (error: any) {
    await releaseLock()
    message.value = error?.data?.message || '恢复编辑失败'
  } finally {
    workflowBusy.value = false
  }
}

const confirmResync = async () => {
  if (
    !canEdit.value
    || !leaseId.value
    || !comparison.value?.currentContentHash
  ) return
  workflowBusy.value = true
  message.value = ''
  try {
    if (dirty.value && !await save(true)) return
    const result = await $fetch<{ draft: CmsDraft }>(
      `/api/cms/drafts/${id}/resync`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: {
          version: version.value,
          lockLeaseId: leaseId.value,
          expectedCurrentContentHash: comparison.value.currentContentHash
        }
      }
    )
    version.value = result.draft.version
    baseContentHash.value = result.draft.baseContentHash
    await Promise.all([refreshComparison(), refreshEvents()])
    message.value = '已把当前正式版本设为新基线；请确认内容后重新提交审核。'
  } catch (error: any) {
    message.value = error?.data?.message || '重新同步失败'
    await refreshComparison()
  } finally {
    workflowBusy.value = false
  }
}

onMounted(async () => {
  mounted.value = true
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handlePageHide)
  switchMode('visual')
  if (status.value === 'draft') await acquireLock()
})

onBeforeRouteLeave(async () => {
  if (dirty.value && !window.confirm('当前仍有未保存内容，确定离开吗？')) {
    return false
  }
  leaving = true
  await releaseLock()
  return true
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(visualCheckTimer)
  clearHeartbeat()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('pagehide', handlePageHide)
  if (!leaving) releaseLock(true)
})
</script>

<template>
  <section class="cms-page cms-editor-page">
    <header class="cms-editor-header">
      <div>
        <NuxtLink class="cms-back-link" :to="initial.articleId ? `/cms/articles/${initial.articleId}` : '/cms/articles'">
          ← 返回文章
        </NuxtLink>
        <p class="cms-eyebrow">{{ statusLabels[status].toUpperCase() }} · {{ initial.collection }}</p>
        <h1>{{ title || '未命名草稿' }}</h1>
        <p>
          <span :class="`cms-save-state cms-save-state-${saveState}`">{{ saveLabel }}</span>
          · 版本 {{ version }}
          · {{ baseContentHash ? '基于正式版本' : '尚未发布的新文章' }}
        </p>
      </div>
      <div class="cms-editor-actions">
        <button
          v-if="canEdit"
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="saveState === 'saving' || saveState === 'conflict'"
          @click="save(true)"
        >
          手动保存
        </button>
        <button
          v-if="canEdit"
          class="cms-button cms-button-primary"
          type="button"
          :disabled="workflowBusy || saveState === 'saving' || saveState === 'conflict'"
          @click="submitReview"
        >
          提交审核
        </button>
        <button
          v-if="status === 'pending_review' && isOwner"
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="workflowBusy"
          @click="withdrawReview"
        >
          撤回审核
        </button>
        <button
          v-if="canContinueEditing"
          class="cms-button cms-button-primary"
          type="button"
          :disabled="workflowBusy"
          @click="continueEditing"
        >
          继续编辑
        </button>
      </div>
    </header>

    <p v-if="message" class="cms-alert" :class="{ 'cms-alert-error': saveState === 'error' || saveState === 'conflict' }">
      {{ message }}
    </p>

    <section v-if="lockState === 'blocked' && lockResponse" class="cms-panel cms-lock-panel">
      <div>
        <h2>当前文章正在编辑</h2>
        <p>
          {{ lockResponse.lock.holder.memberName || `@${lockResponse.lock.holder.account}` }}
          正在编辑，锁将在
          {{ new Date(lockResponse.lock.expiresAt).toLocaleTimeString('zh-CN') }}
          前保持有效。
        </p>
      </div>
      <div v-if="isAdmin" class="cms-lock-takeover">
        <input v-model="takeoverReason" maxlength="500" placeholder="接管原因（可选）">
        <div class="cms-editor-actions">
          <button class="cms-button cms-button-quiet" type="button" @click="acquireLock()">
            重新尝试获取
          </button>
          <button class="cms-button cms-button-primary" type="button" @click="acquireLock(true)">
            管理员强制接管
          </button>
        </div>
      </div>
      <button v-else class="cms-button cms-button-quiet" type="button" @click="acquireLock()">
        重新尝试获取
      </button>
    </section>

    <section v-if="latestRejection && status === 'rejected'" class="cms-panel cms-review-reason">
      <h2>驳回原因</h2>
      <p>{{ latestRejection.reason }}</p>
    </section>

    <section v-if="comparison?.hasVersionConflict" class="cms-panel cms-conflict-panel">
      <h2>正式版本已变化</h2>
      <p>请对照下面的正式内容与草稿手动整理。系统不会自动合并或覆盖任何内容。</p>
      <details>
        <summary>查看正文差异</summary>
        <pre class="cms-diff"><template v-for="(part, index) in comparison.bodyDiff" :key="index"><span :class="`cms-diff-${part.type}`">{{ part.value }}</span></template></pre>
      </details>
      <button
        v-if="canEdit"
        class="cms-button cms-button-primary"
        type="button"
        :disabled="workflowBusy"
        @click="confirmResync"
      >
        我已手动整理，使用当前正式版本作为新基线
      </button>
    </section>

    <div class="cms-draft-layout" :class="{ 'cms-editor-readonly': !canEdit }">
      <aside class="cms-panel cms-draft-fields">
        <h2>Frontmatter</h2>
        <label>
          <span>title</span>
          <input v-model="title" required maxlength="200" :disabled="!canEdit">
        </label>
        <label>
          <span>description</span>
          <textarea v-model="description" maxlength="2000" rows="5" :disabled="!canEdit" placeholder="留空时将在正式发布阶段自动生成" />
        </label>
        <label>
          <span>authors</span>
          <select v-model="authorKeys" multiple size="9" :disabled="!canEdit">
            <option v-for="member in memberData?.members ?? []" :key="member.memberKey" :value="member.memberKey">
              {{ member.name }} · {{ member.memberKey }}
            </option>
          </select>
          <small>按 Ctrl / Command 可多选；文章最终只保存成员稳定 ID。</small>
        </label>

        <h3>系统维护字段（只读）</h3>
        <dl class="cms-system-fields">
          <template v-for="key in ['contributors', 'updatedAt', 'publishedAt']" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ JSON.stringify(initial.systemFrontmatter[key as keyof typeof initial.systemFrontmatter]) }}</dd>
          </template>
        </dl>

        <details>
          <summary>其他保留 Frontmatter</summary>
          <pre>{{ JSON.stringify(initial.preservedFrontmatter, null, 2) }}</pre>
        </details>
        <p v-if="baseContentHash" class="cms-muted cms-base-version">
          基线 SHA-256<br><code>{{ baseContentHash }}</code>
        </p>
      </aside>

      <main class="cms-editor-workspace">
        <div class="cms-editor-tabs" role="tablist" aria-label="编辑模式">
          <button type="button" :class="{ active: mode === 'visual' }" @click="switchMode('visual')">
            可视化编辑
          </button>
          <button type="button" :class="{ active: mode === 'source' }" @click="switchMode('source')">
            Markdown 源码
          </button>
        </div>

        <div v-if="mode === 'visual'" class="cms-visual-editor" :inert="!canEdit">
          <p v-if="visualChecking" class="cms-editor-checking">正在执行无损往返检查…</p>
          <ClientOnly>
            <CmsMarkdownVisualEditor
              :key="visualKey"
              v-model="body"
              @ready="handleVisualReady"
              @error="handleVisualError"
            />
            <template #fallback>
              <p class="cms-editor-checking">正在加载可视化编辑器…</p>
            </template>
          </ClientOnly>
        </div>
        <textarea
          v-else
          v-model="body"
          class="cms-markdown-source"
          spellcheck="false"
          aria-label="Markdown 源码"
          :readonly="!canEdit"
        />
      </main>
    </div>

    <footer class="cms-draft-scope-note">
      审核通过只改变 PostgreSQL 状态；阶段 4 不写 Markdown、不发布，也不执行 Git 操作。
    </footer>
  </section>
</template>
