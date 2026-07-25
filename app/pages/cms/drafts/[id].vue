<script setup lang="ts">
import type { CmsDraft } from '../../../../shared/types/cms-drafts'
import type { CmsMember } from '../../../../shared/types/cms-members'
import CmsMarkdownVisualEditor from '../../../components/cms/CmsMarkdownVisualEditor.client.vue'
import {
  assessMarkdownVisualSafety,
  normalizeMarkdownRoundTrip
} from '~~/shared/utils/cms-markdown-safety'

definePageMeta({ layout: 'cms', middleware: 'cms-auth' })
const route = useRoute()
const id = String(route.params.id)
const { csrfHeaders } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch

const [{ data: draftData }, { data: memberData }] = await Promise.all([
  useAsyncData(`cms:draft:${id}`, () =>
    requestFetch<{ draft: CmsDraft }>(`/api/cms/drafts/${id}`)
  ),
  useAsyncData('cms:draft:members', () =>
    requestFetch<{ members: CmsMember[] }>('/api/cms/members')
  )
])

if (!draftData.value?.draft) {
  throw createError({ statusCode: 404, statusMessage: '草稿不存在' })
}

const initial = draftData.value.draft
const title = ref(initial.title)
const description = ref(initial.description)
const body = ref(initial.body)
const authorKeys = ref(initial.authors.map(author => author.memberKey))
const version = ref(initial.version)
const lastSavedAt = ref(initial.lastSavedAt)
const mode = ref<'source' | 'visual'>('source')
const visualKey = ref(0)
const visualSource = ref('')
const visualChecking = ref(false)
const dirty = ref(false)
const saveState = ref<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved')
const message = ref('')
const mounted = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let visualCheckTimer: ReturnType<typeof setTimeout> | undefined
let saving = false
let saveQueued = false

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!dirty.value) return
  event.preventDefault()
}

useHead(() => ({ title: `${title.value} · 草稿 · Vinci 内容管理后台` }))

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '正在保存…'
  if (saveState.value === 'dirty') return '有未保存修改'
  if (saveState.value === 'error') return '自动保存失败'
  if (saveState.value === 'conflict') return '草稿版本冲突'
  return `已保存 · ${new Date(lastSavedAt.value).toLocaleTimeString('zh-CN')}`
})

const snapshot = () => ({
  title: title.value,
  description: description.value,
  body: body.value,
  authorKeys: [...authorKeys.value],
  version: version.value
})

const sameAsSnapshot = (value: ReturnType<typeof snapshot>) =>
  title.value === value.title
  && description.value === value.description
  && body.value === value.body
  && authorKeys.value.join('\0') === value.authorKeys.join('\0')

const save = async (manual = false) => {
  if (saving) {
    saveQueued = true
    return
  }
  saving = true
  clearTimeout(saveTimer)
  const value = snapshot()
  saveState.value = 'saving'
  message.value = ''

  try {
    const result = await $fetch<{ draft: CmsDraft }>(`/api/cms/drafts/${id}`, {
      method: 'PUT',
      headers: csrfHeaders(),
      body: value
    })
    version.value = result.draft.version
    lastSavedAt.value = result.draft.lastSavedAt
    dirty.value = !sameAsSnapshot(value)
    saveState.value = dirty.value ? 'dirty' : 'saved'
    if (manual) message.value = '草稿已手动保存。'
  } catch (error: any) {
    const status = error?.statusCode || error?.status
    saveState.value = status === 409 ? 'conflict' : 'error'
    message.value = error?.data?.message || '草稿保存失败'
  } finally {
    saving = false
    if (saveQueued) {
      saveQueued = false
      await save(false)
    }
  }
}

const scheduleSave = () => {
  if (!mounted.value || saveState.value === 'conflict') return
  dirty.value = true
  saveState.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(false), 1200)
}

watch([title, description, body, authorKeys], scheduleSave, { deep: true })

const switchMode = (next: 'source' | 'visual') => {
  message.value = ''
  clearTimeout(visualCheckTimer)
  if (next === 'source') {
    mode.value = 'source'
    visualChecking.value = false
    return
  }

  const safety = assessMarkdownVisualSafety(body.value)
  if (!safety.allowed) {
    message.value = `为避免破坏内容，当前正文只能使用源码模式：${safety.reasons.join('；')}`
    return
  }

  visualSource.value = body.value
  visualChecking.value = true
  visualKey.value += 1
  mode.value = 'visual'
  visualCheckTimer = setTimeout(() => {
    handleVisualError('初始化超时')
  }, 15_000)
}

