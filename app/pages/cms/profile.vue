<script setup lang="ts">
definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '个人资料 · Vinci 内容管理后台' })

const { session } = useCmsSession()
</script>

<template>
  <section class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <p class="cms-eyebrow">
        PROFILE
      </p>
      <h1>个人资料</h1>
      <p>账号只负责身份认证；姓名、头像等资料将在阶段 2 从对应成员档案读取。</p>
    </header>

    <div class="cms-panel cms-form">
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
    </div>
  </section>
</template>
