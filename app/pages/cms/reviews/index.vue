<script setup lang="ts">
import type { CmsReviewSummary } from '../../../../shared/types/cms-reviews'
import type { CmsBatchActionResult } from '../../../../shared/types/cms-drafts'
import type { CmsAccountRegistrationApplication } from '../../../../shared/types/account-registration'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

interface MemberProposalReview {
  id: string
  memberId: string
  action: 'update' | 'delete'
  fieldChanges: Record<string, { from: unknown, to: unknown }>
  createdAt: string
  needsMerge: boolean
  member: { name: string, memberKey: string, avatarUrl: string | null, version: number, deleted: boolean }
}

const BATCH_APPROVE_CONFIRMATION = 'BATCH_APPROVE_DRAFTS'
const BATCH_PUBLISH_CONFIRMATION = 'BATCH_PUBLISH_DRAFTS'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '审核中心 · Vinci 内容管理后台' })
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const { data, status, error, refresh } = await useAsyncData(
  'cms:reviews',
  async () => {
    const [articleReviews, memberReviews, memberProposals] = await Promise.all([
      requestFetch<{ reviews: CmsReviewSummary[], approved: CmsReviewSummary[] }>('/api/cms/reviews'),
      requestFetch<{ applications: any[] }>('/api/cms/member-applications'),
      requestFetch<{ proposals: MemberProposalReview[] }>('/api/cms/member-proposals')
    ])
    return {
      reviews: articleReviews.reviews,
      approved: articleReviews.approved || [],
      applications: memberReviews.applications,
      proposals: memberProposals.proposals
    }
  }
)
const {
  data: registrationData,
  status: registrationStatus,
  error: registrationLoadError,
  refresh: refreshRegistrations
} = await useAsyncData('cms:account-registration-applications', () =>
  requestFetch<{ applications: CmsAccountRegistrationApplication[] }>(
    '/api/cms/account-registration-applications'
  )
)
const registrationApplications = computed(() => registrationData.value?.applications ?? [])
const registrationNote = ref('')
const registrationReviewingId = ref('')
const registrationMessage = ref('')
const registrationError = ref('')
const refreshAll = async () => {
  await Promise.all([refresh(), refreshRegistrations()])
}
const note = ref('')
const message = ref('')
const errorMessage = ref('')
const selectedPendingIds = ref<string[]>([])
const selectedApprovedIds = ref<string[]>([])
const batchBusy = ref(false)
const proposalReviewingId = ref('')
const memberChangeLabels: Record<string, string> = {
  name: '姓名', image: '头像', role: '显示职务', type: '成员类型', group: '组别',
  positions: '身份与职务', time: '参加过的赛季', advisor: '指导届次', grade: '年级',
  affiliation: '学院 / 单位', links: '公开链接', body: '简介', metadata: '扩展字段', sortOrder: '排序号'
}
const changeValue = (value: unknown) => value === null || value === undefined || value === ''
  ? '未填写'
  : Array.isArray(value) ? value.join('、') || '未填写'
    : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)

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

