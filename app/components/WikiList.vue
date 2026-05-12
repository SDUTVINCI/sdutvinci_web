<script setup lang="ts">
interface WikiListItem {
  path: string
  stem?: string
  title?: string
  date?: string
  chapter?: string
  chapterSort?: number
  docKey?: string
  docRoot?: string
  docTitle?: string
  isWikiDoc?: boolean
  isWikiIndex?: boolean
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

const props = withDefaults(defineProps<{
  limit?: number
}>(), {
  limit: Number.POSITIVE_INFINITY
})

const { data: wikis, pending } = await useAsyncData<WikiListItem[]>('wiki-list-meta', () =>
  queryCollection('wiki')
    .select(
      'path',
      'stem',
      'title',
      'date',
      'chapter',
      'chapterSort',
      'docKey',
      'docRoot',
      'docTitle',
      'isWikiDoc',
      'isWikiIndex',
      'wikiDepth'
    )
    .all() as Promise<WikiListItem[]>
)

const searchQuery = ref('')
const expandedDocs = ref(new Set<string>())

const wikiPages = computed(() => wikis.value ?? [])

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
          path: wiki.docRoot || wiki.path,
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
        depth: Math.max(0, (wiki.chapter || '').split('.').filter(Boolean).length - 1)
      })
    })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      chapters: group.chapters.sort(sortByChapter)
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

function sortByChapter(a: WikiListItem, b: WikiListItem) {
  return Number(a.chapterSort || 0) - Number(b.chapterSort || 0) ||
    String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
}

function isDocExpanded(doc: WikiDocGroup) {
  return Boolean(searchQuery.value.trim()) || expandedDocs.value.has(doc.key)
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

    <div v-else-if="filteredDocGroups.length" class="wiki-doc-list">
      <article v-for="doc in filteredDocGroups" :key="doc.key" class="wiki-doc-card">
        <header class="wiki-doc-header">
          <div class="wiki-doc-title-block">
            <NuxtLink :to="doc.path" class="wiki-doc-title">
              {{ doc.title }}
            </NuxtLink>
            <div class="wiki-doc-meta">
              <span>{{ doc.date || '未标注日期' }}</span>
              <span>{{ doc.chapters.length }} 个章节</span>
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

    <div v-else class="empty-state">
      {{ searchQuery ? '没有找到相关 Wiki。' : 'Wiki 还没有内容。' }}
    </div>
  </section>
</template>
