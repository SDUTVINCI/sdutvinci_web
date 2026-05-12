<script setup lang="ts">
type NewsItem = Record<string, any>

useHead({
  title: '新闻 | 山东理工大学 Vinci 机器人队'
})

const { data: rawNews } = await useAsyncData<NewsItem[]>('news:list', () =>
  queryCollection('news').all() as Promise<NewsItem[]>
)

const newsList = computed(() =>
  [...(rawNews.value ?? [])].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
)

const formatDate = (value: unknown) => {
  const text = String(value ?? '')
  if (!text) return '未标注日期'

  return text.replace(/-/g, '.')
}

const stats = computed(() => [
  { value: newsList.value.length, label: '新闻记录' },
  { value: newsList.value[0]?.date ? formatDate(newsList.value[0].date) : '持续更新', label: '最近更新' },
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

      <div v-if="newsList.length" class="news-list">
        <article v-for="item in newsList" :key="item.path" class="news-card">
          <NuxtLink class="news-card-main" :to="item.path">
            <span class="news-date">{{ formatDate(item.date) }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.summary || item.description || '查看完整新闻内容。' }}</p>
          </NuxtLink>

          <div v-if="item.tags?.length" class="news-tags">
            <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">还没有新闻内容。</div>
    </section>
  </main>
</template>
