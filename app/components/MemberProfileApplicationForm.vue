<script setup lang="ts">
import type { MemberProfileFormModel } from '../../shared/types/member-profile-form'
const props = withDefaults(defineProps<{ immediateApproval?: boolean }>(), { immediateApproval: false })
const emit = defineEmits<{ complete: [] }>()
const { csrfHeaders } = useCmsSession()
const { data: options } = await useFetch<any>('/api/member-options')
const application = ref<{ id: string, token: string } | null>(null)
const form = reactive<MemberProfileFormModel>({
  name: '', grade: '', groupName: '', positions: [] as string[], seasons: [] as string[],
  advisorSeasons: [] as string[], affiliation: '', body: '', links: { github: '', 'home-page': '' }
})
const avatarUrl = ref('')
const message = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const avatarUploading = ref(false)
type ApplicationSession = { id: string, token: string }
let applicationRequest: Promise<ApplicationSession> | null = null
const ensureApplication = async () => {
  if (application.value) return application.value
  applicationRequest ||= $fetch<ApplicationSession>('/api/member-applications/start', { method: 'POST' })
  try {
    const started = await applicationRequest
    application.value ||= started
    return application.value
  } finally {
    applicationRequest = null
  }
}

const uploadAvatar = async (file: File) => {
  if (!file || !form.name) { errorMessage.value = '请先填写姓名，再选择头像'; return }
  avatarUploading.value = true
  errorMessage.value = ''
  try {
    const activeApplication = await ensureApplication()
    const body = new FormData()
    body.append('token', activeApplication.token)
    body.append('name', form.name)
    body.append('image', file)
    const result = await $fetch<{ url: string }>(`/api/member-applications/${activeApplication.id}/avatar`, { method: 'POST', body })
    avatarUrl.value = result.url
  } catch (error: any) { errorMessage.value = error?.data?.message || '头像上传失败' }
  finally { avatarUploading.value = false }
}

const submit = async () => {
  if (avatarUploading.value) {
    errorMessage.value = '请等待头像上传完成后再提交'
    return
  }
  submitting.value = true; errorMessage.value = ''
  try {
    const activeApplication = await ensureApplication()
    await $fetch(`/api/member-applications/${activeApplication.id}/submit`, {
      method: 'POST', body: { token: activeApplication.token, profile: form }
    })
    if (props.immediateApproval) {
      await $fetch(`/api/cms/member-applications/${activeApplication.id}/review`, {
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
      <MemberAvatarUpload
        :name="form.name"
        :current-url="avatarUrl"
        :disabled="submitting"
        :uploading="avatarUploading"
        @select="uploadAvatar"
      />
      <MemberProfileFields v-model="form" :options="options" />
      <footer class="member-application-actions"><button class="cms-button cms-button-primary" :disabled="submitting || avatarUploading">{{ avatarUploading ? '正在上传头像…' : (submitting ? '正在处理…' : (immediateApproval ? '创建并上线' : '提交审核')) }}</button></footer>
    </form>
  </div>
</template>
