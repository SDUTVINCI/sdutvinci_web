<script setup lang="ts">
import type { CmsMember } from '../../../../shared/types/cms-members'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '成员 · Vinci 内容管理后台' })
const { session, csrfHeaders } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, status, error, refresh } = await useAsyncData('cms:members', () =>
  requestFetch<{ members: CmsMember[] }>('/api/cms/members')
)
const search = ref('')
const filteredMembers = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return data.value?.members || []
  return (data.value?.members || []).filter(member =>
    member.name.toLowerCase().includes(query)
    || member.memberKey.toLowerCase().includes(query)
    || member.linkedAccount?.toLowerCase().includes(query)
  )
})

const showCreate = ref(false)
const submitting = ref(false)
const message = ref('')
const errorMessage = ref('')
const form = reactive({ memberKey: '', name: '', avatarUrl: '' })

const createMember = async () => {
  submitting.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    await $fetch('/api/cms/members', {
      method: 'POST',
      headers: csrfHeaders(),
      body: {
        memberKey: form.memberKey,
        name: form.name,
        avatarUrl: form.avatarUrl || null
      }
    })
    Object.assign(form, { memberKey: '', name: '', avatarUrl: '' })
    showCreate.value = false
    message.value = '成员创建成功。'
    await refresh()
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '创建失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">MEMBERS</p>
        <h1>成员管理</h1>
        <p>共识别 {{ data?.members.length ?? 0 }} 份成员档案；成员 ID 与账号 ID 可一一对应。</p>
      </div>
      <button
        v-if="isAdmin"
        class="cms-button cms-button-primary"
        type="button"
        @click="showCreate = !showCreate"
      >
        {{ showCreate ? '取消' : '创建成员' }}
      </button>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <p v-if="status === 'pending'" class="cms-muted">正在加载成员档案…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '成员加载失败' }}</p>

    <form v-if="showCreate && isAdmin" class="cms-panel cms-inline-form" @submit.prevent="createMember">
      <h2>创建成员档案</h2>
      <label>
        <span>稳定 ID（也是对应账号 ID）</span>
        <input v-model.trim="form.memberKey" required pattern="[a-z][a-z0-9]{2,31}" placeholder="dongjiahui">
      </label>
      <label>
        <span>姓名</span>
        <input v-model.trim="form.name" required maxlength="100">
      </label>
      <label>
        <span>头像路径或 URL</span>
        <input v-model.trim="form.avatarUrl" maxlength="2048" placeholder="/images/member_photo/example.jpg">
      </label>
      <button class="cms-button cms-button-primary" :disabled="submitting">
        {{ submitting ? '正在创建…' : '确认创建' }}
      </button>
    </form>

    <div v-if="status !== 'pending' && !error" class="cms-toolbar cms-toolbar-compact">
      <label>
        <span>搜索成员</span>
        <input v-model.trim="search" type="search" placeholder="姓名、稳定 ID 或绑定账号">
      </label>
    </div>

    <div v-if="filteredMembers.length" class="cms-member-grid">
      <NuxtLink
        v-for="member in filteredMembers"
        :key="member.id"
        class="cms-member-card"
        :to="`/cms/members/${member.id}`"
      >
        <img :src="member.avatarUrl || '/images/logo.png'" :alt="`${member.name} 头像`">
        <div>
          <h2>{{ member.name }}</h2>
          <code>{{ member.memberKey }}</code>
          <p>{{ member.linkedAccount ? `已绑定 @${member.linkedAccount}` : '尚未绑定账号' }}</p>
        </div>
      </NuxtLink>
    </div>
    <p v-else-if="status !== 'pending' && !error" class="cms-empty">
      {{ search ? '没有符合条件的成员。' : '暂无成员档案。' }}
    </p>
  </section>
</template>
