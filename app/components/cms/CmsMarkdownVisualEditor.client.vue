<script setup lang="ts">
import { Crepe } from '@milkdown/crepe'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  cmsProtectedMarkdownPlugins,
  prepareMarkdownForVisualEditor
} from '../../utils/cms-protected-markdown'
import { cmsVisualEditorFeatures } from '../../utils/cms-visual-editor'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  ready: [serialized: string]
  error: [message: string]
}>()

const root = ref<HTMLElement | null>(null)
let crepe: Crepe | null = null
let acceptsUpdates = false

const insertMarkdown = (markdown: string) => {
  if (!crepe || !acceptsUpdates) return false
  crepe.editor.action(insert(markdown, false))
  return true
}

defineExpose({ insertMarkdown })

onMounted(async () => {
  if (!root.value) return

  try {
    crepe = new Crepe({
      root: root.value,
      defaultValue: prepareMarkdownForVisualEditor(props.modelValue),
      features: cmsVisualEditorFeatures
    })
    crepe.editor.use(cmsProtectedMarkdownPlugins)
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (acceptsUpdates) emit('update:modelValue', markdown)
      })
    })
    await crepe.create()
    const serialized = crepe.getMarkdown()
    emit('ready', serialized)
    acceptsUpdates = true
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '可视化编辑器初始化失败')
  }
})

onUnmounted(async () => {
  acceptsUpdates = false
  await crepe?.destroy()
  crepe = null
})
</script>

<template>
  <div ref="root" class="cms-milkdown-root" />
</template>
