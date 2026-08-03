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

const scheduleHeadingNumberUpdate = () => {
  if (headingUpdateScheduled || props.variant !== 'wiki') return
  headingUpdateScheduled = true
  queueMicrotask(updateHeadingNumbers)
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
  >
    <Comark
      :markdown="preparedMarkdown"
      :options="vinciMarkdownOptions"
      :plugins="plugins"
      :components="components"
    />
  </div>
</template>
