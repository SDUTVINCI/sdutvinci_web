<script setup lang="ts">
const { data: options } = await useFetch<any>('/api/member-options')
const application = ref<{ id: string, token: string } | null>(null)
const form = reactive({ name: '', grade: '', groupName: '', positions: [] as string[], advisorSeasons: [] as string[], affiliation: '', body: '', links: { github: '' } })
const avatarUrl = ref(''); const message = ref(''); const errorMessage = ref(''); const submitting = ref(false)
const cohort = computed(() => options.value?.cohorts.find((item: any) => String(item.gradeYear) === form.grade))
const ensureApplication = async () => { application.value ||= await $fetch('/api/member-applications/start', { method: 'POST' }) }
const uploadAvatar = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file || !form.name) { errorMessage.value = '请先填写姓名，再选择头像'; return }
  await ensureApplication(); const body = new FormData(); body.append('token', application.value!.token); body.append('name', form.name); body.append('image', file)
  try { const result = await $fetch<{ url: string }>(`/api/member-applications/${application.value!.id}/avatar`, { method: 'POST', body }); avatarUrl.value = result.url }
  catch (error: any) { errorMessage.value = error?.data?.message || '头像上传失败' }
}
const submit = async () => {
  submitting.value = true; errorMessage.value = ''
  try { await ensureApplication(); await $fetch(`/api/member-applications/${application.value!.id}/submit`, { method: 'POST', body: { token: application.value!.token, profile: form } }); message.value = '信息已提交，管理员审核通过后才会在成员页面上线。'; application.value = null }
  catch (error: any) { errorMessage.value = error?.data?.message || '提交失败' } finally { submitting.value = false }
}
onBeforeUnmount(() => {
  if (!application.value) return
  void $fetch(`/api/member-applications/${application.value.id}`, { method: 'DELETE', body: { token: application.value.token } }).catch(() => undefined)
})
useHead({ title: '新增成员信息 · Vinci 机器人队' })
</script>

<template><main><section class="page-hero"><div><p class="eyebrow">MEMBER APPLICATION</p><h1>新增成员信息</h1><p>无需登录即可填写；提交后由管理员审核，审核通过前不会公开。</p></div></section><section class="member-directory"><p v-if="message" class="cms-alert">{{ message }}</p><p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p><form v-if="!message" class="cms-panel cms-form" @submit.prevent="submit"><label><span>姓名</span><input v-model.trim="form.name" maxlength="100" required></label><label><span>年级</span><select v-model="form.grade" required><option value="">请选择</option><option v-for="item in options?.cohorts" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label><label><span>组别</span><select v-model="form.groupName"><option value="">不属于具体组别</option><option v-for="group in cohort?.groups || []" :key="group">{{ group }}</option></select></label><fieldset><legend>职责（可多选）</legend><label v-for="position in options?.positions" :key="position"><input v-model="form.positions" type="checkbox" :value="position"> {{ position }}</label></fieldset><label><span>指导届次（可选、多选）</span><select v-model="form.advisorSeasons" multiple><option v-for="item in options?.cohorts" :key="item.id" :value="item.season">{{ item.season }} 赛季</option></select></label><label><span>学院 / 单位</span><input v-model.trim="form.affiliation" maxlength="200"></label><label><span>简介</span><textarea v-model="form.body" rows="8" maxlength="10000" /></label><label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" type="url" maxlength="2048"></label><label><span>头像（自动转 WebP，文件名为姓名-哈希.webp）</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadAvatar"></label><img v-if="avatarUrl" class="cms-member-avatar" :src="avatarUrl" :alt="`${form.name} 头像预览`"><button class="cms-button cms-button-primary" :disabled="submitting">{{ submitting ? '正在提交…' : '提交审核' }}</button></form></section></main></template>
