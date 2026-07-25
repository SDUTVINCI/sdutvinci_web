<script setup lang="ts">
import type { CmsArticleDetail } from '../../../../shared/types/cms-articles'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch

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
</script>

<template>
  <section v-if="article" class="cms-page">
    <header class="cms-page-header">
      <NuxtLink class="cms-back-link" to="/cms/articles">← 返回文章列表</NuxtLink>
      <p class="cms-eyebrow">READ ONLY · {{ article.collection }}</p>
      <h1>{{ article.title }}</h1>
      <p><code>{{ article.relativePath }}</code> · 稳定 ID：<code>{{ article.id }}</code></p>
    </header>

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
