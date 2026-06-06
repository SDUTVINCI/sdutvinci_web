<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import mediumZoom from 'medium-zoom'

interface TocDisplayLink {
  id: string
  text: string
  depth: number
  level: number
  number: string
}

interface WikiPage {
  path: string
  stem?: string
  title: string
  date?: string
  chapter?: string
  chapterSort?: number
  docKey?: string
  docRoot?: string
  docTitle?: string
  isWikiDoc?: boolean
  isWikiIndex?: boolean
  body?: unknown
  [key: string]: unknown
}

const route = useRoute()
const cleanPath = computed(() => route.path.replace(/\/$/, '') || '/')

const { data: page, pending } = await useAsyncData<WikiPage | null>(
  computed(() => `wiki-page-${cleanPath.value}`),
  () => queryCollection('wiki').path(cleanPath.value).first() as Promise<WikiPage | null>,
  { watch: [cleanPath] }
)

if (!pending.value && !page.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Wiki 页面不存在',
    fatal: true
  })
}

const pageDocKey = computed(() => page.value?.docKey || '')

const { data: docItems } = await useAsyncData<WikiPage[]>(
  computed(() => `wiki-doc-items-${pageDocKey.value || cleanPath.value}`),
  async () => {
    const docKey = page.value?.docKey

    if (!docKey) {
      return []
    }

    return await queryCollection('wiki')
      .where('docKey', '=', docKey)
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
        'isWikiIndex'
      )
      .all() as WikiPage[]
  },
  { watch: [pageDocKey] }
)

const docIndex = computed(() => docItems.value?.find((item) => item.isWikiIndex) || null)
const chapterItems = computed(() =>
  (docItems.value || [])
    .filter((item) => !item.isWikiIndex)
    .sort(sortByChapter)
)
const docNavigationItems = computed(() => [
  ...(docIndex.value ? [docIndex.value] : []),
  ...chapterItems.value
])

const currentNavIndex = computed(() =>
  docNavigationItems.value.findIndex((item) => normalizePath(item.path) === normalizePath(cleanPath.value))
)

const previousPage = computed(() => {
  const index = currentNavIndex.value
  return index > 0 ? docNavigationItems.value[index - 1] : null
})

const nextPage = computed(() => {
  const index = currentNavIndex.value
  return index >= 0 && index < docNavigationItems.value.length - 1
    ? docNavigationItems.value[index + 1]
    : null
})

const docTitle = computed(() =>
  docIndex.value?.title || page.value?.docTitle || page.value?.title || 'Wiki'
)

const pageTitle = computed(() => {
  if (!page.value) return '加载中...'
  return page.value.chapter ? `${page.value.chapter} ${page.value.title}` : page.value.title
})

useHead(() => ({
  title: `${pageTitle.value} | Vinci Wiki`,
  meta: [
    { name: 'description', content: page.value?.title || '' },
    { property: 'og:title', content: pageTitle.value }
  ]
}))

const showDocNav = ref(false)
const showToc = ref(false)
const activeHeadingId = ref('')
const readingProgress = ref(0)
const tocLinks = ref<TocDisplayLink[]>([])
const defaultHeadingScrollOffset = 108
const pendingAnchorId = ref('')
const scrollRetryTimers: ReturnType<typeof setTimeout>[] = []
const imageLoadCleanupFns: Array<() => void> = []
const anchorSettleDelays = [820, 1300, 2100]
let headingScrollOffset = defaultHeadingScrollOffset
let headingElements: HTMLElement[] = []
let zoomInstance: ReturnType<typeof mediumZoom> | null = null
let viewportSyncFrame: number | null = null
let contentResizeObserver: ResizeObserver | null = null

const hasMobileDrawer = computed(() => showDocNav.value || showToc.value)

const syncHeadingScrollOffset = () => {
  const heading = document.querySelector('.wiki-content-body h2, .wiki-content-body h3, .wiki-content-body h4, .wiki-content-body h5, .wiki-content-body h6') as HTMLElement | null
  const offset = heading
    ? Number.parseFloat(window.getComputedStyle(heading).scrollMarginTop)
    : NaN

  headingScrollOffset = Number.isFinite(offset) ? offset : defaultHeadingScrollOffset
}

const updateReadingProgress = () => {
  const trackLength = document.documentElement.scrollHeight - window.innerHeight
  if (trackLength <= 0) {
    readingProgress.value = 0
    return
  }

  readingProgress.value = Math.min(100, Math.max(0, (window.scrollY / trackLength) * 100))
}

