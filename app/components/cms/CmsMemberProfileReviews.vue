<script setup lang="ts">
const { confirm: confirmAction } = useSiteConfirm()
const { csrfHeaders, loadSession } = useCmsSession()
const { data, refresh, error, status } = await useFetch<any>('/api/cms/member-proposals')
const busy = ref('')
const message = ref('')
const errorMessage = ref('')
useFormNotices(message, errorMessage)
const notes = reactive<Record<string, string>>({})
const review = async (item: any, action: 'approve' | 'reject') => {
  if (action === 'reject' && !notes[item.proposal.id]?.trim()) { errorMessage.value = '拒绝前请填写原因'; return }
  if (!await confirmAction(action === 'approve' ? `审核通过 ${item.memberName} 的修改并使其生效吗？` : '拒绝这次资料修改吗？')) return
  busy.value = item.proposal.id; message.value = ''; errorMessage.value = ''
  try {
    await $fetch(`/api/cms/member-proposals/${item.proposal.id}/${action === 'approve' ? 'apply' : 'reject'}`, {
      method: 'POST', headers: csrfHeaders(), body: action === 'approve'
        ? { expectedVersion: item.version, confirmation: 'APPLY_MEMBER_PROPOSAL', note: notes[item.proposal.id] || '' }
        : { note: notes[item.proposal.id] }
    })
    await refresh(); await loadSession(true)
    message.value = action === 'approve' ? '资料已审核通过，身份与账号权限已同步。' : '申请已拒绝，成员可修改后重新提交。'
  } catch (error: any) { errorMessage.value = error?.data?.message || '审核失败；如原资料已变化，请拒绝并请本人重新提交' }
  finally { busy.value = '' }
}
</script>
<template>
  <section class="cms-review-lane" data-stage="profiles"><header class="cms-review-lane-header"><h2>成员资料修改审核</h2><p>所有本人修改均需审核。管理员可审核自己的申请；学员转正通过后同步升级权限。</p></header><p v-if="message" class="cms-alert" role="status">{{ message }}</p><p v-if="errorMessage" class="cms-alert cms-alert-error" role="alert">{{ errorMessage }}</p><p v-if="status === 'pending'">正在读取申请…</p><p v-else-if="error" role="alert">资料修改申请加载失败。<button type="button" @click="refresh()">重试</button></p><p v-else-if="!data?.items.length" class="cms-review-empty">暂无待审核的资料修改。</p><article v-for="item in data?.items" :key="item.proposal.id" class="cms-panel"><h3>{{ item.memberName }}</h3><NuxtLink :to="`/cms/members/${item.proposal.memberId}`">查看当前成员资料</NuxtLink><MemberProfileDiff :changes="item.proposal.fieldChanges" /><label>审核备注<textarea v-model="notes[item.proposal.id]" rows="2" maxlength="2000" /></label><div class="cms-review-actions"><button type="button" class="cms-button cms-button-primary" :disabled="!!busy" @click="review(item, 'approve')">审核通过并生效</button><button type="button" class="cms-button" :disabled="!!busy" @click="review(item, 'reject')">拒绝</button></div></article></section>
</template>
<style scoped>
article { margin: 16px 0; } label { display: grid; gap: 8px; } textarea { width: 100%; padding: 12px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; } .cms-review-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
</style>
