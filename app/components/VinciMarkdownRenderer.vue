<script setup lang="ts">
import { resolveComponent } from 'vue'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '~~/shared/utils/vinci-markdown'

const props = defineProps<{
  markdown: string
}>()

const preparedMarkdown = computed(() =>
  protectVinciTemplateTokens(props.markdown)
)
const plugins = createVinciMarkdownPlugins()
const NuxtLinkComponent = resolveComponent('NuxtLink')
const components = {
  nuxtlink: NuxtLinkComponent,
  'nuxt-link': NuxtLinkComponent
}
</script>

<template>
  <div class="vinci-markdown-renderer wiki-content-body">
    <Comark
      :markdown="preparedMarkdown"
      :options="vinciMarkdownOptions"
      :plugins="plugins"
      :components="components"
    />
  </div>
</template>
