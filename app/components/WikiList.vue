<script setup lang="ts">
import type { PublicRestrictedWikiDocument } from '~~/shared/types/public-content'
import { compareWikiChapters, numberWikiChapters } from '~~/utils/wiki-chapters'

interface WikiListItem {
  path: string
  stem?: string
  title?: string
  date?: string
  chapter?: string
  chapterOrder?: string
  chapterDepth?: number
  docKey?: string
  docRoot?: string
  docTitle?: string
  isWikiDoc?: boolean
  isWikiIndex?: boolean
  requiresAuth?: boolean
  wikiDepth?: number
}

interface WikiDocGroup {
  key: string
  title: string
  path: string
  date?: string
  index: WikiListItem | null
  chapters: Array<WikiListItem & { depth: number }>
}

interface WikiListResponse {
  items: WikiListItem[]
  restrictedDocuments: PublicRestrictedWikiDocument[]
}

const props = withDefaults(defineProps<{
  limit?: number
}>(), {
  limit: Number.POSITIVE_INFINITY
})

const { data: wikiResponse, pending } = await usePublicContentQuery<WikiListResponse>({
  key: 'wiki-list-meta',
  database: requestFetch => requestFetch<WikiListResponse>('/api/v2/content/wiki')
})

const searchQuery = ref('')
const expandedDocs = ref(new Set<string>())

const wikiPages = computed(() => wikiResponse.value?.items ?? [])
const restrictedWikiDocuments = computed(() => (
  wikiResponse.value?.restrictedDocuments ?? []
))

const docGroups = computed<WikiDocGroup[]>(() => {
  const groups = new Map<string, WikiDocGroup>()

  wikiPages.value
    .filter((wiki) => wiki.isWikiDoc)
    .forEach((wiki) => {
      const key = wiki.docKey || wiki.docRoot || wiki.stem || wiki.path
      if (!key) return

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: wiki.docTitle || wiki.title || 'Wiki 文档',
          path: wiki.isWikiIndex ? (wiki.docRoot || wiki.path) : wiki.path,
          date: wiki.date,
          index: null,
          chapters: []
        })
      }

      const group = groups.get(key)
      if (!group) return

      if (wiki.date && (!group.date || wiki.date > group.date)) {
        group.date = wiki.date
      }

      if (wiki.isWikiIndex) {
        group.index = wiki
        group.title = wiki.title || wiki.docTitle || group.title
        group.path = wiki.path || wiki.docRoot || group.path
        group.date = wiki.date || group.date
        return
      }

      group.chapters.push({
        ...wiki,
        depth: wiki.chapterDepth || 0
      })
    })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      chapters: numberWikiChapters(group.chapters)
        .sort(compareWikiChapters)
        .map((chapter) => ({
          ...chapter,
          depth: chapter.chapterDepth
        }))
    }))
    .sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')) ||
      a.title.localeCompare(b.title, 'zh-CN')
    )
})

const filteredDocGroups = computed(() => {
  let list = docGroups.value
  const query = searchQuery.value.trim().toLowerCase()

  if (query) {
    list = list
      .map((doc) => {
        const docMatches = doc.title.toLowerCase().includes(query) ||
          String(doc.date || '').toLowerCase().includes(query)

        return {
          ...doc,
          chapters: docMatches
            ? doc.chapters
            : doc.chapters.filter((chapter) => matchesQuery(chapter, query))
        }
      })
      .filter((doc) => doc.title.toLowerCase().includes(query) || doc.chapters.length)
  }

  if (!query) {
    list = list.slice(0, props.limit)
  }

  return list
})

const restrictedDocKeys = computed(() => new Set(
  restrictedWikiDocuments.value.map(doc => doc.docKey)
))

const filteredLockedDocuments = computed(() => {
  const publicDocKeys = new Set(docGroups.value.map(doc => doc.key))
  const query = searchQuery.value.trim().toLowerCase()
  let list = restrictedWikiDocuments.value.filter(doc => !publicDocKeys.has(doc.docKey))

  if (query) {
    list = list.filter(doc => [doc.title, doc.date]
      .some(value => String(value || '').toLowerCase().includes(query)))
  } else {
    list = list.slice(0, props.limit)
  }

  return list
})