const updateActiveHeading = () => {
  if (!tocLinks.value.length || !headingElements.length) return

  const scrollPosition = window.scrollY + headingScrollOffset
  let active = ''

  for (const heading of headingElements) {
    if (heading.offsetTop <= scrollPosition) {
      active = heading.id
      continue
    }

    break
  }

  activeHeadingId.value = active
}

const updateViewportState = () => {
  updateReadingProgress()
  updateActiveHeading()
}

const scheduleViewportSync = () => {
  if (viewportSyncFrame !== null) return

  viewportSyncFrame = window.requestAnimationFrame(() => {
    viewportSyncFrame = null
    updateViewportState()
  })
}

const clearViewportSyncFrame = () => {
  if (viewportSyncFrame === null) return

  window.cancelAnimationFrame(viewportSyncFrame)
  viewportSyncFrame = null
}

const buildTocFromDom = () => {
  const headings = Array.from(
    document.querySelectorAll('.wiki-content-body h2, .wiki-content-body h3, .wiki-content-body h4, .wiki-content-body h5, .wiki-content-body h6')
  ) as HTMLElement[]

  headingElements = headings
  const result: TocDisplayLink[] = []
  const counters: number[] = []
  let previousTagLevel = 0
  let previousLogicalLevel = 1

  headings.forEach((heading) => {
    if (!heading.id) return

    const tagLevel = Number(heading.tagName.slice(1))
    if (!Number.isFinite(tagLevel)) return

    let logicalLevel = 1
    if (previousTagLevel === 0) {
      logicalLevel = 1
    } else if (tagLevel > previousTagLevel) {
      logicalLevel = Math.min(previousLogicalLevel + 1, 5)
    } else if (tagLevel === previousTagLevel) {
      logicalLevel = previousLogicalLevel
    } else {
      logicalLevel = Math.max(1, previousLogicalLevel - (previousTagLevel - tagLevel))
    }

    counters[logicalLevel - 1] = (counters[logicalLevel - 1] || 0) + 1
    counters.length = logicalLevel

    const cloned = heading.cloneNode(true) as HTMLElement
    cloned.querySelectorAll('.heading-number').forEach((node) => node.remove())

    result.push({
      id: heading.id,
      text: (cloned.textContent || '').trim(),
      depth: tagLevel,
      level: logicalLevel,
      number: counters.join('.')
    })

    previousTagLevel = tagLevel
    previousLogicalLevel = logicalLevel
  })

  tocLinks.value = result
}

const applyHeadingDecorations = () => {
  const headingMap = new Map(tocLinks.value.map((item) => [item.id, item.number]))

  headingElements.forEach((element) => {
    const number = headingMap.get(element.id)

    element.querySelector('.heading-number')?.remove()
    if (!number) return

    const numberSpan = document.createElement('span')
    numberSpan.className = 'heading-number'
    numberSpan.textContent = `${number} `
    numberSpan.setAttribute('aria-hidden', 'true')
    element.prepend(numberSpan)
  })
}

const enhanceCodeBlocks = () => {
  const codeBlocks = document.querySelectorAll('.wiki-content-body pre') as NodeListOf<HTMLElement>

  codeBlocks.forEach((block) => {
    if (block.querySelector('.code-toolbar')) return

    const code = block.querySelector('code')
    const classes = [
      ...Array.from(block.classList),
      ...(code ? Array.from(code.classList) : [])
    ]
    const langClass = classes.find((className) => className.startsWith('language-'))
    const language = langClass ? langClass.replace('language-', '').toUpperCase() : 'CODE'

    const toolbar = document.createElement('div')
    toolbar.className = 'code-toolbar'

    const langLabel = document.createElement('span')
    langLabel.className = 'code-language'
    langLabel.textContent = language
    toolbar.appendChild(langLabel)

    const copyButton = document.createElement('button')
    copyButton.className = 'code-copy-btn'
    copyButton.type = 'button'
    copyButton.textContent = '复制'

    copyButton.addEventListener('click', async () => {
      const text = code?.textContent || ''

      try {
        await navigator.clipboard.writeText(text)
        copyButton.textContent = '已复制'
        copyButton.classList.add('copied')
        setTimeout(() => {
          copyButton.textContent = '复制'
          copyButton.classList.remove('copied')
        }, 1800)
      } catch (error) {
        console.error('复制失败:', error)
      }
    })

    toolbar.appendChild(copyButton)
    block.insertBefore(toolbar, block.firstChild)
  })
}

