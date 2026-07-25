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
      <h1>你好，{{ session?.user.displayName }}</h1>
      <p>后台基础能力已经就绪，内容编辑和发布能力会在后续阶段依次开放。</p>
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
        <strong>阶段 1 · 基础设施与身份认证</strong>
      </article>
    </div>
  </section>
</template>
