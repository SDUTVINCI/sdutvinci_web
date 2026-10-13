<script setup lang="ts">
const { confirm: confirmAction } = useSiteConfirm()
import type { CmsMember } from '../../../shared/types/cms-members'
import type { MemberProfileFormModel } from '../../../shared/types/member-profile-form'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'
import { cmsPasswordMinLength } from '~~/shared/types/cms-auth'

definePageMeta({ middleware: 'site-auth' })
useHead({ title: '个人中心 | Vinci', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
const { session, csrfHeaders, loadSession } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, refresh, error: loadError } = await useAsyncData('account:profile', () => requestFetch<{
  member: CmsMember | null, proposals: Array<{ id: string, status: string, fieldChanges: Record<string, any>, reviewNote: string | null, createdAt: string }>
}>('/api/account/profile'))
const { data: options } = await useFetch<any>('/api/member-options')
watch(session, async value => {
  if (!value) { clearNuxtData('account:profile'); await navigateTo({ path: '/cms/login', query: { redirect: '/account' } }) }
})
const member = computed(() => data.value?.member)
const pending = computed(() => data.value?.proposals.find(item => item.status === 'pending'))
const isAdmin = computed(() => session.value?.user.roles.includes('admin'))
const editing = ref(false)
const form = reactive<MemberProfileFormModel>({ isLearner: false, teacherDetails: '', name: '', grade: '', groupName: '', positions: [], seasons: [], advisorSeasons: [], affiliation: '', body: '', links: { github: '', 'home-page': '' } })
const avatarUrl = ref('')
const busy = ref(false)
const uploading = ref(false)
const message = ref('')
const errorMessage = ref('')
useFormNotices(message, errorMessage)
const resetForm = () => {
  if (!member.value) return
  const current = member.value
  Object.assign(form, { isLearner: current.isLearner === true, teacherDetails: current.teacherDetails || '', name: current.name, grade: current.grade || '', groupName: current.groupName || '',
    positions: [...current.positions], seasons: [...current.seasons], advisorSeasons: [...current.advisorSeasons], affiliation: current.affiliation || '',
    body: current.body, links: { github: current.links.github || '', 'home-page': current.links['home-page'] || current.links.homepage || '' } })
  avatarUrl.value = current.avatarUrl || ''
}
watch(member, resetForm, { immediate: true })
const startEdit = () => { resetForm(); editing.value = true; message.value = ''; errorMessage.value = '' }
const uploadAvatar = async (file: File) => {
  if (!member.value || pending.value) return
  uploading.value = true; errorMessage.value = ''
  try {
    const body = new FormData()
    body.append('image', file); body.append('name', form.name); body.append('expectedVersion', String(member.value.version))
    const result = await $fetch<{ url: string }>('/api/account/profile/avatar', { method: 'POST', headers: csrfHeaders(), body })
    avatarUrl.value = result.url
    message.value = '头像已准备好，提交资料并审核通过后才会公开更新。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '头像上传失败' }
  finally { uploading.value = false }
}
const submitProfile = async () => {
  if (!member.value || uploading.value) return
  busy.value = true; errorMessage.value = ''; message.value = ''
  try {
    await $fetch('/api/account/profile', { method: 'POST', headers: csrfHeaders(), body: {
      ...form, isLearner: form.isLearner === true, avatarUrl: avatarUrl.value, expectedVersion: member.value.version
    } })
    editing.value = false; await refresh()
    message.value = '修改已提交审核，公开资料和账号权限将在审核通过后更新。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '提交失败' }
  finally { busy.value = false }
}
const withdraw = async () => {
  if (!pending.value || !await confirmAction('撤回本次修改后，可以重新编辑提交。确定撤回吗？')) return
  busy.value = true; errorMessage.value = ''
  try { await $fetch(`/api/account/profile/${pending.value.id}/withdraw`, { method: 'POST', headers: csrfHeaders() }); await refresh(); message.value = '修改已撤回。' }
  catch (error: any) { errorMessage.value = error?.data?.message || '撤回失败' }
  finally { busy.value = false }
}
const password = reactive({ current: '', next: '', confirm: '' })
const changePassword = async () => {
  if (password.next !== password.confirm) { errorMessage.value = '两次输入的新密码不一致'; return }
  busy.value = true; errorMessage.value = ''; message.value = ''
  try {
    await $fetch('/api/account/password', { method: 'PATCH', headers: csrfHeaders(), body: { currentPassword: password.current, newPassword: password.next } })
    Object.assign(password, { current: '', next: '', confirm: '' }); message.value = '密码已修改。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '密码修改失败' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="account-page">
    <header class="section-heading"><p class="eyebrow">MY ACCOUNT</p><h1>个人中心</h1><p>资料修改需提交审核，审核通过后才会更新。管理员也遵循相同流程，可明确审核自己的申请。</p></header>
    <p v-if="loadError" role="alert">个人资料暂时无法读取，请刷新后重试。</p>
    <p v-if="message" class="account-message" role="status">{{ message }}</p><p v-if="errorMessage" class="account-message account-error" role="alert">{{ errorMessage }}</p>
    <section class="account-panel">
      <div class="account-identity"><img v-if="member?.avatarUrl" :src="resolveStaticMediaUrl(member.avatarUrl)" :alt="member.name"><div><h2>{{ member?.name || session?.user.account }}</h2><p>@{{ session?.user.account }} · {{ isAdmin ? '管理员' : session?.user.roles.includes('reader') ? '学员' : '成员' }}</p></div></div>
      <dl v-if="member" class="account-facts"><div><dt>年级</dt><dd>{{ member.grade ? `${member.grade} 级` : '未填写' }}</dd></div><div><dt>学院／单位</dt><dd>{{ member.affiliation || '未填写' }}</dd></div><div><dt>组别</dt><dd>{{ member.groupName || '待分组' }}</dd></div><div><dt>成员身份</dt><dd>{{ member.isLearner ? '智能机器人创新实践基地学员' : member.role }}</dd></div></dl>
      <p v-else>账号尚未关联成员档案，请联系管理员处理。</p>
      <div class="account-actions"><button v-if="member && !pending && !editing" type="button" @click="startEdit">{{ member.isLearner ? '修改资料／申请转为正式成员' : '修改资料' }}</button><NuxtLink v-if="member" :to="`/team/${member.memberKey}`">查看公开资料</NuxtLink><NuxtLink v-if="session?.user.roles.some(role => role === 'admin' || role === 'member')" to="/cms">进入 CMS</NuxtLink></div>
    </section>
    <section v-if="pending" class="account-panel"><h2>待审核的资料修改</h2><p>审核前继续展示原资料，身份与权限保持原状态。</p><MemberProfileDiff :changes="pending.fieldChanges" /><div class="account-actions"><button type="button" :disabled="busy" @click="withdraw">撤回修改</button></div><div v-if="isAdmin" class="account-actions"><NuxtLink to="/cms/reviews">前往审核中心审核</NuxtLink></div></section>
    <form v-if="editing && member && !pending" class="account-panel cms-form member-application-form" @submit.prevent="submitProfile"><h2>修改个人资料</h2><p v-if="member.isLearner">申请转为正式成员时，取消“新学员”并补齐职务和参赛信息。审核通过后同步更新身份和权限。</p><MemberAvatarUpload :name="form.name" :current-url="resolveStaticMediaUrl(avatarUrl)" required :disabled="busy" :uploading="uploading" @select="uploadAvatar" /><MemberProfileFields v-model="form" :options="options" :disabled="busy || uploading" :allow-empty-grade="!member.grade" required /><div class="account-actions"><button :disabled="busy || uploading">{{ busy ? '正在提交…' : '提交修改审核' }}</button><button type="button" :disabled="busy || uploading" @click="editing = false">取消编辑</button></div></form>
    <section v-if="data?.proposals.some(item => item.status !== 'pending')" class="account-panel"><h2>修改记录</h2><details v-for="item in [...(data?.proposals || [])].reverse().filter(item => item.status !== 'pending')" :key="item.id"><summary>{{ item.status === 'applied' ? '已通过' : item.status === 'rejected' ? '已拒绝' : '需要重新提交' }} · {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}</summary><p v-if="item.reviewNote">审核备注：{{ item.reviewNote }}</p><MemberProfileDiff :changes="item.fieldChanges" /></details></section>
    <form class="account-panel account-password" @submit.prevent="changePassword"><h2>修改密码</h2><label>当前密码<input v-model="password.current" type="password" autocomplete="current-password" required></label><label>新密码<input v-model="password.next" type="password" autocomplete="new-password" :minlength="cmsPasswordMinLength" required></label><label>确认新密码<input v-model="password.confirm" type="password" autocomplete="new-password" :minlength="cmsPasswordMinLength" required></label><div class="account-actions"><button :disabled="busy">修改密码</button></div></form>
  </main>
</template>
<style scoped>
.account-page { width: min(980px, calc(100% - 40px)); margin: 64px auto 96px; }
.account-panel { padding: 28px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); margin-top: 24px; }
.account-panel h2 { margin: 0 0 16px; }.account-panel p { color: var(--ink-soft); line-height: 1.8; }
.account-identity { display: flex; gap: 20px; align-items: center; }.account-identity img { width: 80px; height: 80px; object-fit: cover; border-radius: 50%; }
.account-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }.account-facts dd { margin: 6px 0 0; }.account-facts dt { color: var(--ink-soft); }
.account-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }.account-actions button,.account-actions a { padding: 12px 18px; background: var(--surface-soft); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); cursor: pointer; }
.account-actions button:disabled { opacity: .5; cursor: wait; }.account-message { padding: 16px; background: var(--surface-soft); border-radius: 8px; }.account-error { color: var(--red-dark); }
.account-password label { display: grid; gap: 8px; margin-top: 16px; }.account-password input { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
details { padding: 14px 0; } summary { cursor: pointer; }
@media(max-width: 640px) { .account-panel { padding: 18px; }.account-facts { grid-template-columns: 1fr; } }
</style>
