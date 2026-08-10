<script setup lang="ts">
import type { CmsMember } from '../../../../shared/types/cms-members'
import type { CmsManagedUser } from '../../../../shared/types/cms-auth'
import type { MemberProfileFormModel } from '../../../../shared/types/member-profile-form'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const { session, csrfHeaders, loadSession } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, refresh } = await useAsyncData(`cms:member:${id}`, () =>
  requestFetch<{ member: CmsMember }>(`/api/cms/members/${id}`)
)
const member = computed(() => data.value?.member)
const { data: memberOptions } = await useFetch<any>('/api/member-options')
const { data: auxiliary, refresh: refreshAuxiliary } = await useAsyncData(`cms:member:${id}:auxiliary`, async () => {
  const [revisions, proposals, users] = await Promise.all([
    requestFetch<{ revisions: Array<{ id: string, revisionNumber: number, sourceKind: string, contentHash: string, createdAt: string }> }>(`/api/cms/members/${id}/revisions`),
    requestFetch<{ proposals: Array<{ id: string, action: string, status: string, fieldChanges: Record<string, unknown>, createdAt: string }> }>(`/api/cms/members/${id}/proposals`),
    isAdmin.value ? requestFetch<{ users: CmsManagedUser[] }>('/api/cms/admin/users') : Promise.resolve({ users: [] })
  ])
  return { revisions: revisions.revisions, proposals: proposals.proposals, users: users.users }
})
const knownLinks = new Set(['github', 'home-page', 'homepage'])
const initialLinks = member.value?.links || {}
const form = reactive<MemberProfileFormModel & {
  avatarUrl: string, metadata: string, otherLinks: string, sortOrder: number, linkedUserId: string
}>({
  name: member.value?.name || '', avatarUrl: member.value?.avatarUrl ? resolveStaticMediaUrl(member.value.avatarUrl) : '',
  groupName: member.value?.groupName || '', positions: [...(member.value?.positions || [])],
  seasons: [...(member.value?.seasons || [])], advisorSeasons: [...(member.value?.advisorSeasons || [])],
  grade: member.value?.grade || '', affiliation: member.value?.affiliation || '',
  links: { github: initialLinks.github || '', 'home-page': initialLinks['home-page'] || initialLinks.homepage || '' },
  otherLinks: JSON.stringify(Object.fromEntries(Object.entries(initialLinks).filter(([key]) => !knownLinks.has(key))), null, 2),
  metadata: JSON.stringify(member.value?.metadata || {}, null, 2),
  body: member.value?.body || '', sortOrder: member.value?.sortOrder || 0,
  linkedUserId: member.value?.linkedUserId || ''
})
const submitting = ref(false)
const message = ref('')
const errorMessage = ref('')

useHead(() => ({ title: `${member.value?.name || '成员'} · Vinci 内容管理后台` }))

const save = async () => {
  submitting.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    await $fetch(`/api/cms/members/${id}`, {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: {
        name: form.name, avatarUrl: form.avatarUrl || null,
        groupName: form.groupName || null, positions: form.positions,
        seasons: form.seasons,
        advisorSeasons: form.advisorSeasons,
        grade: form.grade || null, affiliation: form.affiliation || null,
        links: { ...JSON.parse(form.otherLinks || '{}'), github: form.links.github || null, 'home-page': form.links['home-page'] || null },
        body: form.body, sortOrder: Number(form.sortOrder), expectedVersion: member.value!.version
      }
    })
    await refresh()
    await refreshAuxiliary()
    if (session.value?.user.memberId === id) {
      await loadSession(true)
    }
    message.value = '成员资料已保存，稳定 ID 未改变。'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '保存失败'
  } finally {
    submitting.value = false
  }
}

