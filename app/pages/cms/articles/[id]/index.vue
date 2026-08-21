<script setup lang="ts">
import type { CmsArticleDetail } from '~~/shared/types/cms-articles'
import type { PublicArticleCreditIdentity } from '~~/shared/types/article-credit-identities'
import { cmsAccountPattern } from '~~/shared/types/cms-auth'
import { resolveArticleCredits } from '~~/shared/utils/article-credits'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

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

const { data, error, refresh } = await useAsyncData(`cms:article:${id}`, () =>
  requestFetch<{ article: CmsArticleDetail }>(`/api/cms/articles/${id}`)
)
const article = computed(() => data.value?.article)
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)

const frontmatterLabels: Record<string, string> = {
  title: '文章标题',
  description: '内容摘要',
  authors: '作者',
  contributors: '协作者',
  tags: '组别标签',
  publishedAt: '首次发布日期',
  updatedAt: '最近更新时间',
  date: '日期',
  order: '排序',
  vinciId: '稳定内容 ID'
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}

const frontmatterEntries = computed(() => Object.entries(article.value?.frontmatter || {}).map(
  ([key, value]) => {
    const label = frontmatterLabels[key] || key
    if (Array.isArray(value)) {
      return {
        key,
        label,
        type: 'chips' as const,
        chips: value.map(item => typeof item === 'string' ? item : JSON.stringify(item)),
        display: ''
      }
    }
    if (value !== null && typeof value === 'object') {
      return {
        key,
        label,
        type: 'json' as const,
        chips: [] as string[],
        display: JSON.stringify(value, null, 2)
      }
    }
    const scalar = value === null || value === undefined || value === '' ? '未填写' : String(value)
    return {
      key,
      label,
      type: 'text' as const,
      chips: [] as string[],
      display: /(At|Date)$/i.test(key) && scalar !== '未填写' ? formatDateTime(scalar) : scalar
    }
  }
))

const exportStatusCopy = computed(() => ({
  waiting_export: {
    label: '等待导出',
    description: '数据库正式内容已生效，正在等待同步到内容仓库。',
    tone: 'waiting'
  },
  synchronized: {
    label: '已同步',
    description: '数据库与最近导出的内容仓库版本一致。',
    tone: 'success'
  },
  export_behind: {
    label: '等待追平',
    description: '数据库版本领先最近导出的内容仓库版本。',
    tone: 'waiting'
  },
  export_failed: {
    label: '导出失败',
    description: '最近一次导出失败，数据库正式内容不受影响。',
    tone: 'error'
  },
  untracked: {
    label: '尚未对账',
    description: '当前还没有可用于核对的内容仓库导出版本。',
    tone: 'neutral'
  },
  not_applicable: {
    label: '旧式 Git 模式',
    description: '此记录使用 legacy_git 回滚模式，不适用数据库导出状态。',
    tone: 'neutral'
  }
})[article.value?.exportStatus.state || 'untracked'])

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode || 500,
    statusMessage: error.value.statusMessage || error.value.message || '文章加载失败'
  })
}

if (!article.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在' })
}

