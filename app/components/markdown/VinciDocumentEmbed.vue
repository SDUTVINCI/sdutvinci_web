<script setup lang="ts">
const props = withDefaults(defineProps<{
  src?: string
  title?: string
  provider?: string
  description?: string
}>(), {
  src: '',
  title: '在线文档',
  provider: '外部文档',
  description: '文档内容实时更新，可在当前页面预览或前往原网站查看。'
})

const safeSource = computed(() => {
  try {
    const url = new URL(props.src.trim())
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
})

const inlineOpen = ref(false)
const wideOpen = ref(false)
const frameLoading = ref(true)
let previousBodyOverflow = ''

const setInlineOpen = (open: boolean) => {
  inlineOpen.value = open
  if (open) frameLoading.value = true
}

const openWide = () => {
  frameLoading.value = true
  wideOpen.value = true
}

const closeWide = () => {
  wideOpen.value = false
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && wideOpen.value) closeWide()
}

watch(wideOpen, (open) => {
  if (!import.meta.client) return
  if (open) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = previousBodyOverflow
  }
})

onMounted(() => {
  inlineOpen.value = !window.matchMedia('(max-width: 640px)').matches
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (wideOpen.value) document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <section class="vinci-document-embed">
    <header class="vinci-document-embed-header">
      <div class="vinci-document-embed-heading">
        <span class="vinci-document-embed-icon" aria-hidden="true">▦</span>
        <span>
          <small>{{ provider }}</small>
          <strong>{{ title }}</strong>
          <span>{{ description }}</span>
        </span>
      </div>
      <div v-if="safeSource" class="vinci-document-embed-actions">
        <button
          type="button"
          :aria-expanded="inlineOpen"
          @click="setInlineOpen(!inlineOpen)"
        >
          {{ inlineOpen ? '收起预览' : '展开预览' }}
        </button>
        <button type="button" class="vinci-document-embed-wide" @click="openWide">
          宽屏查看
        </button>
        <a :href="safeSource" target="_blank" rel="noopener noreferrer">
          在{{ provider }}打开 ↗
        </a>
      </div>
    </header>

    <div v-if="safeSource && inlineOpen" class="vinci-document-embed-frame">
      <span v-if="frameLoading" class="vinci-document-embed-loading">文档加载中…</span>
      <iframe
        :src="safeSource"
        :title="`${title}预览`"
        loading="lazy"
        allowfullscreen
        @load="frameLoading = false"
      />
    </div>
    <button
      v-else-if="safeSource"
      type="button"
      class="vinci-document-embed-collapsed"
      @click="setInlineOpen(true)"
    >
      <span aria-hidden="true">▦</span>
      <strong>在当前页面展开文档</strong>
      <small>手机端建议横向滑动查看完整表格</small>
    </button>
    <p v-else class="vinci-content-component-error">文档地址无效或未使用 HTTPS。</p>

    <Teleport to="body">
      <div
        v-if="safeSource && wideOpen"
        class="vinci-document-dialog-backdrop"
        role="presentation"
        @click.self="closeWide"
      >
        <section
          class="vinci-document-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="`${title}宽屏预览`"
        >
          <header>
            <div>
              <small>{{ provider }}</small>
              <strong>{{ title }}</strong>
            </div>
            <a :href="safeSource" target="_blank" rel="noopener noreferrer">
              在{{ provider }}打开 ↗
            </a>
            <button type="button" aria-label="关闭宽屏预览" @click="closeWide">关闭</button>
          </header>
          <div class="vinci-document-dialog-frame">
            <span v-if="frameLoading" class="vinci-document-embed-loading">文档加载中…</span>
            <iframe
              :src="safeSource"
              :title="`${title}宽屏预览`"
              allowfullscreen
              @load="frameLoading = false"
            />
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>
