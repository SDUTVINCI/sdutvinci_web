<script setup lang="ts">
import type {
  CmsArticleHistoryEntry,
  CmsArticleVersion,
  CmsArticleVersionDiff,
  CmsPublishResult
} from '../../../../../shared/types/cms-publishing'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { session, csrfHeaders } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const { data, status, error, refresh } = await useAsyncData(`cms:article:${id}:history`, () =>
  requestFetch<{ history: CmsArticleHistoryEntry[] }>(`/api/cms/articles/${id}/history`)
)
const history = computed(() => data.value?.history || [])
const authority = computed(() => history.value[0]?.authority || 'legacy_git')
const selected = ref<CmsArticleVersion | null>(null)
const comparison = ref<CmsArticleVersionDiff | null>(null)
const fromCommit = ref('')
const toCommit = ref('')
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')

watchEffect(() => {
  if (!toCommit.value && history.value[0]) toCommit.value = history.value[0].commitHash
  if (!fromCommit.value && history.value[1]) fromCommit.value = history.value[1].commitHash
})

useHead({ title: '版本历史 · Vinci 内容管理后台' })

const viewVersion = async (commit: string) => {
  busy.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ version: CmsArticleVersion }>(
      `/api/cms/articles/${id}/versions/${commit}`
    )
    selected.value = response.version
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '读取历史版本失败'
  } finally {
    busy.value = false
  }
}

const compareVersions = async () => {
  if (!fromCommit.value || !toCommit.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ diff: CmsArticleVersionDiff }>(
      `/api/cms/articles/${id}/diff`,
      { query: { from: fromCommit.value, to: toCommit.value } }
    )
    comparison.value = response.diff
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '比较版本失败'
  } finally {
    busy.value = false
  }
}

const restoreVersion = async (commit: string) => {
  const confirmation = authority.value === 'database'
    ? '恢复会复制所选内容并创建一个新的数据库 Revision，已有 Revision 不会覆盖。是否继续？'
    : '恢复会创建并推送一个新提交，历史提交不会删除。是否继续？'
  if (!isAdmin.value || !confirm(confirmation)) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    const response = await $fetch<{ result: CmsPublishResult }>(
      `/api/cms/articles/${id}/versions/${commit}/restore`,
      { method: 'POST', headers: csrfHeaders() }
    )
    message.value = response.result.revisionId
      ? `恢复成功，已生成 Revision #${response.result.revisionNumber}，等待导出。`
      : `恢复成功，新提交为 ${response.result.commitHash?.slice(0, 12)}。`
    selected.value = null
    comparison.value = null
    await refresh()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '恢复失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" :to="`/cms/articles/${id}`">← 返回文章</NuxtLink>
      <p class="cms-eyebrow">{{ authority === 'database' ? 'DATABASE REVISIONS' : 'GIT HISTORY' }}</p>
      <h1>版本历史</h1>
      <p>
        查看、比较历史内容；管理员恢复旧版时会生成新的
        {{ authority === 'database' ? 'Revision' : 'Git 提交' }}。
      </p>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <p v-if="status === 'pending'" class="cms-muted">正在读取正式历史…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '正式历史读取失败' }}</p>

    <section class="cms-panel">
      <h2>版本比较</h2>
      <div class="cms-inline-form cms-history-compare">
        <label>
          <span>起始版本</span>
          <select v-model="fromCommit">
            <option v-for="entry in history" :key="entry.commitHash" :value="entry.commitHash">
              {{ entry.shortHash }} · {{ entry.subject }}
            </option>
          </select>
        </label>
        <label>
          <span>目标版本</span>
          <select v-model="toCommit">
            <option v-for="entry in history" :key="entry.commitHash" :value="entry.commitHash">
              {{ entry.shortHash }} · {{ entry.subject }}
            </option>
          </select>
        </label>
        <button class="cms-button cms-button-quiet" type="button" :disabled="busy" @click="compareVersions">
          比较
        </button>
      </div>
      <pre v-if="comparison" class="cms-diff"><template v-for="(part, index) in comparison.parts" :key="index"><span :class="`cms-diff-${part.type}`">{{ part.value }}</span></template></pre>
    </section>

    <div class="cms-detail-grid">
      <section class="cms-panel">
        <h2>{{ authority === 'database' ? 'Revision 记录' : '提交记录' }}</h2>
        <ol class="cms-history-list">
          <li v-for="entry in history" :key="entry.commitHash">
            <div>
              <strong>{{ entry.subject }}</strong>
              <p><code>{{ entry.shortHash }}</code> · {{ entry.authorName }} · {{ new Date(entry.authoredAt).toLocaleString('zh-CN') }}</p>
            </div>
            <div class="cms-header-buttons">
              <button class="cms-button cms-button-quiet" type="button" :disabled="busy" @click="viewVersion(entry.commitHash)">
                查看内容
              </button>
              <button
                v-if="isAdmin"
                class="cms-button cms-button-quiet"
                type="button"
                :disabled="busy || entry.commitHash === history[0]?.commitHash"
                @click="restoreVersion(entry.commitHash)"
              >
                恢复此版本
              </button>
            </div>
          </li>
        </ol>
        <p v-if="!history.length" class="cms-muted">此文章尚无正式历史记录。</p>
      </section>
      <aside class="cms-panel">
        <h2>历史 Markdown</h2>
        <p v-if="selected"><code>{{ selected.commitHash }}</code></p>
        <pre v-if="selected" class="cms-source">{{ selected.source }}</pre>
        <p v-else class="cms-muted">选择一个版本查看完整 Markdown。</p>
      </aside>
    </div>
  </section>
</template>
