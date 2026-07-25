<script setup lang="ts">
import type { CmsArticleDetail } from '../../../../../shared/types/cms-articles'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const openingDraft = ref(false)
const draftError = ref('')

const { data } = await useAsyncData(`cms:article:${id}`, () =>
  requestFetch<{ article: CmsArticleDetail }>(`/api/cms/articles/${id}`)
)
const article = computed(() => data.value?.article)

if (!article.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在' })
}

const { data: rendered } = await useAsyncData(`cms:article:rendered:${id}`, async () => {
  const path = article.value!.publicPath
  return article.value!.collection === 'news'
    ? queryCollection('news').path(path).first()
    : queryCollection('wiki').path(path).first()
})

useHead(() => ({ title: `${article.value?.title || '文章'} · Vinci 内容管理后台` }))

const openDraft = async () => {
  openingDraft.value = true
  draftError.value = ''
  try {
    const result = await $fetch<{ draft: { id: string } }>('/api/cms/drafts', {
      method: 'POST',
      headers: csrfHeaders(),
      body: { kind: 'existing', articleId: id }
    })
    await navigateTo(`/cms/drafts/${result.draft.id}`)
  } catch (error: any) {
    draftError.value = error?.data?.message || '打开草稿失败'
  } finally {
    openingDraft.value = false
  }
}
</script>

<template>
  <section v-if="article" class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <NuxtLink class="cms-back-link" to="/cms/articles">← 返回文章列表</NuxtLink>
        <p class="cms-eyebrow">PUBLISHED · {{ article.collection }}</p>
        <h1>{{ article.title }}</h1>
        <p><code>{{ article.relativePath }}</code> · 稳定 ID：<code>{{ article.id }}</code></p>
      </div>
      <div class="cms-header-buttons">
        <NuxtLink class="cms-button cms-button-link cms-button-quiet" :to="`/cms/articles/${id}/history`">
          版本历史
        </NuxtLink>
        <button class="cms-button cms-button-primary" type="button" :disabled="openingDraft" @click="openDraft">
          {{ openingDraft ? '正在打开…' : '编辑草稿' }}
        </button>
      </div>
    </header>
    <p v-if="draftError" class="cms-alert cms-alert-error">{{ draftError }}</p>

    <div class="cms-detail-grid">
      <article class="cms-panel cms-preview">
        <h2>渲染预览</h2>
        <ContentRenderer v-if="rendered" :value="rendered" />
        <pre v-else class="cms-source">{{ article.body }}</pre>
      </article>
      <aside class="cms-panel cms-frontmatter">
        <h2>Frontmatter</h2>
        <dl>
          <template v-for="(value, key) in article.frontmatter" :key="key">
            <dt>{{ key }}</dt>
            <dd><pre>{{ typeof value === 'string' ? value : JSON.stringify(value, null, 2) }}</pre></dd>
          </template>
        </dl>
        <h2>内容校验</h2>
        <p class="cms-muted">SHA-256</p>
        <code class="cms-hash">{{ article.contentHash }}</code>
      </aside>
    </div>
  </section>
</template>