const enhanceTables = () => {
  const tables = document.querySelectorAll('.wiki-content-body table') as NodeListOf<HTMLTableElement>

  tables.forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return

    const wrapper = document.createElement('div')
    wrapper.className = 'table-scroll'
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })
}

const initImageZoom = () => {
  if (zoomInstance) {
    zoomInstance.detach()
  }

  zoomInstance = mediumZoom('.wiki-content-body img', {
    margin: 24,
    background: 'rgba(0, 0, 0, 0.8)',
    scrollOffset: 0
  })
}

const getHeadingTargetTop = (id: string) => {
  const element = document.getElementById(id)
  if (!element) return null

  return Math.max(0, element.getBoundingClientRect().top + window.scrollY - headingScrollOffset)
}

const scrollHeadingIntoView = (id: string, behavior: ScrollBehavior = 'smooth') => {
  const element = document.getElementById(id)
  if (!element) return false

  element.scrollIntoView({ behavior, block: 'start', inline: 'nearest' })
  return true
}

const clearAnchorSettleTimers = () => {
  scrollRetryTimers.forEach((timer) => clearTimeout(timer))
  scrollRetryTimers.length = 0
}

const clearImageLoadListeners = () => {
  imageLoadCleanupFns.forEach((fn) => fn())
  imageLoadCleanupFns.length = 0
}

const correctHeadingPosition = (id: string) => {
  const top = getHeadingTargetTop(id)
  if (top === null) return false

  if (Math.abs(window.scrollY - top) > 4) {
    window.scrollTo({ top, behavior: 'auto' })
    updateViewportState()
    return true
  }

  updateViewportState()
  return false
}

const warmImagesBeforeHeading = async (id: string) => {
  const headingTop = getHeadingTargetTop(id)
  if (headingTop === null) return

  const images = Array.from(document.querySelectorAll('.wiki-content-body img')) as HTMLImageElement[]
  const pendingImages = images.filter((image) => {
    const imageTop = image.getBoundingClientRect().top + window.scrollY
    return imageTop < headingTop && !image.complete
  })

  if (!pendingImages.length) return

  await Promise.race([
    Promise.allSettled(pendingImages.map((image) => {
      image.loading = 'eager'

      if (image.decode) {
        return image.decode().catch(() => undefined)
      }

      return new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })
    })),
    new Promise((resolve) => setTimeout(resolve, 900))
  ])
}

const scheduleAnchorSettle = (id: string) => {
  clearAnchorSettleTimers()

  anchorSettleDelays.forEach((delay) => {
    const timer = setTimeout(() => {
      if (pendingAnchorId.value !== id) return
      correctHeadingPosition(id)
    }, delay)
    scrollRetryTimers.push(timer)
  })

  const doneTimer = setTimeout(() => {
    if (pendingAnchorId.value === id) {
      pendingAnchorId.value = ''
    }
  }, anchorSettleDelays[anchorSettleDelays.length - 1] + 500)
  scrollRetryTimers.push(doneTimer)
}

const decodeAnchorHash = (hash: string) => {
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash
  if (!rawHash) return ''

  try {
    return decodeURIComponent(rawHash)
  } catch {
    return rawHash
  }
}

