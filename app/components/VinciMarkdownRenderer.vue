<script setup lang="ts">
import { resolveComponent } from 'vue'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '~~/shared/utils/vinci-markdown'
import {
  applyWikiHeadingNumbers,
  collectNumberedWikiHeadings
} from '../utils/wiki-heading-numbering'
import VinciAlert from './markdown/VinciAlert.vue'
import VinciDownloadCard from './markdown/VinciDownloadCard.vue'
import VinciParameterCard from './markdown/VinciParameterCard.vue'
import VinciVideo from './markdown/VinciVideo.vue'

const props = defineProps<{
  markdown: string
  variant?: 'news' | 'wiki' | 'member'
}>()

const preparedMarkdown = computed(() =>
  protectVinciTemplateTokens(props.markdown)
)
const plugins = createVinciMarkdownPlugins()
const NuxtLinkComponent = resolveComponent('NuxtLink')
const components = {
  nuxtlink: NuxtLinkComponent,
  'nuxt-link': NuxtLinkComponent,
  'vinci-alert': VinciAlert,
  'vinci-parameter-card': VinciParameterCard,
  'vinci-video': VinciVideo,
  'vinci-download-card': VinciDownloadCard
}

const rendererRoot = ref<HTMLElement | null>(null)
let headingObserver: MutationObserver | null = null
let headingUpdateScheduled = false

const updateHeadingNumbers = () => {
  headingUpdateScheduled = false
  if (!rendererRoot.value || props.variant !== 'wiki') return
  const { elements, numbered } = collectNumberedWikiHeadings(rendererRoot.value)
  applyWikiHeadingNumbers(elements, numbered)
}

const enhanceCodeBlocks = () => {
  if (!rendererRoot.value) return
  const blocks = rendererRoot.value.querySelectorAll('pre')
  blocks.forEach((block) => {
    if (block.querySelector(':scope > .code-toolbar')) return
    const code = block.querySelector('code')
    const classes = [...block.classList, ...(code ? [...code.classList] : [])]
    const langClass = classes.find(className => className.startsWith('language-'))
    const language = langClass ? langClass.slice('language-'.length).toUpperCase() : 'CODE'
    const toolbar = document.createElement('div')
    toolbar.className = 'code-toolbar'
    toolbar.innerHTML = `<span class="code-language"></span><button class="code-copy-btn" type="button">复制</button>`
    const label = toolbar.querySelector('.code-language')
    if (label) label.textContent = language
    block.insertBefore(toolbar, block.firstChild)
  })
}

const handleRendererClick = async (event: MouseEvent) => {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('.code-copy-btn')
  if (!button || !rendererRoot.value?.contains(button)) return
  const code = button.closest('pre')?.querySelector('code')?.textContent || ''
  try {
    await navigator.clipboard.writeText(code)
    button.textContent = '已复制'
    button.classList.add('copied')
    window.setTimeout(() => {
      button.textContent = '复制'
      button.classList.remove('copied')
    }, 1800)
  } catch {
    button.textContent = '复制失败'
  }
}

const scheduleHeadingNumberUpdate = () => {
  if (headingUpdateScheduled) return
  headingUpdateScheduled = true
  queueMicrotask(() => {
    updateHeadingNumbers()
    enhanceCodeBlocks()
  })
}

onMounted(() => {
  scheduleHeadingNumberUpdate()
  if (!rendererRoot.value) return
  headingObserver = new MutationObserver(scheduleHeadingNumberUpdate)
  headingObserver.observe(rendererRoot.value, { childList: true, subtree: true })
})

watch(() => [props.markdown, props.variant], scheduleHeadingNumberUpdate)

onBeforeUnmount(() => {
  headingObserver?.disconnect()
  headingObserver = null
})
</script>

<template>
  <div
    ref="rendererRoot"
    class="vinci-markdown-renderer wiki-content-body"
    :class="[
      `vinci-markdown-renderer-${variant || 'wiki'}`,
      {
        'content-prose': variant === 'news',
        'member-prose': variant === 'member'
      }
    ]"
    @click="handleRendererClick"
  >
    <Comark
      :markdown="preparedMarkdown"
      :options="vinciMarkdownOptions"
      :plugins="plugins"
      :components="components"
    />
  </div>
</template>
