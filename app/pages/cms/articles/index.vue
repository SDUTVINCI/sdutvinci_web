<script setup lang="ts">
import type {
  CmsArticleCollection,
  CmsArticleListResponse
} from '../../../../shared/types/cms-articles'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '文章 · Vinci 内容管理后台' })

const search = ref('')
const collection = ref<'' | CmsArticleCollection>('')
const directory = ref('')
const appliedSearch = ref('')

const query = computed(() => ({
  q: appliedSearch.value || undefined,
  collection: collection.value || undefined,
  directory: directory.value || undefined
}))
const { data, status, error, refresh } = await useFetch<CmsArticleListResponse>(
  '/api/cms/articles',
  { query }
)

const applySearch = () => {
  appliedSearch.value = search.value.trim()
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header">
      <p class="cms-eyebrow">ARTICLES</p>
      <h1>文章只读管理</h1>
      <p>当前索引 {{ data?.total ?? 0 }} 篇文章。这里不会修改 Markdown 或执行 Git 操作。</p>
    </header>

    <form class="cms-toolbar" @submit.prevent="applySearch">
      <label>
        <span>搜索标题、路径和正文</span>
        <input v-model="search" type="search" placeholder="输入关键词">
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
      <button class="cms-button cms-button-primary" type="submit">搜索</button>
    </form>

    <p v-if="status === 'pending'" class="cms-muted">正在扫描内容…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message }}</p>
    <div v-else class="cms-table-wrap">
      <table class="cms-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>集合</th>
            <th>目录</th>
            <th>源文件</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="article in data?.articles ?? []" :key="article.id">
            <td><NuxtLink :to="`/cms/articles/${article.id}`">{{ article.title }}</NuxtLink></td>
            <td><span class="cms-badge">{{ article.collection }}</span></td>
            <td>{{ article.directory }}</td>
            <td><code>{{ article.relativePath }}</code></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!data?.articles.length" class="cms-empty">没有符合条件的文章。</p>
    </div>
  </section>
</template>
