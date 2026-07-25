<script setup lang="ts">
import type { CmsMember } from '../../../shared/types/cms-members'

definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '个人资料 · Vinci 内容管理后台' })

const { session } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data: memberData } = await useAsyncData('cms:profile:member', async () => {
  if (!session.value?.user.memberId) return null
  return requestFetch<{ member: CmsMember }>(
    `/api/cms/members/${session.value.user.memberId}`
  )
})
const member = computed(() => memberData.value?.member)
</script>

<template>
  <section class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <p class="cms-eyebrow">
        PROFILE
      </p>
      <h1>个人资料</h1>
      <p>账号只负责身份认证；相同稳定 ID 的成员档案会自动与账号关联。</p>
    </header>

    <div class="cms-panel cms-form">
      <div v-if="member" class="cms-profile-member">
        <img :src="member.avatarUrl || '/images/logo.png'" :alt="`${member.name} 头像`">
        <div>
          <span class="cms-muted">关联成员资料</span>
          <h2>{{ member.name }}</h2>
          <NuxtLink :to="`/cms/members/${member.id}`">查看成员档案</NuxtLink>
        </div>
      </div>

      <label>
        <span>账号 ID</span>
        <input
          :value="session?.user.account"
          type="text"
          disabled
        >
      </label>

      <label>
        <span>角色</span>
        <input
          :value="session?.user.roles.join('、')"
          type="text"
          disabled
        >
      </label>

      <label>
        <span>账号状态</span>
        <input
          :value="session?.user.status === 'active' ? '正常' : '已停用'"
          type="text"
          disabled
        >
      </label>

      <p class="cms-muted">
        成员资料将通过相同的稳定 ID 与本账号一对一关联。
      </p>
      <div class="cms-profile-actions">
        <NuxtLink class="cms-button cms-button-link cms-button-primary" to="/cms/drafts">
          查看我的草稿
        </NuxtLink>
        <NuxtLink
          v-if="member"
          class="cms-button cms-button-link cms-button-quiet"
          :to="`/team/${member.memberKey}`"
        >
          查看前台成员页
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
