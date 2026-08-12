<script setup lang="ts">
import type { CmsMember } from '../../../../shared/types/cms-members'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '成员 · Vinci 内容管理后台' })
const { session } = useCmsSession()
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
const message = ref('')
const created = async () => {
  message.value = '成员创建成功。'
  await refresh()
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
      <div v-if="isAdmin" class="cms-button-row cms-member-header-actions">
        <a class="cms-button cms-button-quiet" href="#article-credit-identities">文章署名</a>
        <NuxtLink class="cms-button cms-button-quiet" to="/cms/member-options">成员选项</NuxtLink>
        <button class="cms-button cms-button-primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? '取消' : '创建成员' }}
        </button>
      </div>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="status === 'pending'" class="cms-muted">正在加载成员档案…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '成员加载失败' }}</p>

    <MemberProfileApplicationForm v-if="showCreate && isAdmin" immediate-approval @complete="created" />

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
        <img
          :src="resolveStaticMediaUrl(member.avatarUrl || '/images/logo.png')"
          :alt="`${member.name} 头像`"
          loading="lazy"
          decoding="async"
        >
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

    <CmsArticleCreditIdentityManager
      v-if="isAdmin && status !== 'pending' && !error"
      :members="data?.members || []"
    />
  </section>
</template>
