<script setup lang="ts">
import type { CmsDraft } from '../../../../shared/types/cms-drafts'
import type { CmsArticleListResponse } from '../../../../shared/types/cms-articles'
import type { WikiDocumentTag } from '~~/shared/utils/wiki-tags'
import {
  isWikiDocumentIndexPath,
  WIKI_DOCUMENT_TAGS
} from '~~/shared/utils/wiki-tags'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
useHead({ title: '新建内容草稿 · Vinci 内容管理后台' })
const { csrfHeaders } = useCmsSession()
const form = reactive({
  title: '',
  collection: 'news' as 'news' | 'wiki',
  wikiContentType: 'document' as 'document' | 'chapter',
  directory: '',
  parentArticleId: '',
  filename: '',
  tags: [] as WikiDocumentTag[]
})
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data: wikiArticleData } = await useAsyncData(
  'cms:new:wiki-documents',
  () => requestFetch<CmsArticleListResponse>('/api/cms/articles', {
    query: { collection: 'wiki', status: 'published' }
  })
)
const wikiDocuments = computed(() => (wikiArticleData.value?.articles || [])
  .filter(article => isWikiDocumentIndexPath(article.relativePath) && !article.isDeleted))
const directoryEdited = ref(false)
const filenameEdited = ref(false)
const safeSegment = (value: string) => value
  .trim()
  .replace(/[\\/]+/g, '-')
  .replace(/\s+/g, '-')
  .replace(/^-+|-+$/g, '')

watch(() => form.title, (title) => {
  if (!directoryEdited.value) form.directory = safeSegment(title)
  if (!filenameEdited.value) form.filename = `${safeSegment(title) || '章节'}.md`
})

const plannedPath = computed(() => {
  if (form.collection !== 'wiki') return '发布时按新闻标题自动生成路径'
  if (form.wikiContentType === 'document') {
    return form.directory ? `wiki/${form.directory}/index.md` : '请填写一级资料目录'
  }
  const parent = wikiDocuments.value.find(article => article.id === form.parentArticleId)
  if (!parent) return '请先选择所属主文档'
  const directory = parent.relativePath.slice(0, -'/index.md'.length)
  return `wiki/${directory}/${form.filename || '章节.md'}`
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
        title: form.title,
        ...(form.collection === 'wiki' && form.wikiContentType === 'document'
          ? {
              wikiContentType: 'document',
              directory: form.directory,
              tags: form.tags
            }
          : {}),
        ...(form.collection === 'wiki' && form.wikiContentType === 'chapter'
          ? {
              wikiContentType: 'chapter',
              parentArticleId: form.parentArticleId,
              filename: form.filename.endsWith('.md') ? form.filename : `${form.filename}.md`
            }
          : {})
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
      <h1>新建内容草稿</h1>
      <p>Wiki 按“主文档 + 章节”创建；主文档对应一级目录的 index.md，章节必须关联主文档。</p>
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
      <fieldset v-if="form.collection === 'wiki'" class="cms-choice-fieldset">
        <legend>Wiki 内容类型</legend>
        <label class="cms-choice-card">
          <input v-model="form.wikiContentType" type="radio" value="document">
          <span><strong>主文档</strong><small>一套完整资料，对应一级目录 index.md，可设置组别标签。</small></span>
        </label>
        <label class="cms-choice-card">
          <input v-model="form.wikiContentType" type="radio" value="chapter">
          <span><strong>章节</strong><small>主文档下的一个页面，继承主文档分类，不单独设置标签。</small></span>
        </label>
      </fieldset>

      <template v-if="form.collection === 'wiki' && form.wikiContentType === 'document'">
        <label>
          <span>一级资料目录</span>
          <input
            v-model.trim="form.directory"
            required
            maxlength="200"
            placeholder="例如：2021-09-16-OpenWrt编译教学"
            @input="directoryEdited = true"
          >
          <small>主文档正文将保存为此目录下的 index.md；这才是前台 Wiki 的“大文章”。</small>
        </label>
        <fieldset class="cms-choice-fieldset">
          <legend>组别标签（可多选）</legend>
          <div class="cms-tag-choice-grid">
            <label v-for="tag in WIKI_DOCUMENT_TAGS" :key="tag" class="cms-tag-choice">
              <input v-model="form.tags" type="checkbox" :value="tag">
              <span>{{ tag }}</span>
            </label>
          </div>
          <small>不选择时会明确归入“未分类”；标签只写入主文档 index.md。</small>
        </fieldset>
      </template>

      <template v-if="form.collection === 'wiki' && form.wikiContentType === 'chapter'">
        <label>
          <span>所属 Wiki 主文档</span>
          <select v-model="form.parentArticleId" required>
            <option value="" disabled>请选择主文档</option>
            <option v-for="article in wikiDocuments" :key="article.id" :value="article.id">
              {{ article.title }} · {{ article.relativePath }}
            </option>
          </select>
          <small>这里只列出一级目录的 index.md；请先发布主文档，再为它添加章节。</small>
        </label>
        <label>
          <span>章节文件名</span>
          <input
            v-model.trim="form.filename"
            required
            maxlength="200"
            placeholder="例如：0100-准备环境.md"
            @input="filenameEdited = true"
          >
          <small>建议使用 0100、0200 等序号控制章节顺序；不能使用 index.md。</small>
        </label>
      </template>

      <p class="cms-planned-path"><strong>计划保存位置</strong><code>{{ plannedPath }}</code></p>
      <button class="cms-button cms-button-primary" :disabled="submitting">
        {{ submitting ? '正在创建…' : '创建并开始编辑' }}
      </button>
    </form>
  </section>
</template>
