<script setup lang="ts">
import type { CmsDraft } from '../../../../shared/types/cms-drafts'
import type { CmsReviewDetail } from '../../../../shared/types/cms-reviews'
import type { CmsPublishResult } from '../../../../shared/types/cms-publishing'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
const route = useRoute()
const id = String(route.params.id)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const { data, refresh } = await useAsyncData(
  `cms:review:${id}`,
  () => requestFetch<{ review: CmsReviewDetail }>(`/api/cms/reviews/${id}`)
)

if (!data.value?.review) {
  throw createError({ statusCode: 404, statusMessage: '审核内容不存在' })
}

const review = computed(() => data.value!.review)
const rejectReason = ref('')
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const publishPath = ref('')
const publishResult = ref<CmsPublishResult | null>(null)

useHead(() => ({
  title: `${review.value.draft.title} · 内容审核 · Vinci 内容管理后台`
}))

const approve = async () => {
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    const result = await $fetch<{ draft: CmsDraft }>(
      `/api/cms/reviews/${id}/approve`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: { version: review.value.draft.version }
      }
    )
    await refresh()
    message.value = result.draft.status === 'approved'
      ? '审核已通过，可以在右侧确认路径并发布。'
      : '审核状态已更新。'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '审核通过失败'
    await refresh()
  } finally {
    busy.value = false
  }
}

const publish = async () => {
  if (
    !review.value.draft.articleId
    && publishPath.value
    && !publishPath.value.trim().endsWith('.md')
  ) {
    errorMessage.value = '发布路径必须以 .md 结尾。'
    return
  }
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    const response = await $fetch<{ result: CmsPublishResult }>(
      `/api/cms/drafts/${id}/publish`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: {
          version: review.value.draft.version,
          ...(publishPath.value.trim()
            ? { relativePath: publishPath.value.trim() }
            : {})
        }
      }
    )
    publishResult.value = response.result
    message.value = response.result.exportStatus === 'waiting_export'
      ? `数据库发布成功，Revision #${response.result.revisionNumber} 已立即生效；等待导出。`
      : `Git-first 发布成功，提交 ${response.result.commitHash?.slice(0, 12)} 已推送。`
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '发布失败；草稿仍保持已通过，可重试。'
  } finally {
    busy.value = false
  }
}

