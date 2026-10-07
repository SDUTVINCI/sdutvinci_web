<script setup lang="ts">
import type { PublicArticleCollection, PublicContentSearchResult } from '~~/shared/types/public-content'

const route = useRoute()
definePageMeta({ middleware: ['public-search'] })
const { session } = useCmsSession()
const query = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() : '')
const collection = computed<PublicArticleCollection | undefined>(() =>
  route.query.collection === 'news' || route.query.collection === 'wiki'
    ? route.query.collection
    : undefined
)
const input = ref(query.value)
const validQuery = computed(() => query.value.length > 0 && query.value.length <= 200)
const filters = [
  { label: '全部', value: undefined },
  { label: '新闻', value: 'news' },
  { label: 'Wiki', value: 'wiki' }
] as const

// Separate anonymous and signed-in caches so logout cannot reuse member-only results.
const key = computed(() => `public-search:${JSON.stringify([
  query.value, collection.value, session.value?.user.id ?? null
])}`)
const { data, pending, error, refresh } = await usePublicContentQuery<{ items: PublicContentSearchResult[] }>({
  key,
  lazy: true,
  database: requestFetch => validQuery.value
    ? requestFetch('/api/v2/content/search', {
        query: { q: query.value, collection: collection.value }
      })
    : Promise.resolve({ items: [] })
})
const results = computed(() => data.value?.items ?? [])

useContentSeo({
  title: '全站搜索 | 山东理工大学 Vinci 机器人队',
  description: '搜索 Vinci 机器人队的新闻、工程教程和 Wiki 正文。',
  path: '/search'
})
useSeoMeta({ robots: 'noindex, follow' })

watch(query, value => { input.value = value })

const submitSearch = async () => {
  const next = input.value.trim()
  if (!next || next.length > 200) return
  if (next === query.value) {
    await refresh()
    return
  }
  await navigateTo({
    path: '/search',
    query: { q: next, ...(collection.value ? { collection: collection.value } : {}) }
  })
}

const filterLink = (value: PublicArticleCollection | undefined) => ({
  path: '/search',
  query: { ...(query.value ? { q: query.value } : {}), ...(value ? { collection: value } : {}) }
})
</script>

<template>
  <main class="search-page">
    <section class="search-intro" aria-labelledby="search-title">
      <p class="eyebrow">Search Vinci</p>
      <h1 id="search-title">全站搜索</h1>
      <p class="search-description">搜索新闻和 Wiki 的标题、路径与正文，找到你需要的赛事记录和工程资料。</p>

      <form class="search-form" role="search" action="/search" method="get" @submit.prevent="submitSearch">
        <input v-if="collection" type="hidden" name="collection" :value="collection">
        <label class="visually-hidden" for="site-search-input">搜索关键词</label>
        <input
          id="site-search-input"
          v-model="input"
          type="search"
          name="q"
          required
          maxlength="200"
          placeholder="例如：Robocon、环境配置、电机"
          aria-describedby="search-scope"
        >
        <button type="submit" :disabled="!input.trim() || input.trim().length > 200">搜索</button>
      </form>
      <p id="search-scope" class="search-hint">公开内容无需登录；登录后可搜索仅限成员的新闻和 Wiki。</p>

      <nav class="search-filters" aria-label="搜索内容类型">
        <NuxtLink
          v-for="filter in filters"
          :key="filter.label"
          :to="filterLink(filter.value)"
          class="filter-chip"
          :class="{ active: collection === filter.value }"
          :aria-current="collection === filter.value ? 'page' : undefined"
        >{{ filter.label }}</NuxtLink>
      </nav>
    </section>

    <section class="search-results" aria-label="搜索结果" :aria-busy="pending && validQuery">
      <PublicContentState v-if="!query" empty-message="输入关键词，搜索新闻与 Wiki 知识库。" />
      <PublicContentState v-else-if="!validQuery" empty-message="关键词最多支持 200 个字符，请缩短后重新搜索。" />
      <PublicContentState
        v-else-if="pending || error || !results.length"
        :pending="pending"
        :error="Boolean(error)"
        loading-message="正在搜索…"
        error-message="搜索暂时不可用，请稍后重试。"
        :empty-message="`没有找到与「${query}」匹配的内容，试试其他关键词或内容类型。`"
        @retry="refresh()"
      />
      <template v-else>
        <p class="search-result-count" role="status">
          「{{ query }}」· {{ results.length === 100 ? '显示前 100 条结果，可缩小关键词或选择内容类型' : `找到 ${results.length} 条结果` }}
        </p>
        <ol class="search-result-list">
          <li v-for="item in results" :key="item.id">
            <NuxtLink :to="item.path" class="search-result-card">
              <div class="search-result-meta">
                <span>{{ item.collection === 'news' ? '新闻' : 'Wiki' }}</span>
                <span v-if="item.requiresAuth" class="content-access-label">成员资料</span>
              </div>
              <h2><SearchHighlightedText :text="item.title" :query="query" /></h2>
              <p class="search-result-snippet"><SearchHighlightedText :text="item.snippet || item.description" :query="query" /></p>
              <p class="search-result-path"><SearchHighlightedText :text="item.path" :query="query" /></p>
            </NuxtLink>
          </li>
        </ol>
      </template>
    </section>
  </main>
</template>

<style scoped>
.search-page {
  width: min(900px, calc(100% - 48px));
  min-height: 60vh;
  margin: 64px auto 96px;
}

.search-intro h1 { font-size: clamp(2rem, 5vw, 3.4rem); }
.search-description { margin-top: 20px; color: var(--ink-soft); }
.search-form { display: flex; gap: 12px; margin-top: 28px; }
.search-form input[type="search"] {
  width: 100%;
  min-width: 0;
  min-height: 50px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}
.search-form button {
  flex-shrink: 0;
  min-height: 50px;
  border: 0;
  border-radius: 10px;
  padding: 12px 24px;
  background: var(--cyan);
  color: var(--surface);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.search-form button:disabled { opacity: 0.6; cursor: default; }
.search-form input[type="search"]:focus-visible,
.search-form button:focus-visible,
.search-result-card:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.search-hint { margin-top: 12px; color: var(--muted); font-size: 0.85rem; }
.search-filters { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.search-results { margin-top: 32px; }
.search-result-count { margin-bottom: 16px; color: var(--muted); overflow-wrap: anywhere; }
.search-result-list { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.search-result-card {
  display: block;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 24px;
  background: var(--surface);
  overflow-wrap: anywhere;
}
.search-result-card:hover { border-color: var(--cyan); }
.search-result-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; color: var(--cyan); font-size: 0.8rem; font-weight: 800; }
.search-result-card h2 { font-size: 1.3rem; line-height: 1.5; }
.search-result-snippet { margin-top: 10px; color: var(--ink-soft); }
.search-result-path { margin-top: 12px; color: var(--muted); font-size: 0.8rem; }
@media (max-width: 620px) {
  .search-page { width: calc(100% - 32px); margin-top: 36px; }
  .search-form { gap: 8px; }
  .search-form button { padding-inline: 16px; }
  .search-result-card { padding: 18px; }
}
</style>
