<script setup lang="ts">
import type { CmsDraft } from '../../../../shared/types/cms-drafts'
import type { CmsReviewDetail } from '../../../../shared/types/cms-reviews'

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
      ? '审核已通过。正式发布与 Git 写入将在阶段 5 实现。'
      : '审核状态已更新。'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '审核通过失败'
    await refresh()
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
      本页没有正式发布按钮；阶段 4 审核通过不会写入 Markdown 或执行 Git 操作。
    </footer>
  </section>
</template>
