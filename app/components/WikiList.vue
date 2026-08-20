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
    .filter(wiki => wiki.isWikiDoc)
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
    .map(group => ({
      ...group,
      chapters: numberWikiChapters(group.chapters)
        .sort(compareWikiChapters)
        .map(chapter => ({
          ...chapter,
          depth: chapter.chapterDepth
        }))
    }))
    .sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
      || a.title.localeCompare(b.title, 'zh-CN')
    )
})

const filteredDocGroups = computed(() => {
  let list = docGroups.value
  const query = searchQuery.value.trim().toLowerCase()

  if (query) {
    list = list
      .map((doc) => {
        const docMatches = doc.title.toLowerCase().includes(query)
          || String(doc.date || '').toLowerCase().includes(query)

        return {
          ...doc,
          chapters: docMatches
            ? doc.chapters
            : doc.chapters.filter(chapter => matchesQuery(chapter, query))
        }
      })
      .filter(doc => doc.title.toLowerCase().includes(query)
        || String(doc.date || '').toLowerCase().includes(query)
        || doc.chapters.length)
  }

  if (!query) {
    list = list.slice(0, props.limit)
  }

  return list
})

const restrictedDocKeys = computed(() => new Set(
  restrictedWikiDocuments.value.map(doc => doc.docKey)
))

const restrictedDocumentByKey = computed(() => new Map(
  restrictedWikiDocuments.value.map(doc => [doc.docKey, doc])
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
  const query = searchQuery.value.trim().toLowerCase()
  const docMatches = doc.title.toLowerCase().includes(query)
    || String(doc.date || '').toLowerCase().includes(query)
  return expandedDocs.value.has(doc.key) || Boolean(query && !docMatches)
}

function articleCount(doc: WikiDocGroup) {
  return doc.chapters.length + (doc.index ? 1 : 0)
}

function hasAnonymousRestrictedArticles(doc: WikiDocGroup) {
  return restrictedDocKeys.value.has(doc.key)
}

function restrictedLoginPath(doc: WikiDocGroup) {
  return restrictedDocumentByKey.value.get(doc.key)?.path || doc.path
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
  return [wiki.title, wiki.chapter, wiki.date, wiki.path]
    .some(value => String(value || '').toLowerCase().includes(query))
}
</script>

<template>
  <section class="wiki-list">
    <div class="wiki-directory-toolbar">
      <div class="wiki-directory-copy">
        <strong>文档导航</strong>
        <span>搜索教程、公开章节或路径</span>
      </div>
      <label class="wiki-search-box">
        <WikiIcon name="search" />
        <input
          v-model="searchQuery"
          type="search"
          aria-label="搜索 Wiki 或章节"
          placeholder="搜索 Wiki 或章节"
          class="wiki-search-input"
        >
      </label>
    </div>

    <div v-if="!pending" class="wiki-result-summary" aria-live="polite">
      <span>当前显示 {{ filteredDocGroups.length + filteredLockedDocuments.length }} 份文档</span>
      <span v-if="filteredLockedDocuments.length">
        {{ filteredLockedDocuments.length }} 份完整文档登录后可见
      </span>
    </div>

    <div v-if="pending" class="wiki-loading">正在扫描 Wiki...</div>

    <template v-else>
      <section
        v-if="filteredLockedDocuments.length"
        class="wiki-member-shelf"
        aria-labelledby="wiki-locked-title"
      >
        <header class="wiki-member-shelf-heading">
          <div class="wiki-member-shelf-title">
            <span class="wiki-member-shelf-icon" aria-hidden="true">
              <WikiIcon name="lock" />
            </span>
            <div>
              <p>成员资料</p>
              <h3 id="wiki-locked-title">登录后可查看的 Wiki</h3>
            </div>
          </div>
          <p>文档标题公开展示，章节目录与正文仅向已登录成员开放。</p>
        </header>

        <div class="wiki-member-list">
          <NuxtLink
            v-for="lockedDoc in filteredLockedDocuments"
            :key="lockedDoc.docKey"
            :to="{ path: '/cms/login', query: { redirect: lockedDoc.path } }"
            class="wiki-member-card"
          >
            <span class="wiki-member-card-icon" aria-hidden="true">
              <WikiIcon name="document" />
            </span>
            <span class="wiki-member-card-copy">
              <strong>{{ lockedDoc.title }}</strong>
              <small>完整文档仅限成员</small>
            </span>
            <span class="wiki-member-card-action">
              登录查看
              <WikiIcon name="arrow" />
            </span>
          </NuxtLink>
        </div>
      </section>

      <section
        v-if="filteredDocGroups.length"
        class="wiki-public-directory"
        aria-labelledby="wiki-public-title"
      >
        <header class="wiki-public-heading">
          <div>
            <p>公开资料</p>
            <h3 id="wiki-public-title">知识文档</h3>
          </div>
          <span>{{ filteredDocGroups.length }} 份文档</span>
        </header>

        <div class="wiki-doc-list">
          <article
            v-for="doc in filteredDocGroups"
            :key="doc.key"
            class="wiki-doc-card"
            :class="{
              'is-expanded': isDocExpanded(doc),
              'has-member-content': hasAnonymousRestrictedArticles(doc)
            }"
          >
            <header class="wiki-doc-header">
              <span class="wiki-doc-icon" aria-hidden="true">
                <WikiIcon name="document" />
              </span>
              <div class="wiki-doc-title-block">
                <div class="wiki-doc-title-line">
                  <NuxtLink :to="doc.path" class="wiki-doc-title">
                    {{ doc.title }}
                  </NuxtLink>
                  <span
                    v-if="hasAnonymousRestrictedArticles(doc)"
                    class="wiki-doc-access-badge"
                  >
                    部分内容需登录
                  </span>
                </div>
                <div class="wiki-doc-meta">
                  <span>{{ doc.date || '未标注日期' }}</span>
                  <span>{{ articleCount(doc) }} 篇可浏览文章</span>
                </div>
              </div>

              <button
                v-if="doc.chapters.length"
                class="wiki-doc-toggle"
                type="button"
                :aria-expanded="isDocExpanded(doc)"
                @click="toggleDoc(doc.key)"
              >
                {{ isDocExpanded(doc) ? '收起' : '章节' }}
                <WikiIcon name="chevron" />
              </button>
              <NuxtLink v-else :to="doc.path" class="wiki-doc-open" aria-label="打开文档">
                <WikiIcon name="arrow" />
              </NuxtLink>
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

            <NuxtLink
              v-if="hasAnonymousRestrictedArticles(doc)"
              :to="{ path: '/cms/login', query: { redirect: restrictedLoginPath(doc) } }"
              class="wiki-partial-access"
            >
              <span class="wiki-partial-access-icon" aria-hidden="true">
                <WikiIcon name="lock" />
              </span>
              <span>
                <strong>部分内容仅限成员</strong>
                <small>登录后查看完整目录</small>
              </span>
              <span class="wiki-partial-access-action">
                登录
                <WikiIcon name="arrow" />
              </span>
            </NuxtLink>
          </article>
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