const saveBinding = async () => {
  submitting.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/cms/members/${id}/binding`, {
      method: 'PATCH', headers: csrfHeaders(), body: { userId: form.linkedUserId || null }
    })
    await refresh()
    message.value = '账号绑定已更新；资料版本没有改变。'
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '绑定失败'
  } finally { submitting.value = false }
}

const restoreRevision = async (revisionId: string) => {
  if (!confirm('这会从旧版本创建一个新的不可变版本，确定继续吗？')) return
  submitting.value = true
  try {
    await $fetch(`/api/cms/members/${id}/restore`, {
      method: 'POST', headers: csrfHeaders(),
      body: { revisionId, expectedVersion: member.value!.version, confirmation: 'RESTORE_MEMBER_REVISION' }
    })
    await refresh()
    await refreshAuxiliary()
    message.value = '旧版本已恢复为新版本。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '恢复失败' } finally { submitting.value = false }
}

const applyProposal = async (proposalId: string) => {
  if (!confirm('提案不会自动生效。现在明确接受并创建新的成员版本吗？')) return
  submitting.value = true
  try {
    await $fetch(`/api/cms/member-proposals/${proposalId}/apply`, {
      method: 'POST', headers: csrfHeaders(),
      body: { expectedVersion: member.value!.version, confirmation: 'APPLY_MEMBER_PROPOSAL' }
    })
    await refresh(); await refreshAuxiliary(); message.value = '成员提案已明确接受并生成新版本。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '应用提案失败' } finally { submitting.value = false }
}
</script>

<template>
  <section v-if="member" class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" to="/cms/members">← 返回成员列表</NuxtLink>
      <p class="cms-eyebrow">MEMBER PROFILE</p>
      <h1>{{ member.name }}</h1>
      <p>PostgreSQL 权威资料 · 稳定 ID：<code>{{ member.memberKey }}</code> · 当前版本 v{{ member.version }}</p>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>

    <form class="cms-panel cms-form member-application-form member-edit-form" @submit.prevent="save">
      <div class="member-application-intro member-edit-intro">
        <div><span>MEMBER PROFILE</span><h2>成员档案资料</h2><p>当前版本 v{{ member.version }} · 稳定 ID：<code>{{ member.memberKey }}</code></p></div>
        <img class="cms-member-avatar member-edit-avatar" :src="resolveStaticMediaUrl(form.avatarUrl || '/images/logo.png')" :alt="`${form.name} 头像`">
      </div>

      <MemberProfileFields v-model="form" :options="memberOptions" :disabled="!isAdmin" />

      <label><span>头像路径或 URL</span><input v-model.trim="form.avatarUrl" :disabled="!isAdmin" maxlength="2048"></label>

      <details class="member-edit-advanced">
        <summary>高级公开字段</summary>
        <div class="member-edit-advanced-fields">
          <label><span>其他公开链接（JSON，仅 HTTP(S)）</span><textarea v-model="form.otherLinks" :disabled="!isAdmin" rows="5" /></label>
          <label><span>扩展公开字段（JSON；敏感字段会被拒绝）</span><textarea v-model="form.metadata" :disabled="!isAdmin" rows="7" /></label>
          <div class="member-application-grid"><label><span>排序号</span><input v-model.number="form.sortOrder" :disabled="!isAdmin" type="number" min="0" max="1000000"></label><label><span>Markdown 源文件（只读）</span><input :value="member.sourcePath" disabled></label></div>
        </div>
      </details>

      <footer v-if="isAdmin" class="member-application-actions"><button class="cms-button cms-button-primary" :disabled="submitting">{{ submitting ? '正在保存…' : '保存成员资料' }}</button></footer>
    </form>

    <form v-if="isAdmin" class="cms-panel cms-form" @submit.prevent="saveBinding">
      <h2>账号绑定（独立于公开资料）</h2>
      <p class="cms-muted">绑定只写入一对一关系表，不进入成员 Markdown、版本或导出仓库。</p>
      <label><span>登录账号</span><select v-model="form.linkedUserId"><option value="">不绑定</option><option v-for="user in auxiliary?.users" :key="user.id" :value="user.id">@{{ user.account }}</option></select></label>
      <button class="cms-button" :disabled="submitting">保存绑定</button>
    </form>

    <section class="cms-panel">
      <h2>PR 成员提案</h2>
      <p class="cms-muted">导入 PR 只会创建这里的提案；必须由管理员再次明确接受才会修改权威资料。</p>
      <ul v-if="auxiliary?.proposals.length">
        <li v-for="proposal in [...auxiliary.proposals].reverse()" :key="proposal.id">
          {{ proposal.action }} · {{ proposal.status }} · {{ Object.keys(proposal.fieldChanges).join('、') || '删除提案' }}
          <button v-if="isAdmin && proposal.status === 'pending'" class="cms-button" type="button" :disabled="submitting" @click="applyProposal(proposal.id)">明确接受提案</button>
        </li>
      </ul>
      <p v-else class="cms-muted">暂无提案。</p>
    </section>

    <section class="cms-panel">
      <h2>不可变版本历史</h2>
      <ul>
        <li v-for="revision in [...(auxiliary?.revisions || [])].reverse()" :key="revision.id">
          v{{ revision.revisionNumber }} · {{ revision.sourceKind }} · <code>{{ revision.contentHash.slice(0, 12) }}</code>
          <button v-if="isAdmin && revision.id !== member.currentRevisionId" class="cms-button" type="button" :disabled="submitting" @click="restoreRevision(revision.id)">恢复为新版本</button>
        </li>
      </ul>
    </section>
  </section>
</template>