const updateUrlHash = (id: string) => {
  const nextHash = `#${encodeURIComponent(id)}`
  if (window.location.hash === nextHash) return

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${nextHash}`
  )
}

const navigateToHeading = (
  id: string,
  behavior: ScrollBehavior = 'smooth',
  shouldUpdateHash = false
) => {
  clearAnchorSettleTimers()
  pendingAnchorId.value = id

  if (getHeadingTargetTop(id) === null) {
    pendingAnchorId.value = ''
    return false
  }

  if (shouldUpdateHash) {
    updateUrlHash(id)
  }

  warmImagesBeforeHeading(id).finally(() => {
    if (pendingAnchorId.value !== id) return
    scrollHeadingIntoView(id, behavior)
    scheduleAnchorSettle(id)
  })

  return true
}

const scrollToCurrentHash = (behavior: ScrollBehavior = 'auto') => {
  const id = decodeAnchorHash(window.location.hash || route.hash)
  if (!id) return
  navigateToHeading(id, behavior)
}

const handleHashChange = () => {
  scrollToCurrentHash('smooth')
}

const cancelPendingAnchorScroll = () => {
  pendingAnchorId.value = ''
  clearAnchorSettleTimers()
}

const setupImageLoadReflowSync = () => {
  clearImageLoadListeners()

  const images = document.querySelectorAll('.wiki-content-body img') as NodeListOf<HTMLImageElement>
  images.forEach((image) => {
    if (image.complete) return

    const handleImageSettled = () => {
      scheduleViewportSync()
      if (pendingAnchorId.value) {
        correctHeadingPosition(pendingAnchorId.value)
      }
    }

    image.addEventListener('load', handleImageSettled, { once: true })
    image.addEventListener('error', handleImageSettled, { once: true })
    imageLoadCleanupFns.push(() => {
      image.removeEventListener('load', handleImageSettled)
      image.removeEventListener('error', handleImageSettled)
    })
  })
}

const setupContentResizeSync = () => {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null

  const content = document.querySelector('.wiki-content-body')
  if (!content) return

  contentResizeObserver = new ResizeObserver(() => {
    scheduleViewportSync()
    if (pendingAnchorId.value) {
      correctHeadingPosition(pendingAnchorId.value)
    }
  })
  contentResizeObserver.observe(content)
}

const enhanceContent = async () => {
  cancelPendingAnchorScroll()
  clearViewportSyncFrame()
  clearImageLoadListeners()
  await nextTick()
  syncHeadingScrollOffset()
  buildTocFromDom()
  enhanceCodeBlocks()
  enhanceTables()
  initImageZoom()
  applyHeadingDecorations()
  setupImageLoadReflowSync()
  setupContentResizeSync()
  updateViewportState()
}

const scrollToHeading = (id: string) => {
  const hasScrolled = navigateToHeading(id, 'smooth', true)
  if (!hasScrolled) {
    closeDrawers()
    return
  }

  closeDrawers()
}

const closeDrawers = () => {
  showDocNav.value = false
  showToc.value = false
}

const isCurrentPath = (path?: string) => normalizePath(path || '') === normalizePath(cleanPath.value)
const isTocActive = (id: string) => activeHeadingId.value === id

const handleWindowScroll = () => {
  scheduleViewportSync()
}

const handleWindowResize = () => {
  syncHeadingScrollOffset()
  scheduleViewportSync()
  if (pendingAnchorId.value) {
    correctHeadingPosition(pendingAnchorId.value)
  }
}

watch(hasMobileDrawer, (isOpen) => {
  if (import.meta.client) {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    document.body.classList.toggle('wiki-drawer-open', isOpen)
  }
})

watch(() => page.value, async () => {
  if (import.meta.client) {
    await enhanceContent()
    scrollToCurrentHash('auto')
  }
})

watch(() => route.hash, (hash) => {
  if (!import.meta.client || !hash) return

  const id = decodeAnchorHash(hash)
  if (id) {
    navigateToHeading(id, 'smooth')
  }
})

onMounted(async () => {
  await enhanceContent()
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  window.addEventListener('resize', handleWindowResize, { passive: true })
  window.addEventListener('hashchange', handleHashChange)
  window.addEventListener('wheel', cancelPendingAnchorScroll, { passive: true })
  window.addEventListener('touchstart', cancelPendingAnchorScroll, { passive: true })
  window.addEventListener('keydown', cancelPendingAnchorScroll)
  updateViewportState()
  scrollToCurrentHash('auto')
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleWindowScroll)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('hashchange', handleHashChange)
  window.removeEventListener('wheel', cancelPendingAnchorScroll)
  window.removeEventListener('touchstart', cancelPendingAnchorScroll)
  window.removeEventListener('keydown', cancelPendingAnchorScroll)
  clearAnchorSettleTimers()
  clearViewportSyncFrame()
  clearImageLoadListeners()
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
  document.body.style.overflow = ''
  document.body.classList.remove('wiki-drawer-open')

  if (zoomInstance) {
    zoomInstance.detach()
  }
})

function sortByChapter(a: WikiPage, b: WikiPage) {
  return Number(a.chapterSort || 0) - Number(b.chapterSort || 0) ||
    a.title.localeCompare(b.title, 'zh-CN')
}

function normalizePath(path: string) {
  return path.replace(/\/$/, '') || '/'
}
</script>

<template>
  <div class="wiki-doc-page">
    <div class="reading-progress-bar" :style="{ width: `${readingProgress}%` }" />

    <Transition name="fade">
      <button
        v-if="hasMobileDrawer"
        class="wiki-drawer-backdrop"
        aria-label="关闭导航"
        @click="closeDrawers"
      />
    </Transition>

    <div v-if="pending" class="loading-state">
      <div class="loading-spinner" />
      <p>加载中...</p>
    </div>

    <div v-else-if="page" class="wiki-shell">
      <aside
        v-if="docNavigationItems.length"
        class="wiki-doc-sidebar"
        :class="{ 'is-open': showDocNav }"
      >
        <div class="sidebar-header">
          <NuxtLink to="/wiki" class="sidebar-back">Wiki</NuxtLink>
          <button class="sidebar-close" type="button" @click="closeDrawers">关闭</button>
        </div>

        <NuxtLink :to="docIndex?.path || page.docRoot || '/wiki'" class="doc-title-link">
          {{ docTitle }}
        </NuxtLink>

        <nav class="doc-nav" aria-label="文档章节">
          <NuxtLink
            v-for="item in docNavigationItems"
            :key="item.path"
            :to="item.path"
            class="doc-nav-link"
            :class="{ 'is-active': isCurrentPath(item.path), 'is-index': item.isWikiIndex }"
            :style="{ '--doc-depth': String(Math.max(0, (item.chapter || '').split('.').filter(Boolean).length - 1)) }"
            @click="closeDrawers"
          >
            <span v-if="item.chapter" class="doc-nav-number">{{ item.chapter }}</span>
            <span>{{ item.isWikiIndex ? '首页' : item.title }}</span>
          </NuxtLink>
        </nav>
      </aside>

      <main class="wiki-main">
        <div class="mobile-actions">
          <button
            v-if="docNavigationItems.length"
            type="button"
            aria-label="打开章节目录"
            @click="showDocNav = true"
          >
            <span class="mobile-action-icon" aria-hidden="true">§</span>
            <span>章节</span>
          </button>
          <button
            type="button"
            aria-label="打开页内目录"
            :disabled="!tocLinks.length"
            @click="showToc = true"
          >
            <span class="mobile-action-icon" aria-hidden="true">#</span>
            <span>页内</span>
          </button>
        </div>

        <nav class="wiki-breadcrumb" aria-label="当前位置">
          <NuxtLink to="/wiki">Wiki</NuxtLink>
          <span>/</span>
          <NuxtLink v-if="docIndex" :to="docIndex.path">{{ docTitle }}</NuxtLink>
          <span v-else>{{ docTitle }}</span>
        </nav>

        <article class="wiki-article">
          <header class="wiki-article-header">
            <div v-if="page.chapter" class="chapter-kicker">
              第 {{ page.chapter }} 节
            </div>
            <h1>{{ page.title }}</h1>
          </header>

          <div class="wiki-content-body">
            <ContentRenderer :value="page" />
          </div>

          <footer v-if="previousPage || nextPage" class="wiki-page-navigation">
            <NuxtLink v-if="previousPage" :to="previousPage.path" class="page-nav-link page-nav-prev">
              <span class="page-nav-label">上一节</span>
              <span class="page-nav-title">
                {{ previousPage.chapter ? `${previousPage.chapter} ` : '' }}{{ previousPage.title }}
              </span>
            </NuxtLink>

            <NuxtLink v-if="nextPage" :to="nextPage.path" class="page-nav-link page-nav-next">
              <span class="page-nav-label">下一节</span>
              <span class="page-nav-title">
                {{ nextPage.chapter ? `${nextPage.chapter} ` : '' }}{{ nextPage.title }}
              </span>
            </NuxtLink>
          </footer>
        </article>
      </main>

      <aside
        v-if="tocLinks.length"
        class="wiki-toc-sidebar"
        :class="{ 'is-open': showToc }"
      >
        <div class="sidebar-header">
          <span class="toc-heading">本页目录</span>
          <button class="sidebar-close" type="button" @click="closeDrawers">关闭</button>
        </div>

        <nav class="toc-nav" aria-label="本页目录">
          <a
            v-for="link in tocLinks"
            :key="link.id"
            :href="`#${link.id}`"
            class="toc-link"
            :class="{ 'is-active': isTocActive(link.id) }"
            :style="{ '--toc-level': String(link.level) }"
            @click.prevent="scrollToHeading(link.id)"
          >
            <span class="toc-number">{{ link.number }}</span>
            <span>{{ link.text }}</span>
          </a>
        </nav>
      </aside>
    </div>
  </div>
</template>
