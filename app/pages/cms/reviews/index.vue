<script setup lang="ts">
import type { CmsReviewSummary } from '../../../../shared/types/cms-reviews'
import type { CmsBatchActionResult } from '../../../../shared/types/cms-drafts'

const BATCH_APPROVE_CONFIRMATION = 'BATCH_APPROVE_DRAFTS'
const BATCH_PUBLISH_CONFIRMATION = 'BATCH_PUBLISH_DRAFTS'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '待审核内容 · Vinci 内容管理后台' })
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const { data, status, error, refresh } = await useAsyncData(
  'cms:reviews',
  async () => {
    const [articleReviews, memberReviews] = await Promise.all([
      requestFetch<{ reviews: CmsReviewSummary[], approved: CmsReviewSummary[] }>('/api/cms/reviews'),
      requestFetch<{ applications: any[] }>('/api/cms/member-applications')
    ])
    return {
      reviews: articleReviews.reviews,
      approved: articleReviews.approved || [],
      applications: memberReviews.applications
    }
  }
)
const note = ref('')
const message = ref('')
const errorMessage = ref('')
const selectedPendingIds = ref<string[]>([])
const selectedApprovedIds = ref<string[]>([])
const batchBusy = ref(false)

const toggleAll = (kind: 'pending' | 'approved') => {
  const source = kind === 'pending' ? data.value?.reviews || [] : data.value?.approved || []
  const selected = kind === 'pending' ? selectedPendingIds : selectedApprovedIds
  selected.value = selected.value.length === source.length ? [] : source.map(item => item.id)
}

