<script setup lang="ts">
import type {
  CmsContentImportRun,
  ContentImportClassification
} from '../../../../shared/types/cms-content-imports'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-import'] })
useHead({ title: '外部内容导入 · Vinci 内容管理后台' })

const { session } = useCmsSession()
const repository = ref('SDUTVINCI/sdutvinci_content')
const pullRequestNumber = ref<number | null>(null)
const run = ref<CmsContentImportRun | null>(null)
const selected = ref<string[]>([])
const busy = ref(false)
const message = ref('')
const failure = ref('')
const artifact = ref<null | {
  id: string
  baseSource: string | null
  currentSource: string | null
  proposedSource: string | null
  mergedSource: string | null
}>(null)

const labels: Record<ContentImportClassification, string> = {
  safe_change: '安全修改',
  auto_merge: '可自动合并',
  content_conflict: '内容冲突',
  new_article: '新文章',
  move_or_rename: '移动或重命名',
  deletion_proposal: '删除提案',
  path_conflict: '路径冲突',
  invalid_file: '非法文件',
  unknown_syntax: '未知语法',
  high_risk_syntax: '高风险 HTML / Vue / MDC'
}
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const artifactKeys = ['baseSource', 'currentSource', 'proposedSource', 'mergedSource'] as const
const artifactLabels: Record<(typeof artifactKeys)[number], string> = {
  baseSource: 'Base Source（PR 分支起点内容）',
  currentSource: 'Current Source（数据库当前正式内容）',
  proposedSource: 'Proposed Source（PR 提议的新内容）',
  mergedSource: 'Merge Result（三方合并后的草稿候选）'
}
const selectable = computed(() => run.value?.items.filter(item => item.importable && item.status === 'pending') || [])
const categoryCounts = computed(() => Object.entries(
  (run.value?.items || []).reduce<Record<string, number>>((result, item) => {
    result[item.classification] = (result[item.classification] || 0) + 1
    return result
  }, {})
))

const csrfHeaders = () => ({ 'x-csrf-token': session.value!.csrfToken })
const dryRun = async () => {
  if (!pullRequestNumber.value) return
  busy.value = true
  failure.value = ''
  message.value = ''
  artifact.value = null
  try {
    const response = await $fetch<{ run: CmsContentImportRun }>('/api/cms/content-imports/dry-run', {
      method: 'POST',
      headers: csrfHeaders(),
      body: { repository: repository.value, pullRequestNumber: pullRequestNumber.value }
    })
    run.value = response.run
    selected.value = response.run.items
      .filter(item => item.importable && item.status === 'pending')
      .map(item => item.id)
    message.value = 'Dry Run 已完成；尚未创建草稿或修改正式内容。'
  } catch (error: any) {
    failure.value = error?.data?.message || error?.message || 'Dry Run 失败'
  } finally { busy.value = false }
}

const importSelected = async () => {
  if (!run.value || !selected.value.length) return
  busy.value = true
  failure.value = ''
  try {
    const response = await $fetch<{ run: CmsContentImportRun }>(
      `/api/cms/content-imports/${run.value.id}/import`,
      { method: 'POST', headers: csrfHeaders(), body: { itemIds: selected.value } }
    )
    run.value = response.run
    selected.value = []
    message.value = '所选安全项目已创建为数据库草稿/提案；仍需提交审核、批准和明确发布。'
  } catch (error: any) {
    failure.value = error?.data?.message || error?.message || '导入失败'
  } finally { busy.value = false }
}

const showArtifact = async (itemId: string) => {
  if (!run.value) return
  const response = await $fetch<{ artifact: NonNullable<typeof artifact.value> }>(
    `/api/cms/content-imports/${run.value.id}/items/${itemId}`
  )
  artifact.value = response.artifact
}

const refreshRun = async () => {
  if (!run.value) return
  const response = await $fetch<{ run: CmsContentImportRun }>(
    `/api/cms/content-imports/${run.value.id}`
  )
  run.value = response.run
}

const externalAction = async (action: 'comment' | 'close') => {
  if (!run.value) return
  const prompt = action === 'comment'
    ? '确认向测试 PR 写入脱敏导入结果评论？这不会 Merge 或发布。'
    : '确认关闭测试 PR？这不会 Merge，但会改变 PR 外部状态。'
  if (!window.confirm(prompt)) return
  busy.value = true
  failure.value = ''
  try {
    await $fetch(`/api/cms/content-imports/${run.value.id}/${action}`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: { confirm: action === 'comment' ? 'COMMENT_IMPORT_RESULT' : 'CLOSE_PULL_REQUEST' }
    })
    await refreshRun()
    message.value = action === 'comment' ? '脱敏评论已明确授权写入。' : 'PR 已由管理员明确关闭。'
  } catch (error: any) {
    failure.value = error?.data?.message || error?.message || 'GitHub 外部操作失败'
  } finally { busy.value = false }
}
</script>

