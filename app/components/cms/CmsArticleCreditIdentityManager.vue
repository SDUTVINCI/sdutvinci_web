<script setup lang="ts">
import type { CmsArticleCreditIdentity } from '~~/shared/types/article-credit-identities'
import type { CmsMember } from '~~/shared/types/cms-members'

const props = defineProps<{ members: CmsMember[] }>()
const { csrfHeaders } = useCmsSession()
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, status, error, refresh } = await useAsyncData(
  'cms:article-credit-identities',
  () => requestFetch<{ items: CmsArticleCreditIdentity[] }>('/api/cms/article-credit-identities')
)

const search = ref('')
const showCreate = ref(false)
const newIdentity = reactive({ displayName: '', creditKey: '', memberId: '' })
const drafts = reactive<Record<string, { displayName: string, memberId: string }>>({})
const savingKey = ref('')
const message = ref('')
const actionError = ref('')

const availableMembers = computed(() => props.members.filter(member => !member.deletedAt))
const syncDrafts = () => {
  for (const item of data.value?.items || []) {
    drafts[item.creditKey] = {
      displayName: item.displayName,
      memberId: item.memberId || ''
    }
  }
}
watch(() => data.value?.items, syncDrafts, { immediate: true })

const filteredItems = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  if (!keyword) return data.value?.items || []
  return (data.value?.items || []).filter(item =>
    `${item.displayName}\n${item.creditKey}\n${item.linkedMemberName || ''}`
      .toLocaleLowerCase()
      .includes(keyword)
  )
})

const errorMessage = (value: unknown) => {
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return value instanceof Error ? value.message : '操作失败，请稍后重试'
}

const createIdentity = async () => {
  savingKey.value = '__new__'
  message.value = ''
  actionError.value = ''
  try {
    await $fetch('/api/cms/article-credit-identities', {
      method: 'POST',
      headers: csrfHeaders(),
      body: {
        displayName: newIdentity.displayName,
        ...(newIdentity.creditKey ? { creditKey: newIdentity.creditKey } : {}),
        memberId: newIdentity.memberId || null
      }
    })
    Object.assign(newIdentity, { displayName: '', creditKey: '', memberId: '' })
    showCreate.value = false
    message.value = '署名身份已登记，并已排队同步内容快照。'
    await refresh()
  } catch (value) {
    actionError.value = errorMessage(value)
  } finally {
    savingKey.value = ''
  }
}

const saveIdentity = async (item: CmsArticleCreditIdentity) => {
  const draft = drafts[item.creditKey]
  if (!draft) return
  savingKey.value = item.creditKey
  message.value = ''
  actionError.value = ''
  try {
    await $fetch(`/api/cms/article-credit-identities/${encodeURIComponent(item.creditKey)}`, {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: {
        displayName: draft.displayName,
        memberId: draft.memberId || null,
        expectedVersion: item.version
      }
    })
    message.value = `已保存 ${item.creditKey}，并已排队同步内容快照。`
    await refresh()
  } catch (value) {
    actionError.value = errorMessage(value)
  } finally {
    savingKey.value = ''
  }
}
</script>

<template>
  <section id="article-credit-identities" class="cms-credit-manager" aria-labelledby="credit-manager-title">
    <header class="cms-section-heading cms-credit-manager-heading">
      <div>
        <p class="cms-eyebrow">ARTICLE CREDITS</p>
        <h2 id="credit-manager-title">文章署名身份</h2>
        <p>Markdown 保留稳定拼音 ID；这里维护网页显示姓名，也可以关联到正式成员头像和主页。</p>
      </div>
      <button class="cms-button cms-button-primary" type="button" @click="showCreate = !showCreate">
        {{ showCreate ? '取消登记' : '登记署名' }}
      </button>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="actionError" class="cms-alert cms-alert-error">{{ actionError }}</p>

    <form v-if="showCreate" class="cms-credit-create" @submit.prevent="createIdentity">
      <label>
        <span>网页显示姓名</span>
        <input v-model.trim="newIdentity.displayName" required maxlength="100" placeholder="例如：崔桐汇">
      </label>
      <label>
        <span>稳定拼音 ID</span>
        <input v-model.trim="newIdentity.creditKey" maxlength="32" pattern="[a-z][a-z0-9]{2,31}" placeholder="留空自动生成拼音">
      </label>
      <label>
        <span>关联正式成员（可选）</span>
        <select v-model="newIdentity.memberId">
          <option value="">仅显示姓名，不链接主页</option>
          <option v-for="member in availableMembers" :key="member.id" :value="member.id">
            {{ member.name }} · {{ member.memberKey }}
          </option>
        </select>
      </label>
      <button class="cms-button cms-button-primary" type="submit" :disabled="savingKey === '__new__'">
        {{ savingKey === '__new__' ? '正在登记…' : '确认登记' }}
      </button>
    </form>

    <div class="cms-toolbar cms-toolbar-compact cms-credit-toolbar">
      <label>
        <span>搜索署名</span>
        <input v-model.trim="search" type="search" placeholder="中文名、拼音 ID 或关联成员">
      </label>
      <p>{{ filteredItems.length }} / {{ data?.items.length ?? 0 }} 个署名</p>
    </div>

    <p v-if="status === 'pending'" class="cms-muted">正在加载署名身份…</p>
    <p v-else-if="error" class="cms-alert cms-alert-error">{{ error.message || '署名身份加载失败' }}</p>
    <div v-else-if="filteredItems.length" class="cms-table-wrap cms-credit-table-wrap">
      <table class="cms-table cms-credit-table">
        <thead>
          <tr>
            <th>稳定 ID</th>
            <th>网页显示姓名</th>
            <th>正式成员关联</th>
            <th>引用文章</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredItems" :key="item.creditKey">
            <td><code>{{ item.creditKey }}</code></td>
            <td>
              <input v-model.trim="drafts[item.creditKey]!.displayName" maxlength="100" :aria-label="`${item.creditKey} 的网页显示姓名`">
            </td>
            <td>
              <select v-model="drafts[item.creditKey]!.memberId" :aria-label="`${item.creditKey} 的正式成员关联`">
                <option value="">仅显示姓名</option>
                <option v-for="member in availableMembers" :key="member.id" :value="member.id">
                  {{ member.name }} · {{ member.memberKey }}
                </option>
              </select>
            </td>
            <td><span class="cms-credit-usage">{{ item.usageCount }} 篇</span></td>
            <td>
              <button
                class="cms-button cms-button-quiet"
                type="button"
                :disabled="savingKey === item.creditKey"
                @click="saveIdentity(item)"
              >
                {{ savingKey === item.creditKey ? '保存中…' : '保存' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="cms-empty">{{ search ? '没有符合条件的署名身份。' : '暂无文章署名身份。' }}</p>
  </section>
</template>