const handleVisualReady = (serialized: string) => {
  clearTimeout(visualCheckTimer)
  if (
    normalizeMarkdownRoundTrip(serialized)
    !== normalizeMarkdownRoundTrip(visualSource.value)
  ) {
    body.value = visualSource.value
    mode.value = 'source'
    message.value = '可视化解析会改变当前 Markdown 格式，已安全返回源码模式，原文未被修改。'
  }
  visualChecking.value = false
}

const handleVisualError = (error: string) => {
  clearTimeout(visualCheckTimer)
  body.value = visualSource.value
  mode.value = 'source'
  visualChecking.value = false
  message.value = `可视化编辑器无法加载，已返回源码模式：${error}`
}

onMounted(() => {
  mounted.value = true
  window.addEventListener('beforeunload', handleBeforeUnload)
  if (initial.visualMode.allowed) switchMode('visual')
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(visualCheckTimer)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <section class="cms-page cms-editor-page">
    <header class="cms-editor-header">
      <div>
        <NuxtLink class="cms-back-link" :to="initial.articleId ? `/cms/articles/${initial.articleId}` : '/cms/articles'">
          ← 返回文章
        </NuxtLink>
        <p class="cms-eyebrow">DRAFT · {{ initial.collection }}</p>
        <h1>{{ title || '未命名草稿' }}</h1>
        <p>
          <span :class="`cms-save-state cms-save-state-${saveState}`">{{ saveLabel }}</span>
          · 版本 {{ version }}
          · {{ initial.baseContentHash ? '基于正式版本' : '尚未发布的新文章' }}
        </p>
      </div>
      <button class="cms-button cms-button-primary" type="button" :disabled="saveState === 'saving' || saveState === 'conflict'" @click="save(true)">
        手动保存
      </button>
    </header>

    <p v-if="message" class="cms-alert" :class="{ 'cms-alert-error': saveState === 'error' || saveState === 'conflict' }">
      {{ message }}
    </p>

    <div class="cms-draft-layout">
      <aside class="cms-panel cms-draft-fields">
        <h2>Frontmatter</h2>
        <label>
          <span>title</span>
          <input v-model="title" required maxlength="200">
        </label>
        <label>
          <span>description</span>
          <textarea v-model="description" maxlength="2000" rows="5" placeholder="留空时将在正式发布阶段自动生成" />
        </label>
        <label>
          <span>authors</span>
          <select v-model="authorKeys" multiple size="9">
            <option v-for="member in memberData?.members ?? []" :key="member.memberKey" :value="member.memberKey">
              {{ member.name }} · {{ member.memberKey }}
            </option>
          </select>
          <small>按 Ctrl / Command 可多选；文章最终只保存成员稳定 ID。</small>
        </label>

        <h3>系统维护字段（只读）</h3>
        <dl class="cms-system-fields">
          <template v-for="key in ['contributors', 'updatedAt', 'publishedAt']" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ JSON.stringify(initial.systemFrontmatter[key as keyof typeof initial.systemFrontmatter]) }}</dd>
          </template>
        </dl>

        <details>
          <summary>其他保留 Frontmatter</summary>
          <pre>{{ JSON.stringify(initial.preservedFrontmatter, null, 2) }}</pre>
        </details>
        <p v-if="initial.baseContentHash" class="cms-muted cms-base-version">
          基线 SHA-256<br><code>{{ initial.baseContentHash }}</code>
        </p>
      </aside>

      <main class="cms-editor-workspace">
        <div class="cms-editor-tabs" role="tablist" aria-label="编辑模式">
          <button type="button" :class="{ active: mode === 'visual' }" @click="switchMode('visual')">
            可视化编辑
          </button>
          <button type="button" :class="{ active: mode === 'source' }" @click="switchMode('source')">
            Markdown 源码
          </button>
        </div>

        <div v-if="mode === 'visual'" class="cms-visual-editor">
          <p v-if="visualChecking" class="cms-editor-checking">正在执行无损往返检查…</p>
          <ClientOnly>
            <CmsMarkdownVisualEditor
              :key="visualKey"
              v-model="body"
              @ready="handleVisualReady"
              @error="handleVisualError"
            />
            <template #fallback>
              <p class="cms-editor-checking">正在加载可视化编辑器…</p>
            </template>
          </ClientOnly>
        </div>
        <textarea
          v-else
          v-model="body"
          class="cms-markdown-source"
          spellcheck="false"
          aria-label="Markdown 源码"
        />
      </main>
    </div>

    <footer class="cms-draft-scope-note">
      草稿只存入 PostgreSQL；本页面没有发布、审核、图片上传或 Git 操作。
    </footer>
  </section>
</template>
