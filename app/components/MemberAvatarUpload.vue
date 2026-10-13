<script setup lang="ts">
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const props = withDefaults(defineProps<{
  name: string
  currentUrl?: string | null
  required?: boolean
  disabled?: boolean
  uploading?: boolean
}>(), {
  currentUrl: null,
  required: false,
  disabled: false,
  uploading: false
})
const emit = defineEmits<{ select: [file: File] }>()
const localPreviewUrl = ref('')
const previewUrl = computed(() =>
  localPreviewUrl.value || resolveStaticMediaUrl(props.currentUrl || '/images/logo.png')
)

const clearLocalPreview = () => {
  if (!localPreviewUrl.value) return
  URL.revokeObjectURL(localPreviewUrl.value)
  localPreviewUrl.value = ''
}

const selectAvatar = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  clearLocalPreview()
  localPreviewUrl.value = URL.createObjectURL(file)
  emit('select', file)
}

watch(() => props.uploading, (uploading, wasUploading) => {
  if (wasUploading && !uploading) clearLocalPreview()
})

onBeforeUnmount(clearLocalPreview)
</script>

<template>
  <section class="member-avatar-field">
    <div class="member-avatar-notice" :class="{ 'member-avatar-notice--ready': name.trim() }" role="status">
      <span class="member-avatar-notice-icon" aria-hidden="true">{{ name.trim() ? '✓' : '!' }}</span>
      <div><strong>必须填写姓名后才能上传头像</strong><p>{{ name.trim() ? `当前姓名：${name.trim()}，可以上传头像。` : '请先填写下方姓名。填写后，头像上传按钮会自动启用。' }}</p></div>
    </div>
    <div class="member-avatar-preview">
      <img :src="previewUrl" :alt="`${name || '成员'}头像预览`">
      <span>头像预览</span>
    </div>
    <label class="member-avatar-upload">
      <span>
        头像
        <strong v-if="required" class="member-required-marker">必填</strong>
        <small>（文件名自动转为姓名-哈希.webp）</small>
      </span>
      <input
        class="member-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        :required="required && !currentUrl"
        :disabled="disabled || uploading || !name.trim()"
        @change="selectAvatar"
      >
      <small :class="{ 'member-avatar-name-warning': !name.trim() }">
        {{ !name.trim() ? '请先填写姓名，再选择头像' : (uploading ? '正在转换并上传…' : '支持 JPG、PNG、WebP 或 GIF，最大 10 MB') }}
      </small>
    </label>
  </section>
</template>
