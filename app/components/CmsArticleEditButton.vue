<script setup lang="ts">
const props = defineProps<{
  publicPath: string
  allowPdf?: boolean
}>()

const { session, loadSession, csrfHeaders } = useCmsSession()
const busy = ref(false)
const errorMessage = ref('')

const editArticle = async () => {
  busy.value = true
  errorMessage.value = ''
  try {
    const resolved = await $fetch<{ article: { id: string } }>('/api/cms/articles/resolve', {
      query: { publicPath: props.publicPath }
    })
    const returnTo = props.publicPath
    const currentSession = session.value || await loadSession(true)
    if (!currentSession) {
      const redirect = `/cms/articles/${resolved.article.id}?edit=1&returnTo=${encodeURIComponent(returnTo)}`
      await navigateTo({ path: '/cms/login', query: { redirect } })
      return
    }
    const result = await $fetch<{ draft: { id: string } }>('/api/cms/drafts', {
      method: 'POST',
      headers: csrfHeaders(),
      body: { kind: 'existing', articleId: resolved.article.id }
    })
    await navigateTo({
      path: `/cms/drafts/${result.draft.id}`,
      query: { returnTo }
    })
  } catch (error: any) {
    errorMessage.value = error?.data?.message || '暂时无法打开本文编辑页'
  } finally {
    busy.value = false
  }
}

const downloadPdf = async () => {
  errorMessage.value = ''
  const currentSession = session.value || await loadSession(true)
  if (!currentSession) {
    await navigateTo({ path: '/cms/login', query: { redirect: props.publicPath } })
    return
  }
  window.location.assign(`/api/wiki/pdf?path=${encodeURIComponent(props.publicPath)}`)
}
</script>

<template>
  <div class="front-edit-action">
    <button type="button" :disabled="busy" @click="editArticle">
      {{ busy ? '正在打开后台…' : '编辑本文' }}
    </button>
    <button v-if="allowPdf" type="button" :disabled="busy" @click="downloadPdf">下载 PDF</button>
    <span v-if="errorMessage" role="alert">{{ errorMessage }}</span>
  </div>
</template>
