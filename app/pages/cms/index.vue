<script setup lang="ts">
definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '工作台 · Vinci 内容管理后台' })

const { session } = useCmsSession()
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header">
      <p class="cms-eyebrow">
        DASHBOARD
      </p>
      <h1>你好，{{ session?.user.account }}</h1>
      <p>Markdown 双模式编辑和 PostgreSQL 草稿自动保存已经开放，正式内容仍保持只读。</p>
    </header>

    <div class="cms-card-grid">
      <article class="cms-card">
        <span>当前角色</span>
        <strong>{{ session?.user.roles.join('、') }}</strong>
      </article>
      <article class="cms-card">
        <span>账号状态</span>
        <strong>正常</strong>
      </article>
      <article class="cms-card">
        <span>当前阶段</span>
        <strong>阶段 3 · Markdown 编辑器与草稿</strong>
      </article>
    </div>
  </section>
</template>