const runBatch = async (action: 'approve' | 'publish') => {
  const source = action === 'approve' ? data.value?.reviews || [] : data.value?.approved || []
  const selected = action === 'approve' ? selectedPendingIds.value : selectedApprovedIds.value
  const items = source.filter(item => selected.includes(item.id)).map(item => ({ id: item.id, version: item.version }))
  if (!items.length) return
  const prompt = action === 'approve'
    ? `确定批量审核通过 ${items.length} 篇草稿吗？系统会逐篇检查版本和正式内容基线。`
    : `确定把 ${items.length} 篇已通过草稿正式发布吗？发布会逐篇创建正式 Revision 和导出任务。`
  if (!window.confirm(prompt)) return
  batchBusy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    const response = await $fetch<{ results: CmsBatchActionResult[] }>(
      `/api/cms/reviews/batch-${action}`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: {
          items,
          confirm: action === 'approve'
            ? BATCH_APPROVE_CONFIRMATION
            : BATCH_PUBLISH_CONFIRMATION
        }
      }
    )
    const succeeded = response.results.filter(item => item.ok).length
    const failures = response.results.filter(item => !item.ok)
    message.value = `${action === 'approve' ? '批量审核' : '批量发布'}完成：成功 ${succeeded} 篇，失败 ${failures.length} 篇。`
    errorMessage.value = failures.length ? failures.map(item => item.message).join('；') : ''
    selectedPendingIds.value = []
    selectedApprovedIds.value = []
    await refresh()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || `${action === 'approve' ? '批量审核' : '批量发布'}失败`
  } finally { batchBusy.value = false }
}
const reviewMember = async (id: string, action: 'approve' | 'reject') => {
  if (!confirm(action === 'approve' ? '审核通过后将立即创建正式成员并上线，确定吗？' : '拒绝后将删除临时头像，确定吗？')) return
  try {
    await $fetch(`/api/cms/member-applications/${id}/review`, {
      method: 'POST', headers: csrfHeaders(), body: { action, note: note.value }
    })
    message.value = action === 'approve' ? '成员申请已审核通过并上线。' : '成员申请已拒绝，临时头像已清理。'
    errorMessage.value = ''
    await refresh()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '成员审核失败'
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">REVIEWS</p>
        <h1>待审核内容</h1>
        <p>统一处理文章草稿和成员信息申请；成员申请通过后会立即创建正式成员并上线。</p>
      </div>
      <button class="cms-button cms-button-quiet" type="button" @click="refresh()">
        刷新
      </button>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <p v-if="status === 'pending'" class="cms-muted">正在加载待审核内容…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">加载失败，请稍后重试。</p>
    <div v-else class="cms-review-workspace">
      <section class="cms-review-lane" data-stage="pending">
        <header class="cms-review-lane-header">
          <div class="cms-review-lane-title">
            <span class="cms-review-lane-index" aria-hidden="true">01</span>
            <div>
              <p class="cms-eyebrow">ARTICLE REVIEW</p>
              <div class="cms-review-lane-heading">
                <h2>待审核文章</h2>
                <span class="cms-review-count">{{ data?.reviews.length ?? 0 }} 项</span>
              </div>
              <p>查看提交内容与正式版本差异，再决定是否通过审核。</p>
            </div>
          </div>
          <div class="cms-review-lane-actions">
            <button class="cms-button cms-button-quiet" type="button" :disabled="!data?.reviews.length || batchBusy" @click="toggleAll('pending')">
              {{ selectedPendingIds.length === data?.reviews.length && data?.reviews.length ? '取消全选待审核' : '全选待审核' }}
            </button>
            <button class="cms-button cms-button-primary" type="button" :disabled="!selectedPendingIds.length || batchBusy" @click="runBatch('approve')">
              {{ batchBusy ? '正在逐篇处理…' : `批量审核通过（${selectedPendingIds.length}）` }}
            </button>
          </div>
        </header>
        <div v-if="data?.reviews.length" class="cms-table-wrap cms-review-table-wrap">
          <table class="cms-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>标题</th>
                <th>提交者</th>
                <th>集合</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="review in data.reviews" :key="review.id">
                <td><input v-model="selectedPendingIds" type="checkbox" :value="review.id" :aria-label="`选择待审核：${review.title}`"></td>
                <td><NuxtLink :to="`/cms/reviews/${review.id}`">{{ review.title }}</NuxtLink></td>
                <td>{{ review.owner.memberName || `@${review.owner.account}` }}</td>
                <td><span class="cms-badge">{{ review.collection }}</span></td>
                <td>{{ new Date(review.submittedAt).toLocaleString('zh-CN') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="cms-review-empty">
          <span aria-hidden="true">✓</span>
          <div><strong>审核队列已清空</strong><p>目前没有待审核的文章草稿。</p></div>
        </div>
      </section>

      <section class="cms-review-lane" data-stage="approved">
        <header class="cms-review-lane-header">
          <div class="cms-review-lane-title">
            <span class="cms-review-lane-index" aria-hidden="true">02</span>
            <div>
              <p class="cms-eyebrow">READY TO PUBLISH</p>
              <div class="cms-review-lane-heading">
                <h2>已通过，等待发布</h2>
                <span class="cms-review-count">{{ data?.approved.length ?? 0 }} 项</span>
              </div>
              <p>审核已完成；正式发布将逐篇创建 Revision 与内容导出任务。</p>
            </div>
          </div>
          <div class="cms-review-lane-actions">
            <button class="cms-button cms-button-quiet" type="button" :disabled="!data?.approved.length || batchBusy" @click="toggleAll('approved')">
              {{ selectedApprovedIds.length === data?.approved.length && data?.approved.length ? '取消全选待发布' : '全选待发布' }}
            </button>
            <button class="cms-button cms-button-primary" type="button" :disabled="!selectedApprovedIds.length || batchBusy" @click="runBatch('publish')">
              {{ batchBusy ? '正在逐篇发布…' : `批量正式发布（${selectedApprovedIds.length}）` }}
            </button>
          </div>
        </header>
        <div v-if="data?.approved.length" class="cms-table-wrap cms-review-table-wrap">
          <table class="cms-table">
            <thead><tr><th>选择</th><th>标题</th><th>提交者</th><th>集合</th><th>最后更新</th></tr></thead>
            <tbody>
              <tr v-for="review in data.approved" :key="review.id">
                <td><input v-model="selectedApprovedIds" type="checkbox" :value="review.id" :aria-label="`选择待发布：${review.title}`"></td>
                <td><NuxtLink :to="`/cms/reviews/${review.id}`">{{ review.title }}</NuxtLink></td>
                <td>{{ review.owner.memberName || `@${review.owner.account}` }}</td>
                <td><span class="cms-badge">{{ review.collection }}</span></td>
                <td>{{ new Date(review.updatedAt).toLocaleString('zh-CN') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="cms-review-empty">
          <span aria-hidden="true">↗</span>
          <div><strong>暂无待发布文章</strong><p>审核通过的草稿会集中显示在这里。</p></div>
        </div>
      </section>

      <section class="cms-review-lane" data-stage="members">
        <header class="cms-review-lane-header">
          <div class="cms-review-lane-title">
            <span class="cms-review-lane-index" aria-hidden="true">03</span>
            <div>
              <p class="cms-eyebrow">MEMBER APPLICATIONS</p>
              <div class="cms-review-lane-heading">
                <h2>成员信息申请</h2>
                <span class="cms-review-count">{{ data?.applications.length ?? 0 }} 项</span>
              </div>
              <p>核对公开资料；通过后会立即创建正式成员并上线。</p>
            </div>
          </div>
        </header>
        <div v-if="data?.applications.length" class="cms-review-member-body">
          <label class="cms-form cms-review-note"><span>本次审核备注</span><textarea v-model="note" rows="3" maxlength="1000" /></label>
          <div class="cms-review-cards">
            <article v-for="item in data.applications" :key="item.id" class="cms-panel cms-member-review-card">
              <img v-if="item.avatarPublicUrl" class="cms-member-avatar" :src="item.avatarPublicUrl" alt="申请头像">
              <div class="cms-member-review-content">
                <h3>{{ item.profile.name }}</h3>
                <dl>
                  <div><dt>年级 / 赛季</dt><dd>{{ item.profile.grade }} 级 · {{ item.profile.seasons?.join('、') }}</dd></div>
                  <div><dt>组别</dt><dd>{{ item.profile.groupName || '无' }}</dd></div>
                  <div><dt>职责</dt><dd>{{ item.profile.positions?.join('、') }}</dd></div>
                  <div><dt>学院</dt><dd>{{ item.profile.affiliation || '未填写' }}</dd></div>
                </dl>
                <p v-if="item.profile.body">{{ item.profile.body }}</p>
                <div class="cms-button-row">
                  <button class="cms-button cms-button-primary" @click="reviewMember(item.id, 'approve')">审核通过并上线</button>
                  <button class="cms-button" @click="reviewMember(item.id, 'reject')">拒绝</button>
                </div>
              </div>
            </article>
          </div>
        </div>
        <div v-else class="cms-review-empty">
          <span aria-hidden="true">◇</span>
          <div><strong>暂无成员申请</strong><p>新的公开申请提交后会显示在这里。</p></div>
        </div>
      </section>
    </div>
  </section>
</template>
