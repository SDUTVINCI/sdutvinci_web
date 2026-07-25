<script setup lang="ts">
import type { CmsDraft } from '../../../../shared/types/cms-drafts'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '新建文章草稿 · Vinci 内容管理后台' })
const { csrfHeaders } = useCmsSession()
const form = reactive({
  title: '',
  collection: 'news' as 'news' | 'wiki'
})
const submitting = ref(false)
const errorMessage = ref('')

const createDraft = async () => {
  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ draft: CmsDraft }>('/api/cms/drafts', {
      method: 'POST',
      headers: csrfHeaders(),
      body: {
        kind: 'new',
        collection: form.collection,
        title: form.title
      }
    })
    await navigateTo(`/cms/drafts/${result.draft.id}`)
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '创建草稿失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" to="/cms/articles">← 返回文章列表</NuxtLink>
      <p class="cms-eyebrow">NEW DRAFT</p>
      <h1>新建文章草稿</h1>
      <p>新文章只保存在 PostgreSQL；本阶段不会在 <code>content/</code> 创建文件。</p>
    </header>

    <form class="cms-panel cms-form" @submit.prevent="createDraft">
      <p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
      <label>
        <span>内容集合</span>
        <select v-model="form.collection">
          <option value="news">新闻</option>
          <option value="wiki">Wiki</option>
        </select>
      </label>
      <label>
        <span>文章标题</span>
        <input v-model.trim="form.title" required maxlength="200" autofocus>
      </label>
      <button class="cms-button cms-button-primary" :disabled="submitting">
        {{ submitting ? '正在创建…' : '创建并开始编辑' }}
      </button>
    </form>
  </section>
</template>
