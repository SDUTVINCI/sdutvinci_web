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
      <p>成员资料维护和 Markdown 文章只读浏览已经开放。</p>
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
        <strong>阶段 2 · 成员与文章只读管理</strong>
      </article>
    </div>
  </section>
</template>
