<script setup lang="ts">
import type {
  CmsArticleCollection,
  CmsArticleListResponse,
  CmsArticleVisibilityUpdateResult
} from '../../../../shared/types/cms-articles'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '文章 · Vinci 内容管理后台' })

const search = ref('')
const route = useRoute()
const { session, csrfHeaders } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const collection = ref<'' | CmsArticleCollection>('')
const directory = ref('')
const access = ref<'' | 'public' | 'restricted'>('')
const appliedSearch = ref('')
const articleStatus = ref<'published' | 'deleted' | 'all'>(
  isAdmin.value && (route.query.status === 'deleted' || route.query.status === 'all')
    ? route.query.status
    : 'published'
)

const query = computed(() => ({
  q: appliedSearch.value || undefined,
  collection: collection.value || undefined,
  directory: directory.value || undefined,
  access: access.value || undefined,
  status: articleStatus.value
}))
const { data, status, error, refresh } = await useFetch<CmsArticleListResponse>(
  '/api/cms/articles',
  { query }
)

const applySearch = () => {
  appliedSearch.value = search.value.trim()
}

const articles = computed(() => data.value?.articles ?? [])
const selectedArticleIds = ref<string[]>([])
const visibilityBusy = ref(false)
const visibilityBusyId = ref('')
const visibilityMessage = ref('')
const visibilityError = ref('')
const eligibleArticles = computed(() => articles.value.filter(article => !article.isDeleted))
const allEligibleSelected = computed(() => eligibleArticles.value.length > 0
  && eligibleArticles.value.every(article => selectedArticleIds.value.includes(article.id)))

watch(articles, (items) => {
  const validIds = new Set(items.filter(article => !article.isDeleted).map(article => article.id))
  selectedArticleIds.value = selectedArticleIds.value.filter(id => validIds.has(id))
})

const toggleAllEligible = () => {
  selectedArticleIds.value = allEligibleSelected.value
    ? []
    : eligibleArticles.value.map(article => article.id)
}

const saveVisibility = async (articleIds: string[], requiresAuth: boolean) => {
  const response = await $fetch<{ result: CmsArticleVisibilityUpdateResult }>(
    '/api/cms/articles/visibility',
    {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: { articleIds, requiresAuth }
    }
  )
  return response.result
}

const applyBatchVisibility = async (requiresAuth: boolean) => {
  if (!selectedArticleIds.value.length) return
  const label = requiresAuth ? '需登录' : '未登录可见'
  if (!window.confirm(`确定把选中的 ${selectedArticleIds.value.length} 篇文章设为“${label}”吗？`)) return

  visibilityBusy.value = true
  visibilityMessage.value = ''
  visibilityError.value = ''
  try {
    const result = await saveVisibility(selectedArticleIds.value, requiresAuth)
    visibilityMessage.value = `访问权限已更新：${result.updatedIds.length} 篇改为${label}，${result.unchangedIds.length} 篇无需变更。`
    selectedArticleIds.value = []
    await refresh()
  } catch (error: any) {
    visibilityError.value = error?.data?.message || '批量更新访问权限失败'
  } finally {
    visibilityBusy.value = false
  }
}

