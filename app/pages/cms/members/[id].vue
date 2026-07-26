<script setup lang="ts">
import type { CmsMember } from '../../../../shared/types/cms-members'

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
const form = reactive({ name: member.value?.name || '', avatarUrl: member.value?.avatarUrl || '' })
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
      body: { name: form.name, avatarUrl: form.avatarUrl || null }
    })
    await refresh()
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
</script>

<template>
  <section v-if="member" class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" to="/cms/members">← 返回成员列表</NuxtLink>
      <p class="cms-eyebrow">MEMBER PROFILE</p>
      <h1>{{ member.name }}</h1>
      <p>稳定 ID：<code>{{ member.memberKey }}</code> · {{ member.linkedAccount ? `已绑定 @${member.linkedAccount}` : '尚未绑定账号' }}</p>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>

    <form class="cms-panel cms-form" @submit.prevent="save">
      <img class="cms-member-avatar" :src="form.avatarUrl || '/images/logo.png'" :alt="`${form.name} 头像`">
      <label>
        <span>稳定 ID（不可修改）</span>
        <input :value="member.memberKey" disabled>
      </label>
      <label>
        <span>姓名</span>
        <input v-model.trim="form.name" :disabled="!isAdmin" required maxlength="100">
      </label>
      <label>
        <span>头像路径或 URL</span>
        <input v-model.trim="form.avatarUrl" :disabled="!isAdmin" maxlength="2048">
      </label>
      <label>
        <span>Markdown 源文件（只读）</span>
        <input :value="member.sourcePath" disabled>
      </label>
      <button v-if="isAdmin" class="cms-button cms-button-primary" :disabled="submitting">
        {{ submitting ? '正在保存…' : '保存资料' }}
      </button>
    </form>
  </section>
</template>
