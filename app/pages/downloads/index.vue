<script setup lang="ts">
type DownloadEntry = {
  name: string
  isDirectory: boolean
  size: number
  modified: string | null
  path: string
  downloadUrl: string | null
}

type DownloadListing = {
  path: string
  page: number
  total: number
  hasMore: boolean
  entries: DownloadEntry[]
}

useHead({
  title: '资料下载 | 山东理工大学 Vinci 机器人队',
  meta: [{ name: 'description', content: '浏览和下载 Vinci 机器人队公开资料。' }]
})

const route = useRoute()
const folderPath = computed(() => typeof route.query.path === 'string' ? route.query.path : '')
const pageNumber = computed(() => typeof route.query.page === 'string' ? route.query.page : '1')
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, error, status, refresh } = await useAsyncData(
  () => `downloads:${folderPath.value}:${pageNumber.value}`,
  () => requestFetch<DownloadListing>('/api/downloads', {
    query: { path: folderPath.value, page: pageNumber.value }
  }),
  { watch: [folderPath, pageNumber] }
)

const crumbs = computed(() => {
  const parts = folderPath.value.split('/').filter(Boolean)
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }))
})

const listingErrorMessage = computed(() => {
  const detail = error.value?.data
  return detail && typeof detail === 'object' && 'message' in detail
    && typeof detail.message === 'string'
    ? detail.message
    : '资料目录暂时无法读取，请稍后重试。'
})

const fileSize = (size: number) => {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

const modifiedDate = (value: string | null) => {
  if (!value) return '日期未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '日期未知'
    : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(date)
}
</script>

<template>
  <main>
    <section class="page-hero downloads-hero">
      <div>
        <p class="eyebrow">VINCI DOWNLOADS</p>
        <h1>资料下载</h1>
        <p>浏览 Vinci 机器人队公开的文件与资料。</p>
      </div>
    </section>

    <section class="downloads-section" aria-labelledby="downloads-title">
      <div class="downloads-heading">
        <div>
          <p class="eyebrow">FILES & RESOURCES</p>
          <h2 id="downloads-title">公开资料</h2>
        </div>
        <button class="downloads-refresh" type="button" :disabled="status === 'pending'" @click="refresh()">
          {{ status === 'pending' ? '正在更新…' : '更新列表' }}
        </button>
      </div>

      <nav class="downloads-breadcrumb" aria-label="资料目录路径">
        <NuxtLink to="/downloads">全部资料</NuxtLink>
        <template v-for="crumb in crumbs" :key="crumb.path">
          <span aria-hidden="true">/</span>
          <NuxtLink :to="{ path: '/downloads', query: { path: crumb.path } }">{{ crumb.name }}</NuxtLink>
        </template>
      </nav>

      <p v-if="status === 'pending' && !data" class="downloads-message" role="status">正在读取资料目录…</p>
      <p v-else-if="error" class="downloads-message downloads-error" role="alert">
        {{ listingErrorMessage }}
      </p>
      <p v-else-if="data && !data.entries.length" class="downloads-message">这个目录暂时没有文件。</p>

      <div v-if="data && !error && data.entries.length" class="downloads-list">
        <template v-for="entry in data.entries" :key="entry.path">
          <NuxtLink
            v-if="entry.isDirectory"
            class="downloads-item"
            :to="{ path: '/downloads', query: { path: entry.path } }"
          >
            <span class="downloads-icon" aria-hidden="true">▣</span>
            <span class="downloads-item-copy"><strong>{{ entry.name }}</strong><small>文件夹</small></span>
            <span class="downloads-arrow" aria-hidden="true">→</span>
          </NuxtLink>
          <a
            v-else-if="entry.downloadUrl"
            class="downloads-item"
            :href="entry.downloadUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="downloads-icon" aria-hidden="true">↓</span>
            <span class="downloads-item-copy"><strong>{{ entry.name }}</strong><small>{{ fileSize(entry.size) }} · {{ modifiedDate(entry.modified) }}</small></span>
            <span class="downloads-arrow" aria-hidden="true">↗</span>
          </a>
        </template>
      </div>

      <div v-if="data && !error && (data.page > 1 || data.hasMore)" class="downloads-pagination">
        <NuxtLink
          v-if="data.page > 1"
          :to="{ path: '/downloads', query: { ...(folderPath ? { path: folderPath } : {}), page: data.page - 1 } }"
        >上一页</NuxtLink>
        <span>第 {{ data.page }} 页</span>
        <NuxtLink
          v-if="data.hasMore"
          :to="{ path: '/downloads', query: { ...(folderPath ? { path: folderPath } : {}), page: data.page + 1 } }"
        >下一页</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.downloads-hero {
  background:
    linear-gradient(90deg, rgba(14, 26, 32, 0.92), rgba(14, 26, 32, 0.56)),
    url('https://cdn.sdutvinci.cn/site-assets/images/background_footer-03b5c48e.webp') center / cover;
}

.downloads-section {
  width: min(var(--content), calc(100% - 48px));
  min-height: 360px;
  margin: 76px auto 96px;
}

.downloads-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}

.downloads-refresh {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 16px;
  background: var(--surface);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.downloads-refresh:hover:not(:disabled) {
  border-color: var(--cyan);
  color: var(--cyan);
}

.downloads-refresh:disabled {
  cursor: wait;
  opacity: 0.6;
}

.downloads-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin: 28px 0 22px;
  color: var(--muted);
  font-size: 0.93rem;
}

.downloads-breadcrumb a {
  color: var(--cyan);
  font-weight: 750;
}

.downloads-breadcrumb a:hover {
  text-decoration: underline;
}

.downloads-list {
  display: grid;
  gap: 10px;
}

.downloads-item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 17px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 17px 20px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-soft);
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.downloads-item:hover,
.downloads-item:focus-visible {
  border-color: var(--cyan);
  transform: translateY(-2px);
}

.downloads-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: color-mix(in srgb, var(--cyan) 10%, var(--surface));
  color: var(--cyan);
  font-size: 1.2rem;
  font-weight: 900;
}

.downloads-item-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.downloads-item-copy strong {
  overflow-wrap: anywhere;
  font-size: 1rem;
}

.downloads-item-copy small {
  color: var(--muted);
  font-size: 0.84rem;
}

.downloads-arrow {
  margin-left: auto;
  color: var(--red-dark);
  font-size: 1.25rem;
}

.downloads-message {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 24px;
  background: var(--surface);
  color: var(--ink-soft);
}

.downloads-error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--line));
}

.downloads-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 28px;
  color: var(--muted);
}

.downloads-pagination a {
  color: var(--cyan);
  font-weight: 800;
}

@media (max-width: 620px) {
  .downloads-section {
    margin: 52px auto 72px;
  }

  .downloads-item {
    gap: 12px;
    padding: 15px;
  }
}
</style>