const toggleArticleVisibility = async (articleId: string, requiresAuth: boolean) => {
  visibilityBusyId.value = articleId
  visibilityMessage.value = ''
  visibilityError.value = ''
  try {
    await saveVisibility([articleId], requiresAuth)
    visibilityMessage.value = `文章已设为${requiresAuth ? '需登录' : '未登录可见'}。`
    await refresh()
  } catch (error: any) {
    visibilityError.value = error?.data?.message || '更新文章访问权限失败'
  } finally {
    visibilityBusyId.value = ''
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">ARTICLES</p>
        <h1>文章与草稿</h1>
        <p>当前索引 {{ data?.total ?? 0 }} 篇正式文章。编辑只保存草稿，不影响前台。</p>
      </div>
      <NuxtLink class="cms-button cms-button-primary cms-button-link" to="/cms/articles/new">
        新建文章草稿
      </NuxtLink>
    </header>

    <form class="cms-toolbar cms-articles-toolbar" @submit.prevent="applySearch">
      <label>
        <span>搜索标题、路径和正文</span>
        <input v-model="search" type="search" placeholder="输入关键词">
      </label>
      <label v-if="isAdmin">
        <span>文章状态</span>
        <select v-model="articleStatus">
          <option value="published">已发布</option>
          <option value="deleted">已删除</option>
          <option value="all">全部</option>
        </select>
      </label>
      <label>
        <span>内容集合</span>
        <select v-model="collection" @change="directory = ''">
          <option value="">全部</option>
          <option value="news">新闻</option>
          <option value="wiki">Wiki</option>
        </select>
      </label>
      <label>
        <span>目录</span>
        <select v-model="directory">
          <option value="">全部目录</option>
          <option
            v-for="item in data?.directories ?? []"
            :key="item"
            :value="item"
          >
            {{ item }}
          </option>
        </select>
      </label>
      <label>
        <span>访问权限</span>
        <select v-model="access">
          <option value="">全部权限</option>
          <option value="public">未登录可见</option>
          <option value="restricted">需登录</option>
        </select>
      </label>
      <button class="cms-button cms-button-primary" type="submit">搜索</button>
    </form>

    <section v-if="isAdmin" class="cms-article-access-panel" aria-label="批量设置文章访问权限">
      <div>
        <p class="cms-eyebrow">ACCESS CONTROL</p>
        <strong>批量设置访问权限</strong>
        <span>默认未登录可见；选择当前筛选结果后可一次调整多篇文章。</span>
      </div>
      <div class="cms-article-access-actions">
        <button
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="!eligibleArticles.length || visibilityBusy"
          @click="toggleAllEligible"
        >{{ allEligibleSelected ? '取消全选当前结果' : '全选当前结果' }}</button>
        <button
          class="cms-button cms-button-quiet"
          type="button"
          :disabled="!selectedArticleIds.length || visibilityBusy"
          @click="applyBatchVisibility(false)"
        >设为未登录可见（{{ selectedArticleIds.length }}）</button>
        <button
          class="cms-button cms-button-primary"
          type="button"
          :disabled="!selectedArticleIds.length || visibilityBusy"
          @click="applyBatchVisibility(true)"
        >设为需登录（{{ selectedArticleIds.length }}）</button>
      </div>
    </section>

    <p v-if="visibilityMessage" class="cms-alert" role="status">{{ visibilityMessage }}</p>
    <p v-if="visibilityError" class="cms-alert cms-alert-error" role="alert">{{ visibilityError }}</p>

    <p v-if="status === 'pending'" class="cms-muted">正在扫描内容…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message }}</p>
    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th v-if="isAdmin">选择</th>
            <th>标题</th>
            <th>集合</th>
            <th>目录</th>
            <th>源文件</th>
            <th>状态</th>
            <th>访问权限</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="article in data?.articles ?? []" :key="article.id">
            <td v-if="isAdmin">
              <input
                v-model="selectedArticleIds"
                type="checkbox"
                :value="article.id"
                :disabled="article.isDeleted || visibilityBusy"
                :aria-label="`选择文章：${article.title}`"
              >
            </td>
            <td><NuxtLink :to="`/cms/articles/${article.id}`">{{ article.title }}</NuxtLink></td>
            <td><span class="cms-badge">{{ article.collection }}</span></td>
            <td>{{ article.directory }}</td>
            <td><code>{{ article.relativePath }}</code></td>
            <td>
              <span class="cms-badge" :class="{ 'cms-badge-danger': article.isDeleted }">
                {{ article.isDeleted ? '已删除' : '已发布' }}
              </span>
            </td>
            <td>
              <button
                v-if="isAdmin && !article.isDeleted"
                class="cms-visibility-toggle"
                type="button"
                :aria-label="`${article.title}当前${article.requiresAuth ? '需登录' : '未登录可见'}，点击切换`"
                :aria-pressed="article.requiresAuth"
                :disabled="visibilityBusy || visibilityBusyId === article.id"
                @click="toggleArticleVisibility(article.id, !article.requiresAuth)"
              >
                <span :class="{ 'is-active': !article.requiresAuth }">公开</span>
                <span :class="{ 'is-active': article.requiresAuth }">需登录</span>
              </button>
              <span
                v-else
                class="cms-badge"
                :class="{ 'cms-badge-danger': article.requiresAuth }"
              >{{ article.requiresAuth ? '需登录' : '未登录可见' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.articles.length" class="cms-empty">没有符合条件的文章。</p>
    </div>
  </section>
</template>
