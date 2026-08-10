<script setup lang="ts">
const props = withDefaults(defineProps<{ immediateApproval?: boolean }>(), { immediateApproval: false })
const emit = defineEmits<{ complete: [] }>()
const { csrfHeaders } = useCmsSession()
const { data: options } = await useFetch<any>('/api/member-options')
const application = ref<{ id: string, token: string } | null>(null)
const form = reactive({
  name: '', grade: '', groupName: '', positions: [] as string[], seasons: [] as string[],
  advisorSeasons: [] as string[], affiliation: '', body: '', links: { github: '', homepage: '' }
})
const avatarUrl = ref('')
const message = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const cohort = computed(() => options.value?.cohorts.find((item: any) => String(item.gradeYear) === form.grade))
const ensureApplication = async () => { application.value ||= await $fetch('/api/member-applications/start', { method: 'POST' }) }

watch(cohort, (value) => {
  if (value && !form.seasons.length) form.seasons = [value.season]
  if (form.groupName && !value?.groups.includes(form.groupName)) form.groupName = ''
})

const uploadAvatar = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !form.name) { errorMessage.value = '请先填写姓名，再选择头像'; return }
  await ensureApplication()
  const body = new FormData()
  body.append('token', application.value!.token)
  body.append('name', form.name)
  body.append('image', file)
  try {
    const result = await $fetch<{ url: string }>(`/api/member-applications/${application.value!.id}/avatar`, { method: 'POST', body })
    avatarUrl.value = result.url
  } catch (error: any) { errorMessage.value = error?.data?.message || '头像上传失败' }
}

const submit = async () => {
  submitting.value = true; errorMessage.value = ''
  try {
    await ensureApplication()
    await $fetch(`/api/member-applications/${application.value!.id}/submit`, {
      method: 'POST', body: { token: application.value!.token, profile: form }
    })
    if (props.immediateApproval) {
      await $fetch(`/api/cms/member-applications/${application.value!.id}/review`, {
        method: 'POST', headers: csrfHeaders(), body: { action: 'approve', note: '管理员在成员管理中直接创建' }
      })
      message.value = '成员已创建并上线。'
    } else {
      message.value = '信息已提交，管理员审核通过后才会在成员页面上线。'
    }
    application.value = null
    emit('complete')
  } catch (error: any) { errorMessage.value = error?.data?.message || (props.immediateApproval ? '创建失败' : '提交失败') }
  finally { submitting.value = false }
}

onBeforeUnmount(() => {
  if (!application.value) return
  void $fetch(`/api/member-applications/${application.value.id}`, { method: 'DELETE', body: { token: application.value.token } }).catch(() => undefined)
})
</script>

<template>
  <div>
    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <form v-if="!message" class="cms-panel cms-form member-application-form" @submit.prevent="submit">
      <div class="member-application-intro"><div><span>MEMBER PROFILE</span><h2>{{ immediateApproval ? '创建成员档案' : '填写成员资料' }}</h2></div><p>带“可选”的字段可以留空，其余信息将用于成员页分类和展示。</p></div>
      <div class="member-application-grid">
        <label><span>姓名</span><input v-model.trim="form.name" maxlength="100" required placeholder="请输入真实姓名"></label>
        <label><span>年级</span><select v-model="form.grade" required><option value="">请选择</option><option v-for="item in options?.cohorts" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label>
        <label><span>组别</span><select v-model="form.groupName"><option value="">不属于具体组别</option><option v-for="group in cohort?.groups || []" :key="group">{{ group }}</option></select></label>
        <label><span>学院 / 单位</span><select v-model="form.affiliation"><option value="">请选择（可选）</option><option v-for="college in options?.colleges || []" :key="college">{{ college }}</option></select></label>
      </div>
      <fieldset class="member-choice-fieldset"><legend>职责（可多选）</legend><div class="member-choice-grid"><label v-for="position in options?.positions" :key="position" class="member-choice"><input v-model="form.positions" type="checkbox" :value="position"><span>{{ position }}</span></label></div></fieldset>
      <fieldset class="member-choice-fieldset"><legend>参加过的赛季（可多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in options?.cohorts" :key="item.id" class="member-choice"><input v-model="form.seasons" type="checkbox" :value="item.season"><span>{{ item.season }} 赛季</span></label></div></fieldset>
      <fieldset class="member-choice-fieldset"><legend>顾问 / 指导届次（可选、多选）</legend><p class="member-choice-help">仅顾问或指导老师需要选择所指导的届次。</p><div class="member-choice-grid member-season-grid"><label v-for="item in options?.cohorts" :key="item.id" class="member-choice"><input v-model="form.advisorSeasons" type="checkbox" :value="item.season"><span>{{ item.season }} 赛季</span></label></div></fieldset>
      <label><span>简介</span><textarea v-model="form.body" rows="7" maxlength="10000" placeholder="介绍职责、方向或主要经历" /></label>
      <div class="member-application-grid"><label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" type="url" maxlength="2048" placeholder="https://github.com/..."></label><label><span>个人主页链接（可选）</span><input v-model.trim="form.links.homepage" type="url" maxlength="2048" placeholder="https://..."></label></div>
      <label class="member-avatar-upload"><span>头像（文件名自动转为姓名-哈希.webp）</span><input class="member-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadAvatar"></label>
      <img v-if="avatarUrl" class="cms-member-avatar" :src="avatarUrl" :alt="`${form.name} 头像预览`">
      <footer class="member-application-actions"><button class="cms-button cms-button-primary" :disabled="submitting">{{ submitting ? '正在处理…' : (immediateApproval ? '创建并上线' : '提交审核') }}</button></footer>
    </form>
  </div>
</template>
