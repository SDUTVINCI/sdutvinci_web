<script setup lang="ts">
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const props = withDefaults(defineProps<{
  name: string
  currentUrl?: string | null
  disabled?: boolean
  uploading?: boolean
}>(), {
  currentUrl: null,
  disabled: false,
  uploading: false
})
const emit = defineEmits<{ select: [file: File] }>()
const localPreviewUrl = ref('')
const previewUrl = computed(() =>
  localPreviewUrl.value || resolveStaticMediaUrl(props.currentUrl || '/images/logo.png')
)

const selectAvatar = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value)
  localPreviewUrl.value = URL.createObjectURL(file)
  emit('select', file)
}

onBeforeUnmount(() => {
  if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value)
})
</script>

<template>
  <section class="member-avatar-field">
    <div class="member-avatar-preview">
      <img :src="previewUrl" :alt="`${name || '成员'}头像预览`">
      <span>头像预览</span>
    </div>
    <label class="member-avatar-upload">
      <span>头像（文件名自动转为姓名-哈希.webp）</span>
      <input
        class="member-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        :disabled="disabled || uploading"
        @change="selectAvatar"
      >
      <small>{{ uploading ? '正在转换并上传…' : '支持 JPG、PNG、WebP 或 GIF，最大 10 MB' }}</small>
    </label>
  </section>
</template>