const articleCreditKeys = computed(() => [...new Set(
  ['authors', 'contributors'].flatMap((field) => {
    const value = article.value?.frontmatter[field]
    return Array.isArray(value)
      ? value.filter((item): item is string =>
          typeof item === 'string' && cmsAccountPattern.test(item.trim())
        )
      : []
  })
)])
const { data: articleCreditIdentities } = await useAsyncData(
  `cms:article:${id}:credit-identities`,
  async () => articleCreditKeys.value.length
    ? (await requestFetch<{ items: PublicArticleCreditIdentity[] }>('/api/v2/content/article-credits', {
        query: { keys: articleCreditKeys.value.join(',') }
      })).items
    : [],
  { watch: [articleCreditKeys], default: () => [] }
)
const resolvedArticleCredits = computed(() => resolveArticleCredits(
  article.value?.frontmatter.authors,
  article.value?.frontmatter.contributors,
  articleCreditIdentities.value
))
const creditPeopleFor = (key: string) => key === 'authors'
  ? resolvedArticleCredits.value.authors
  : key === 'contributors'
    ? resolvedArticleCredits.value.collaborators
    : []

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
        <VinciMarkdownRenderer
          v-if="!article.isDeleted"
          :variant="article.collection"
          :markdown="article.body"
        />
        <pre v-else class="cms-source">{{ article.body }}</pre>
      </article>
      <aside class="cms-frontmatter cms-article-inspector">
        <header class="cms-article-inspector-heading">
          <span class="cms-article-inspector-icon" aria-hidden="true">i</span>
          <div>
            <p class="cms-eyebrow">ARTICLE RECORD</p>
            <h2>文章信息</h2>
            <p>正式版本的元数据、校验信息与同步状态。</p>
          </div>
        </header>

        <section class="cms-inspector-section">
          <header>
            <div>
              <h3>内容元数据</h3>
              <p>来自当前 Revision 的 Frontmatter</p>
            </div>
            <span class="cms-inspector-count">{{ frontmatterEntries.length }} 项</span>
          </header>
          <dl class="cms-metadata-list">
            <div v-for="entry in frontmatterEntries" :key="entry.key" class="cms-metadata-row">
              <dt>
                {{ entry.label }}
                <code v-if="entry.label !== entry.key">{{ entry.key }}</code>
              </dt>
              <dd v-if="entry.key === 'authors' || entry.key === 'contributors'" class="cms-metadata-people">
                <span v-for="person in creditPeopleFor(entry.key)" :key="person.memberKey" class="cms-metadata-person">
                  <img
                    :src="resolveStaticMediaUrl(person.image || '/images/logo.png')"
                    :alt="`${person.name}的头像`"
                    loading="lazy"
                    decoding="async"
                  >
                  <span>
                    <strong>{{ person.name }}</strong>
                    <code v-if="person.name !== person.memberKey">{{ person.memberKey }}</code>
                  </span>
                </span>
                <em v-if="creditPeopleFor(entry.key).length === 0">未填写</em>
              </dd>
              <dd v-else-if="entry.type === 'chips'" class="cms-metadata-chips">
                <span v-for="(chip, index) in entry.chips" :key="`${entry.key}-${index}`">{{ chip }}</span>
                <em v-if="entry.chips.length === 0">未填写</em>
              </dd>
              <dd v-else-if="entry.type === 'json'"><pre>{{ entry.display }}</pre></dd>
              <dd v-else :class="{ 'is-empty': entry.display === '未填写' }">{{ entry.display }}</dd>
            </div>
          </dl>
          <details class="cms-inspector-raw">
            <summary>查看原始 Frontmatter</summary>
            <pre>{{ JSON.stringify(article.frontmatter, null, 2) }}</pre>
          </details>
        </section>

        <section class="cms-inspector-section">
          <header>
            <div>
              <h3>版本与完整性</h3>
              <p>用于定位数据库正式版本</p>
            </div>
            <span class="cms-integrity-mark" aria-label="内容校验已记录">✓</span>
          </header>
          <dl class="cms-technical-list">
            <div>
              <dt>内容哈希 <code>SHA-256</code></dt>
              <dd><code class="cms-hash">{{ article.contentHash }}</code></dd>
            </div>
            <div v-if="article.currentRevision">
              <dt>当前 Revision</dt>
              <dd>
                <strong>#{{ article.currentRevision.revisionNumber }}</strong>
                <code class="cms-hash">{{ article.currentRevision.id }}</code>
              </dd>
            </div>
          </dl>
        </section>

        <section class="cms-inspector-section cms-export-section">
          <header>
            <div>
              <h3>内容仓库同步</h3>
              <p>数据库始终是正式内容权威来源</p>
            </div>
            <span class="cms-export-status" :class="`is-${exportStatusCopy.tone}`">
              <i aria-hidden="true" />{{ exportStatusCopy.label }}
            </span>
          </header>
          <p class="cms-export-description">{{ exportStatusCopy.description }}</p>
          <dl v-if="article.exportStatus.latestExportedRevisionId || article.exportStatus.latestExportedCommitHash || article.exportStatus.currentJobAttemptCount !== null" class="cms-technical-list cms-export-details">
            <div v-if="article.exportStatus.latestExportedRevisionId">
              <dt>最近导出 Revision</dt>
              <dd><code class="cms-hash">{{ article.exportStatus.latestExportedRevisionId }}</code></dd>
            </div>
            <div v-if="article.exportStatus.latestExportedCommitHash">
              <dt>内容仓库 Commit</dt>
              <dd><code class="cms-hash">{{ article.exportStatus.latestExportedCommitHash }}</code></dd>
            </div>
            <div v-if="article.exportStatus.currentJobAttemptCount !== null">
              <dt>任务重试</dt>
              <dd>
                已尝试 {{ article.exportStatus.currentJobAttemptCount }} 次
                <template v-if="article.exportStatus.currentJobNextAttemptAt">
                  · 下次 {{ formatDateTime(article.exportStatus.currentJobNextAttemptAt) }}
                </template>
              </dd>
            </div>
          </dl>
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
        </section>
      </aside>
    </div>
  </section>
</template>