const reviewProposal = async (proposal: MemberProposalReview, action: 'approve' | 'reject') => {
  const label = proposal.action === 'delete' ? '删除成员档案' : '修改成员资料'
  if (!confirm(action === 'approve'
    ? `确定通过 ${proposal.member.name} 的“${label}”提案吗？系统会检查并合并当前版本。`
    : `确定拒绝 ${proposal.member.name} 的“${label}”提案吗？`)) return
  proposalReviewingId.value = proposal.id
  message.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/cms/member-proposals/${proposal.id}/${action === 'approve' ? 'apply' : 'reject'}`, {
      method: 'POST', headers: csrfHeaders(),
      body: action === 'approve'
        ? { expectedVersion: proposal.member.version, confirmation: 'APPLY_MEMBER_PROPOSAL' }
        : { note: note.value }
    })
    message.value = action === 'approve' ? `${proposal.member.name} 的成员提案已通过。` : `${proposal.member.name} 的成员提案已拒绝。`
    await refresh()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '成员提案审核失败'
  } finally {
    proposalReviewingId.value = ''
  }
}

const reviewRegistration = async (
  application: CmsAccountRegistrationApplication,
  action: 'approve' | 'reject'
) => {
  const prompt = action === 'approve'
    ? `确定通过 ${application.member.name} 的账号 @${application.account} 注册申请吗？通过后将创建普通成员账号。`
    : `确定拒绝 ${application.member.name} 的注册申请吗？申请中的密码哈希会被清除。`
  if (!confirm(prompt)) return
  registrationReviewingId.value = application.id
  registrationMessage.value = ''
  registrationError.value = ''
  try {
    const result = await $fetch<{ account?: string }>(
      `/api/cms/account-registration-applications/${application.id}/review`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: { action, note: registrationNote.value }
      }
    )
    registrationMessage.value = action === 'approve'
      ? `账号 @${result.account || application.account} 已审核通过，身份为普通成员。`
      : `${application.member.name} 的注册申请已拒绝。`
    await refreshRegistrations()
  } catch (error: any) {
    registrationError.value = error?.data?.message
      ?? error?.data?.statusMessage
      ?? '注册申请审核失败'
  } finally {
    registrationReviewingId.value = ''
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">REVIEWS</p>
        <h1>审核中心</h1>
        <p>统一处理文章草稿、成员信息与账号注册申请。</p>
      </div>
      <button class="cms-button cms-button-quiet" type="button" @click="refreshAll()">
        刷新
      </button>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <p v-if="status === 'pending'" class="cms-muted">正在加载待审核内容…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">加载失败，请稍后重试。</p>
    <div class="cms-review-workspace">
      <section v-if="status !== 'pending' && !error" class="cms-review-lane" data-stage="pending">
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

      <section v-if="status !== 'pending' && !error" class="cms-review-lane" data-stage="approved">
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

      <section v-if="status !== 'pending' && !error" class="cms-review-lane" data-stage="members">
        <header class="cms-review-lane-header">
          <div class="cms-review-lane-title">
            <span class="cms-review-lane-index" aria-hidden="true">03</span>
            <div>
              <p class="cms-eyebrow">MEMBER APPLICATIONS</p>
              <div class="cms-review-lane-heading">
                <h2>成员信息申请</h2>
                <span class="cms-review-count">{{ (data?.applications.length ?? 0) + (data?.proposals.length ?? 0) }} 项</span>
              </div>
              <p>统一审核新成员资料登记、已有成员资料修改与删除提案。</p>
            </div>
          </div>
        </header>
        <div v-if="data?.applications.length || data?.proposals.length" class="cms-review-member-body">
          <label class="cms-form cms-review-note"><span>本次审核备注</span><textarea v-model="note" rows="3" maxlength="1000" /></label>
          <div class="cms-review-cards">
            <article v-for="item in data.applications" :key="item.id" class="cms-panel cms-member-review-card">
              <img v-if="item.avatarPublicUrl" class="cms-member-avatar" :src="item.avatarPublicUrl" alt="申请头像">
              <div class="cms-member-review-content">
                <span class="cms-badge">新成员资料登记</span>
                <h3>{{ item.profile.name }}</h3>
                <dl>
                  <div><dt>年级 / 赛季</dt><dd>{{ item.profile.grade ? `${item.profile.grade} 级` : '无年级' }} · {{ item.profile.seasons?.join('、') || '无参与赛季' }}</dd></div>
                  <div><dt>组别</dt><dd>{{ item.profile.groupName || '无' }}</dd></div>
                  <div><dt>身份与职务</dt><dd>{{ item.profile.positions?.join('、') }}</dd></div>
                  <div><dt>指导届次</dt><dd>{{ item.profile.advisorSeasons?.join('、') || '无' }}</dd></div>
                  <div><dt>学院</dt><dd>{{ item.profile.affiliation || '未填写' }}</dd></div>
                </dl>
                <p v-if="item.profile.body">{{ item.profile.body }}</p>
                <div class="cms-button-row">
                  <button class="cms-button cms-button-primary" @click="reviewMember(item.id, 'approve')">审核通过并上线</button>
                  <button class="cms-button" @click="reviewMember(item.id, 'reject')">拒绝</button>
                </div>
              </div>
            </article>
            <article v-for="proposal in data.proposals" :key="proposal.id" class="cms-panel cms-member-review-card">
              <img class="cms-member-avatar" :src="resolveStaticMediaUrl(proposal.member.avatarUrl || '/images/logo.png')" alt="成员头像" loading="lazy">
              <div class="cms-member-review-content">
                <span class="cms-badge">{{ proposal.action === 'delete' ? '删除成员档案提案' : '成员资料修改提案' }}</span>
                <h3>{{ proposal.member.name }}</h3>
                <p>成员 ID：{{ proposal.member.memberKey }} · 提交于 {{ new Date(proposal.createdAt).toLocaleString('zh-CN') }}</p>
                <p v-if="proposal.needsMerge" class="cms-muted">提交后成员资料有更新；通过时会检查并合并不同字段，如有冲突会提示重新提交。</p>
                <p v-if="proposal.member.deleted" class="cms-alert cms-alert-error">该成员档案已删除，无法通过此提案。</p>
                <details v-if="proposal.action === 'update'" class="cms-member-proposal-changes">
                  <summary>查看修改内容：{{ Object.keys(proposal.fieldChanges).map(field => memberChangeLabels[field] || field).join('、') || '无字段变化' }}</summary>
                  <dl>
                    <div v-for="(change, field) in proposal.fieldChanges" :key="field">
                      <dt>{{ memberChangeLabels[String(field)] || field }}</dt>
                      <dd><span>原值：</span><pre>{{ changeValue(change.from) }}</pre><span>提议：</span><pre>{{ changeValue(change.to) }}</pre></dd>
                    </div>
                  </dl>
                </details>
                <p v-else>通过后将软删除此成员档案，保留历史版本。</p>
                <div class="cms-button-row">
                  <NuxtLink class="cms-button" :to="`/cms/members/${proposal.memberId}`">查看当前档案</NuxtLink>
                  <button class="cms-button cms-button-primary" type="button" :disabled="!!proposalReviewingId || proposal.member.deleted" @click="reviewProposal(proposal, 'approve')">{{ proposalReviewingId === proposal.id ? '处理中…' : '审核通过' }}</button>
                  <button class="cms-button" type="button" :disabled="!!proposalReviewingId" @click="reviewProposal(proposal, 'reject')">拒绝</button>
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
      <section class="cms-review-lane" data-stage="accounts">
        <header class="cms-review-lane-header">
          <div class="cms-review-lane-title">
            <span class="cms-review-lane-index" aria-hidden="true">04</span>
            <div>
              <p class="cms-eyebrow">ACCOUNT REGISTRATION</p>
              <div class="cms-review-lane-heading">
                <h2>账号注册申请</h2>
                <span class="cms-review-count">{{ registrationApplications.length }} 项</span>
              </div>
              <p>核对成员身份后创建普通成员账号；注册申请不能直接获得管理员权限。</p>
            </div>
          </div>
          <div class="cms-review-lane-actions">
            <button class="cms-button cms-button-quiet" type="button" :disabled="registrationStatus === 'pending'" @click="refreshRegistrations()">刷新申请</button>
          </div>
        </header>
        <div v-if="registrationMessage || registrationError" class="cms-review-account-feedback">
          <p v-if="registrationMessage" class="cms-alert" role="status">{{ registrationMessage }}</p>
          <p v-if="registrationError" class="cms-alert cms-alert-error" role="alert">{{ registrationError }}</p>
        </div>
        <div v-if="registrationApplications.length && !registrationLoadError" class="cms-review-member-body">
          <label class="cms-form cms-registration-review-note">
            <span>本次审核备注</span>
            <textarea v-model="registrationNote" rows="2" maxlength="1000" placeholder="可选，不会显示密码等敏感信息" />
          </label>
          <div class="cms-registration-review-list">
            <article v-for="application in registrationApplications" :key="application.id" class="cms-panel cms-registration-review-card">
              <img :src="resolveStaticMediaUrl(application.member.avatarUrl || '/images/logo.png')" alt="" loading="lazy">
              <div>
                <h3>{{ application.member.name }}</h3>
                <p>@{{ application.account }} · 成员 ID：{{ application.member.memberKey }}</p>
                <small>提交于 {{ new Date(application.submittedAt).toLocaleString('zh-CN') }}</small>
              </div>
              <div class="cms-button-row">
                <button class="cms-button cms-button-primary" type="button" :disabled="!!registrationReviewingId || registrationStatus === 'pending'" @click="reviewRegistration(application, 'approve')">通过并创建普通成员账号</button>
                <button class="cms-button" type="button" :disabled="!!registrationReviewingId || registrationStatus === 'pending'" @click="reviewRegistration(application, 'reject')">拒绝</button>
              </div>
            </article>
          </div>
        </div>
        <div v-else-if="registrationStatus === 'pending'" class="cms-review-empty">正在加载注册申请…</div>
        <div v-else-if="registrationLoadError" class="cms-review-empty cms-alert-error" role="alert">注册申请加载失败，请稍后重试。</div>
        <div v-else class="cms-review-empty">
          <span aria-hidden="true">✓</span>
          <div><strong>暂无账号注册申请</strong><p>成员从登录页提交申请后会显示在这里。</p></div>
        </div>
      </section>
    </div>
  </section>
</template>