function isDocExpanded(doc: WikiDocGroup) {
  return Boolean(searchQuery.value.trim()) || expandedDocs.value.has(doc.key)
}

function articleCount(doc: WikiDocGroup) {
  return doc.chapters.length + (doc.index ? 1 : 0)
}

function hasRestrictedArticles(doc: WikiDocGroup) {
  return restrictedDocKeys.value.has(doc.key)
    || Boolean(doc.index?.requiresAuth || doc.chapters.some(item => item.requiresAuth))
}

function toggleDoc(key: string) {
  const next = new Set(expandedDocs.value)

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  expandedDocs.value = next
}

function matchesQuery(wiki: WikiListItem, query: string) {
  return [
    wiki.title,
    wiki.chapter,
    wiki.date,
    wiki.path
  ].some((value) => String(value || '').toLowerCase().includes(query))
}
</script>

<template>
  <section class="wiki-list">
    <label class="wiki-search-box">
      <span>搜索 Wiki 或章节</span>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="输入教程名、章节名或路径"
        class="wiki-search-input"
      >
    </label>

    <div v-if="pending" class="wiki-loading">正在扫描 Wiki...</div>

    <template v-else>
      <div v-if="filteredDocGroups.length" class="wiki-doc-list">
        <article v-for="doc in filteredDocGroups" :key="doc.key" class="wiki-doc-card">
          <header class="wiki-doc-header">
            <div class="wiki-doc-title-block">
              <NuxtLink :to="doc.path" class="wiki-doc-title">
                {{ doc.title }}
              </NuxtLink>
              <div class="wiki-doc-meta">
                <span>{{ doc.date || '未标注日期' }}</span>
                <span>{{ articleCount(doc) }} 篇文章</span>
                <span v-if="hasRestrictedArticles(doc)" class="content-access-label">含需登录文章</span>
              </div>
            </div>

            <button
              v-if="doc.chapters.length"
              class="wiki-doc-toggle"
              type="button"
              :aria-expanded="isDocExpanded(doc)"
              @click="toggleDoc(doc.key)"
            >
              {{ isDocExpanded(doc) ? '收起章节' : '查看全部章节' }}
            </button>
          </header>

          <ol v-if="doc.chapters.length && isDocExpanded(doc)" class="wiki-chapter-list">
            <li
              v-for="chapter in doc.chapters"
              :key="chapter.path"
              class="wiki-chapter-item"
              :style="{ '--chapter-depth': String(chapter.depth) }"
            >
              <NuxtLink :to="chapter.path" class="wiki-chapter-link">
                <span v-if="chapter.chapter" class="wiki-chapter-number">{{ chapter.chapter }}</span>
                <span>{{ chapter.title || '无标题' }}</span>
              </NuxtLink>
            </li>
          </ol>
        </article>
      </div>

      <section
        v-if="filteredLockedDocuments.length"
        class="wiki-locked-section"
        aria-labelledby="wiki-locked-title"
      >
        <div class="wiki-locked-heading">
          <div>
            <p class="eyebrow">Members Only</p>
            <h3 id="wiki-locked-title">队内资料</h3>
          </div>
          <p>以下 Wiki 需要成员登录后查看，未登录时不展示章节标题、数量或正文。</p>
        </div>

        <div class="wiki-locked-list">
          <NuxtLink
            v-for="lockedDoc in filteredLockedDocuments"
            :key="lockedDoc.docKey"
            :to="{ path: '/cms/login', query: { redirect: lockedDoc.path } }"
            class="wiki-locked-card"
          >
            <span class="wiki-locked-icon" aria-hidden="true">锁</span>
            <span>
              <strong>{{ lockedDoc.title }}</strong>
              <small>需登录查看</small>
            </span>
            <span class="wiki-locked-arrow" aria-hidden="true">→</span>
          </NuxtLink>
        </div>
      </section>

      <div
        v-if="!filteredDocGroups.length && !filteredLockedDocuments.length"
        class="empty-state"
      >
        {{ searchQuery ? '没有找到相关 Wiki。' : 'Wiki 还没有内容。' }}
      </div>
    </template>
  </section>
</template>
