<script setup lang="ts">
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

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

onMounted(async () => {
  if (!root.value) return

  try {
    crepe = new Crepe({
      root: root.value,
      defaultValue: props.modelValue,
      features: {
        [Crepe.Feature.AI]: false
      }
    })
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
