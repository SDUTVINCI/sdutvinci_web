<script setup lang="ts">
import { resolveComponent } from 'vue'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '~~/shared/utils/vinci-markdown'
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
</script>

<template>
  <div
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