const reject = async () => {
  if (!rejectReason.value.trim()) {
    errorMessage.value = '请填写驳回原因。'
    return
  }
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/cms/reviews/${id}/reject`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: {
        version: review.value.draft.version,
        reason: rejectReason.value
      }
    })
    await refresh()
    message.value = '已驳回，提交者可以看到原因并继续编辑。'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '驳回失败'
    await refresh()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cms-page cms-review-page">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" to="/cms/reviews">← 返回待审核列表</NuxtLink>
      <p class="cms-eyebrow">REVIEW · {{ review.draft.collection }}</p>
      <h1>{{ review.draft.title }}</h1>
      <p>
        提交者：{{ review.owner.memberName || `@${review.owner.account}` }}
        · 状态：<span class="cms-badge">{{ review.draft.status }}</span>
        · 版本 {{ review.draft.version }}
      </p>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <p v-if="review.comparison.hasVersionConflict" class="cms-alert cms-alert-error">
      当前文章已有更新，请重新同步后再发布。审核通过操作已被禁止。
    </p>

    <div class="cms-review-grid">
      <section class="cms-panel">
        <h2>字段对比</h2>
        <table class="cms-compare-table">
          <thead>
            <tr><th>字段</th><th>正式版本</th><th>待审核草稿</th></tr>
          </thead>
          <tbody>
            <tr>
              <th>title</th>
              <td>{{ review.comparison.formal?.title || '新文章，无正式版本' }}</td>
              <td>{{ review.comparison.draft.title }}</td>
            </tr>
            <tr>
              <th>description</th>
              <td>{{ review.comparison.formal?.description || '—' }}</td>
              <td>{{ review.comparison.draft.description || '—' }}</td>
            </tr>
            <tr>
              <th>authors</th>
              <td>{{ review.comparison.formal?.authorKeys.join(', ') || '—' }}</td>
              <td>{{ review.comparison.draft.authorKeys.join(', ') || '—' }}</td>
            </tr>
            <tr v-if="review.draft.wikiContentType === 'document'">
              <th>tags</th>
              <td>{{ review.comparison.formal?.wikiTags.join('、') || '新主文档，无正式版本' }}</td>
              <td>{{ review.comparison.draft.wikiTags.join('、') || '未分类' }}</td>
            </tr>
          </tbody>
        </table>

        <h2>正文差异</h2>
        <pre class="cms-diff"><template v-for="(part, index) in review.comparison.bodyDiff" :key="index"><span :class="`cms-diff-${part.type}`">{{ part.value }}</span></template></pre>
      </section>

      <aside class="cms-review-sidebar">
        <section v-if="review.draft.status === 'pending_review'" class="cms-panel cms-review-actions">
          <h2>审核决定</h2>
          <button
            class="cms-button cms-button-primary"
            type="button"
            :disabled="busy || review.comparison.hasVersionConflict"
            @click="approve"
          >
            审核通过
          </button>
          <label>
            <span>驳回原因</span>
            <textarea v-model="rejectReason" rows="5" maxlength="2000" placeholder="必填；提交者将看到此原因" />
          </label>
          <button class="cms-button cms-button-quiet" type="button" :disabled="busy" @click="reject">
            驳回
          </button>
        </section>

        <section
          v-if="review.draft.status === 'approved' && !publishResult"
          class="cms-panel cms-review-actions"
        >
          <h2>正式发布</h2>
          <p class="cms-muted">
            DB-first 会在单个事务写入 Revision、草稿、审计和 Outbox；显式 legacy_git 回滚模式沿用原 Git-first 发布。
          </p>
          <p v-if="!review.draft.articleId && review.draft.plannedRelativePath" class="cms-muted">
            已关联保存位置：<code>{{ review.draft.collection }}/{{ review.draft.plannedRelativePath }}</code>
          </p>
          <label v-else-if="!review.draft.articleId">
            <span>新文章相对路径（可留空自动生成）</span>
            <input
              v-model="publishPath"
              type="text"
              maxlength="500"
              placeholder="例如：2026-07-25-news-title.md"
            >
          </label>
          <p v-else class="cms-muted">现有文章沿用原路径，不允许在发布时移动。</p>
          <button
            class="cms-button cms-button-primary"
            type="button"
            :disabled="busy"
            @click="publish"
          >
            {{ busy ? '正在发布…' : '确认正式发布' }}
          </button>
        </section>

        <section v-if="publishResult" class="cms-panel">
          <h2>发布完成</h2>
          <p><code>{{ publishResult.collection }}/{{ publishResult.relativePath }}</code></p>
          <p v-if="publishResult.revisionId">
            当前 Revision #{{ publishResult.revisionNumber }} · <code>{{ publishResult.revisionId }}</code>
          </p>
          <p v-if="publishResult.commitHash"><code>{{ publishResult.commitHash }}</code></p>
          <p v-if="publishResult.exportStatus === 'waiting_export'" class="cms-alert">
            等待导出：数据库发布已成功，阶段 6 Worker 尚未实现。
          </p>
          <NuxtLink
            class="cms-button cms-button-link cms-button-quiet"
            :to="`/cms/articles/${publishResult.articleId}/history`"
          >
            查看版本历史
          </NuxtLink>
        </section>

        <section class="cms-panel cms-review-history">
          <h2>审核记录</h2>
          <ol>
            <li v-for="event in review.events" :key="event.id">
              <strong>{{ event.action }}</strong>
              <span>{{ event.actor.memberName || (event.actor.account ? `@${event.actor.account}` : '已删除用户') }}</span>
              <time>{{ new Date(event.createdAt).toLocaleString('zh-CN') }}</time>
              <p v-if="event.reason">{{ event.reason }}</p>
            </li>
          </ol>
        </section>
      </aside>
    </div>

    <footer class="cms-draft-scope-note">
      DB-first 不访问 GitHub 或代码仓库 Markdown；显式 legacy_git 回滚模式才使用原 Git-first 路径。
    </footer>
  </section>
</template>