<template>
  <section class="cms-page cms-import-page">
    <header class="cms-page-header">
      <div>
        <p class="cms-eyebrow">PULL REQUEST / THREE-WAY REVIEW</p>
        <h1>外部内容导入</h1>
        <p>只读取配置内容仓库 PR 的 Base（分支起点）、Head（最新提交）与 Diff（变更文件）；数据库仍是正式内容权威。</p>
      </div>
    </header>

    <div class="cms-alert cms-alert-warning">
      Dry Run 和导入都不会批准、发布、Merge 或写正式 Revision。删除仅创建提案；高风险语法和冲突默认阻止。
    </div>
    <div v-if="message" class="cms-alert cms-alert-success">{{ message }}</div>
    <div v-if="failure" class="cms-alert cms-alert-error" role="alert">{{ failure }}</div>

    <form class="cms-card cms-import-form" @submit.prevent="dryRun">
      <label>
        <span>内容仓库</span>
        <input v-model="repository" class="cms-input" required autocomplete="off">
      </label>
      <label>
        <span>PR 编号</span>
        <input v-model.number="pullRequestNumber" class="cms-input" type="number" min="1" required>
      </label>
      <button class="cms-button cms-button-primary" type="submit" :disabled="busy">{{ busy ? '处理中…' : '执行完整 Dry Run' }}</button>
    </form>

    <template v-if="run">
      <section class="cms-card cms-import-summary">
        <h2>PR #{{ run.pullRequestNumber }} · {{ run.status }}</h2>
        <p>Base Commit（PR 分支起点提交） <code>{{ run.baseCommitHash }}</code></p>
        <p>Head Commit（PR 最新提交） <code>{{ run.headCommitHash }}</code></p>
        <p>{{ run.itemCount }} 个 Diff 文件 · {{ run.importableCount }} 个可导入 · {{ run.conflictCount }} 个阻止/冲突 · {{ run.importedCount }} 个已导入</p>
        <p>审计状态：Dry Run 已记录；外部动作 {{ run.externalActions.length }} 条。</p>
        <ul class="cms-import-categories">
          <li v-for="[classification, itemCount] in categoryCounts" :key="classification">
            {{ labels[classification as ContentImportClassification] }}：{{ itemCount }}
          </li>
        </ul>
        <ul v-if="run.externalActions.length" class="cms-import-actions">
          <li v-for="action in run.externalActions" :key="action.id">
            {{ action.action }} · {{ action.status }}<template v-if="action.errorCode"> · {{ action.errorCode }}</template>
          </li>
        </ul>
      </section>

      <div class="cms-import-toolbar">
        <button class="cms-button cms-button-primary" type="button" :disabled="busy || !selected.length" @click="importSelected">
          只导入所选安全项目（{{ selected.length }}）
        </button>
        <button class="cms-button cms-button-quiet" type="button" :disabled="busy" @click="externalAction('comment')">明确授权：评论 PR</button>
        <button v-if="isAdmin" class="cms-button cms-button-danger" type="button" :disabled="busy" @click="externalAction('close')">管理员明确关闭 PR</button>
      </div>

      <div class="cms-import-list">
        <article v-for="item in run.items" :key="item.id" class="cms-card cms-import-item" :data-risk="!item.importable">
          <label class="cms-import-select">
            <input v-model="selected" type="checkbox" :value="item.id" :disabled="!item.importable || item.status !== 'pending'">
            <strong>{{ labels[item.classification] }}</strong>
          </label>
          <code>{{ item.oldPath || '∅' }} → {{ item.newPath || '∅' }}</code>
          <p>状态：{{ item.status }}<template v-if="item.draftId"> · 草稿 {{ item.draftId }}</template></p>
          <p v-if="item.proposedArticleId">数据库预分配文章 ID：<code>{{ item.proposedArticleId }}</code></p>
          <p v-if="item.warningCodes.length" class="cms-alert cms-alert-warning">{{ item.warningCodes.join('、') }}</p>
          <details v-if="Object.keys(item.conflictDetails).length" class="cms-import-conflict">
            <summary>冲突 / 路径 / 引用审计详情</summary>
            <pre>{{ JSON.stringify(item.conflictDetails, null, 2) }}</pre>
          </details>
          <button class="cms-button cms-button-quiet" type="button" @click="showArtifact(item.id)">查看 Base（分支起点）/ Current（数据库当前）/ Proposed（PR 提议）/ Merge（合并结果）</button>
        </article>
      </div>
    </template>

    <section v-if="artifact" class="cms-card cms-import-artifact">
      <div class="cms-section-heading"><h2>三方审计材料</h2><button class="cms-button cms-button-quiet" @click="artifact = null">关闭</button></div>
      <div v-for="key in artifactKeys" :key="key">
        <h3>{{ artifactLabels[key] }}</h3>
        <pre>{{ artifact[key] ?? '（无）' }}</pre>
      </div>
    </section>
  </section>
</template>

<style scoped>
.cms-import-form { display: grid; grid-template-columns: minmax(260px, 1fr) 160px auto; gap: 1rem; align-items: end; }
.cms-import-form label { display: grid; gap: .45rem; }
.cms-import-toolbar { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; }
.cms-import-list { display: grid; gap: .8rem; }
.cms-import-item[data-risk="true"] { border-color: color-mix(in srgb, var(--cms-danger, #ef4444) 55%, transparent); }
.cms-import-select { display: flex; gap: .65rem; align-items: center; }
.cms-import-item code, .cms-import-summary code { overflow-wrap: anywhere; }
.cms-import-categories, .cms-import-actions { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; padding-left: 1.25rem; }
.cms-import-conflict pre { max-height: 240px; overflow: auto; white-space: pre-wrap; }
.cms-import-artifact { margin-top: 1rem; }
.cms-import-artifact pre { max-height: 360px; overflow: auto; white-space: pre-wrap; border: 1px solid rgba(127,127,127,.25); padding: 1rem; }
@media (max-width: 900px) { .cms-import-form { grid-template-columns: 1fr; } }
</style>
