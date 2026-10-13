<script setup lang="ts">
type NewsItem = Record<string, any>

const { data: rawNews, pending, error, refresh } = await usePublicContentQuery<NewsItem[]>({
  key: 'news:list',
  lazy: true,
  database: async requestFetch => (
    await requestFetch<{ items: NewsItem[] }>('/api/v2/content/news')
  ).items
})

useContentSeo({
  title: '新闻 | 山东理工大学 Vinci 机器人队',
  description: '记录 Vinci 机器人队的赛事采访、训练进展、团队活动和阶段性成果。',
  path: '/news'
})

const newsList = computed(() =>
  [...(rawNews.value ?? [])].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
)

const formatDate = (value: unknown) => {
  const text = String(value ?? '')
  if (!text) return '未标注日期'

  return text.replace(/-/g, '.')
}

const stats = computed(() => [
  { value: pending.value || error.value ? '—' : newsList.value.length, label: '新闻记录' },
  { value: pending.value || error.value ? '—' : newsList.value[0]?.date ? formatDate(newsList.value[0].date) : '暂无记录', label: '最近更新' },
  { value: 'Robocon', label: '主要动态方向' }
])
</script>

<template>
  <main>
    <section class="page-hero news-hero">
      <div>
        <p class="eyebrow">Newsroom</p>
        <h1>新闻动态</h1>
        <p>
          记录 Vinci 机器人队的赛事采访、训练进展、团队活动和阶段性成果。
        </p>
      </div>
    </section>

    <section class="stats-band research-stats" aria-label="新闻概览">
      <div v-for="item in stats" :key="item.label" class="stat-item">
        <strong>{{ item.value }}</strong>
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section class="news-section">
      <div class="section-heading">
        <p class="eyebrow">Latest</p>
        <h2>最新记录</h2>
      </div>

      <PublicContentState
        v-if="pending || error || !newsList.length"
        :pending="pending"
        :error="Boolean(error)"
        loading-message="正在加载新闻…"
        error-message="新闻暂时无法加载，请稍后重试。"
        empty-message="还没有新闻内容。"
        @retry="refresh()"
      />

      <div v-else class="news-list">
        <article v-for="item in newsList" :key="item.path" class="news-card">
          <NuxtLink class="news-card-main" :to="item.path">
            <span v-if="item.image" class="news-card-media">
              <img :src="item.image" :alt="item.title" loading="lazy">
            </span>
            <span class="news-card-copy">
              <span class="news-date">{{ formatDate(item.date) }}</span>
              <span v-if="item.requiresAuth" class="content-access-label">需登录</span>
              <h3>{{ item.title }}</h3>
              <span class="news-card-summary">{{ item.summary || item.description || '查看完整新闻内容。' }}</span>
            </span>
          </NuxtLink>

          <div v-if="item.tags?.length" class="news-tags">
            <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
          </div>
        </article>
      </div>

    </section>
  </main>
</template>
