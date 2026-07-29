<script setup lang="ts">
type NewsItem = Record<string, any>

const route = useRoute()
const slug = decodeURIComponent(String(route.params.slug ?? ''))
const newsPath = `/news/${slug}`

const { data: page, renderer } = await usePublicContentQuery<NewsItem | null>({
  key: `news:${slug}`,
  collection: 'news',
  legacy: () => queryCollection('news').path(newsPath).first() as Promise<NewsItem | null>,
  database: async () => (
    await $fetch<{ item: NewsItem }>(
      `/api/v2/content/news/${encodeURIComponent(slug)}`
    )
  ).item
})

if (!page.value) {
  throw createError({
    statusCode: 404,
    statusMessage: '新闻不存在'
  })
}

useContentSeo({
  title: () => `${page.value?.title || '新闻'} | Vinci 机器人队`,
  description: () => String(
    page.value?.description || page.value?.summary || page.value?.title || ''
  ),
  path: newsPath,
  image: () => page.value?.image ? String(page.value.image) : undefined,
  type: 'article'
})

const formatDate = (value: unknown) => {
  const text = String(value ?? '')
  if (!text) return '未标注日期'

  return text.replace(/-/g, '.')
}

const bilibiliSrc = computed(() => {
  const bvid = page.value?.bvid
  if (!bvid) return ''

  return `https://player.bilibili.com/player.html?isOutside=true&bvid=${encodeURIComponent(String(bvid))}&p=1`
})
</script>

<template>
  <main v-if="page">
    <section class="page-hero news-hero">
      <div>
        <p class="eyebrow">{{ formatDate(page.date) }}</p>
        <h1>{{ page.title }}</h1>
        <p v-if="page.summary">{{ page.summary }}</p>
      </div>
    </section>

    <article class="news-detail">
      <div class="news-detail-meta">
        <span v-if="page.author">{{ page.author }}</span>
        <span>{{ formatDate(page.date) }}</span>
        <span v-for="tag in page.tags || []" :key="tag">{{ tag }}</span>
      </div>

      <div v-if="bilibiliSrc" class="news-video">
        <iframe
          :src="bilibiliSrc"
          title="Bilibili 视频"
          scrolling="no"
          frameborder="0"
          allowfullscreen
        />
      </div>

      <div class="content-prose">
        <ContentRenderer v-if="renderer === 'nuxt_content'" :value="page" />
        <VinciMarkdownRenderer v-else :markdown="String(page.body || '')" />
      </div>

      <div class="article-footer-actions">
        <NuxtLink class="text-link" to="/news">返回新闻列表</NuxtLink>
        <CmsArticleEditButton :public-path="newsPath" />
      </div>
    </article>
  </main>
</template>
