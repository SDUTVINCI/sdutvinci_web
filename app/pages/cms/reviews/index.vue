<script setup lang="ts">
import type { CmsReviewSummary } from '../../../../shared/types/cms-reviews'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '待审核内容 · Vinci 内容管理后台' })
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const { data, status, error, refresh } = await useAsyncData(
  'cms:reviews',
  async () => {
    const [articleReviews, memberReviews] = await Promise.all([
      requestFetch<{ reviews: CmsReviewSummary[] }>('/api/cms/reviews'),
      requestFetch<{ applications: any[] }>('/api/cms/member-applications')
    ])
    return { reviews: articleReviews.reviews, applications: memberReviews.applications }
  }
)
const note = ref('')
const message = ref('')
const errorMessage = ref('')
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
    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>提交者</th>
            <th>集合</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="review in data?.reviews ?? []" :key="review.id">
            <td><NuxtLink :to="`/cms/reviews/${review.id}`">{{ review.title }}</NuxtLink></td>
            <td>{{ review.owner.memberName || `@${review.owner.account}` }}</td>
            <td><span class="cms-badge">{{ review.collection }}</span></td>
            <td>{{ new Date(review.submittedAt).toLocaleString('zh-CN') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.reviews.length" class="cms-empty">目前没有待审核内容。</p>
    </div>

    <section v-if="status !== 'pending' && !error" class="cms-review-section">
      <header class="cms-section-heading">
        <div><p class="cms-eyebrow">MEMBER APPLICATIONS</p><h2>成员信息申请</h2></div>
      </header>
      <label v-if="data?.applications.length" class="cms-form"><span>审核备注</span><textarea v-model="note" rows="3" maxlength="1000" /></label>
      <div class="cms-review-cards">
        <article v-for="item in data?.applications ?? []" :key="item.id" class="cms-panel cms-member-review-card">
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
      <p v-if="!data?.applications.length" class="cms-empty">目前没有待审核的成员信息申请。</p>
    </section>
  </section>
</template>
