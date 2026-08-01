<script setup lang="ts">
import type {
  CmsContentImportRun,
  ContentImportClassification
} from '../../../../shared/types/cms-content-imports'
import {
  buildContentImportContext,
  buildContentImportDiff,
  type ContentImportDiffLine
} from '~~/shared/utils/content-import-diff'

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
  high_risk_syntax: '高风险 HTML / Vue / MDC',
  member_safe_change: '成员安全修改提案',
  member_auto_merge: '成员字段级自动合并提案',
  member_conflict: '成员字段冲突',
  member_deletion_proposal: '成员删除提案',
  member_sensitive_rejected: '成员敏感字段已拒绝',
  member_invalid: '非法成员资料'
}
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const artifactKeys = ['baseSource', 'currentSource', 'proposedSource', 'mergedSource'] as const
const artifactLabels: Record<(typeof artifactKeys)[number], string> = {
  baseSource: 'Base（开始修改时的原文）',
  currentSource: 'Current（数据库现在的正式内容）',
  proposedSource: 'Proposed（这个 PR 想改成的内容）',
  mergedSource: 'Merge（导入后将进入草稿的内容）'
}
const runStatusLabels: Record<CmsContentImportRun['status'], string> = {
  dry_run: '检查完成，尚未导入',
  partially_imported: '已导入部分安全项目',
  imported: '安全项目已全部导入',
  failed: '检查失败'
}
const itemStatusLabels = {
  pending: '等待处理',
  imported: '已创建草稿或提案',
  skipped: '已跳过',
  blocked: '已阻止'
} as const
const externalActionLabels = {
  comment: '在 PR 下留言检查结果',
  close: '关闭 PR'
} as const
const externalStatusLabels = {
  processing: '正在执行',
  succeeded: '操作成功',
  failed: '操作失败'
} as const
const selectable = computed(() => run.value?.items.filter(item => item.importable && item.status === 'pending') || [])
const categoryCounts = computed(() => Object.entries(
  (run.value?.items || []).reduce<Record<string, number>>((result, item) => {
    result[item.classification] = (result[item.classification] || 0) + 1
    return result
  }, {})
))
const artifactItem = computed(() => run.value?.items.find(item => item.id === artifact.value?.id) || null)
const deletionArtifact = computed(() => ['deletion_proposal', 'member_deletion_proposal']
  .includes(artifactItem.value?.classification || ''))
interface ArtifactView {
  key: (typeof artifactKeys)[number]
  label: string
  comparison: string
  lines: ContentImportDiffLine[]
  emptyText: string | null
}
const artifactViews = computed<ArtifactView[]>(() => {
  if (!artifact.value) return []
  const base = artifact.value.baseSource || ''
  const current = artifact.value.currentSource || ''
  const proposed = artifact.value.proposedSource
  const merged = artifact.value.mergedSource
  return [
    {
      key: 'baseSource', label: artifactLabels.baseSource,
      comparison: '比较基准：下面 Current 和 Proposed 的增删都与它比较。',
      lines: buildContentImportContext(base),
      emptyText: base ? null : '这是新内容，没有分支起点原文。'
    },
    {
      key: 'currentSource', label: artifactLabels.currentSource,
      comparison: '与 Base 比较：绿色 + 是数据库后来新增的内容，红色 - 是被替换的旧内容。',
      lines: buildContentImportDiff(base, current),
      emptyText: current ? null : '数据库中还没有这项正式内容。'
    },
    {
      key: 'proposedSource', label: artifactLabels.proposedSource,
      comparison: '与 Base 比较：绿色 + 是 PR 新增的内容，红色 - 是 PR 想删除或替换的内容。',
      lines: proposed === null
        ? deletionArtifact.value ? buildContentImportDiff(base, '') : []
        : buildContentImportDiff(base, proposed),
      emptyText: proposed === null
        ? deletionArtifact.value ? '这个 PR 提议删除整项内容。' : '该内容因冲突或安全原因没有提供。'
        : proposed ? null : 'PR 提议的内容为空。'
    },
    {
      key: 'mergedSource', label: artifactLabels.mergedSource,
      comparison: '与 Current 比较：绿色 + 是导入草稿后新增的内容，红色 - 是草稿将替换的内容。',
      lines: merged === null ? [] : buildContentImportDiff(current, merged),
      emptyText: merged === null
        ? deletionArtifact.value
          ? '删除提案没有合并正文；之后仍需审核并明确发布才会删除。'
          : '无法安全合并，因此不会创建合并草稿。'
        : merged ? null : '合并结果为空。'
    }
  ]
})

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
  if (artifact.value?.id === itemId) {
    artifact.value = null
    return
  }
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
    ? '确定要在这个 PR 下留言吗？系统只会发送不含正文和敏感信息的检查摘要；不会合并 PR、批准草稿或发布内容。'
    : '确定要关闭这个 PR 吗？关闭表示不再继续处理这个提案，但不会合并 PR、发布内容，也不会删除已经创建的草稿或成员提案。'
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
    message.value = action === 'comment'
      ? '已在 PR 下留言检查结果；没有合并或发布任何内容。'
      : 'PR 已关闭；没有合并或发布任何内容，已创建的草稿/提案仍然保留。'
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
      Dry Run 和导入都不会批准、发布、Merge 或写正式 Revision。成员变更与删除只创建提案，管理员还须在成员页再次明确接受；敏感字段直接拒绝。
    </div>
    <p class="cms-muted">成员 PR 白名单：姓名、头像、对外职责/类型、参与/指导届次、年级、单位、公开链接、简介正文、公开 metadata、排序号。登录账号/密码、账号绑定、系统角色权限、会话和安全状态不允许修改。</p>
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
        <h2>PR #{{ run.pullRequestNumber }} · {{ runStatusLabels[run.status] }}</h2>
        <p>Base Commit（PR 分支起点提交） <code>{{ run.baseCommitHash }}</code></p>
        <p>Head Commit（PR 最新提交） <code>{{ run.headCommitHash }}</code></p>
        <p>{{ run.itemCount }} 个 Diff 文件 · {{ run.importableCount }} 个可导入 · {{ run.conflictCount }} 个阻止/冲突 · {{ run.importedCount }} 个已导入</p>
        <p>审计状态：Dry Run 已记录；外部动作 {{ run.externalActions.length }} 条。</p>
        <ul class="cms-import-categories">
          <li v-for="[classification, itemCount] in categoryCounts" :key="classification">
            {{ labels[classification as ContentImportClassification] }}：{{ itemCount }}
          </li>
        </ul>
        <section v-if="run.externalActions.length" class="cms-import-actions" aria-label="PR 外部操作记录">
          <article
            v-for="action in run.externalActions"
            :key="action.id"
            class="cms-import-action-result"
            :data-status="action.status"
            role="status"
          >
            <span class="cms-import-action-icon" aria-hidden="true">
              {{ action.status === 'succeeded' ? '✓' : action.status === 'failed' ? '!' : '…' }}
            </span>
            <span>
              <strong>{{ externalActionLabels[action.action] }}</strong>
              <small>{{ externalStatusLabels[action.status] }}<template v-if="action.errorCode"> · 错误码 {{ action.errorCode }}</template></small>
            </span>
          </article>
        </section>
      </section>

      <div class="cms-import-toolbar">
        <button class="cms-button cms-button-primary" type="button" :disabled="busy || !selected.length" @click="importSelected">
          只导入所选安全项目（{{ selected.length }}）
        </button>
        <div class="cms-import-external-action">
          <button class="cms-button cms-button-quiet" type="button" :disabled="busy" @click="externalAction('comment')">把检查结果留言到 PR</button>
          <p>在 GitHub PR 下发送一条脱敏摘要，让提案人知道哪些项目已导入、哪些被阻止。不会合并 PR，也不会批准或发布内容。</p>
        </div>
        <div v-if="isAdmin" class="cms-import-external-action cms-import-external-action-danger">
          <button class="cms-button cms-button-danger" type="button" :disabled="busy" @click="externalAction('close')">关闭这个 PR（仅管理员）</button>
          <p>把 PR 标记为“已关闭”，表示不再继续这个提案。不会合并或发布，也不会删除已经创建的草稿/成员提案。</p>
        </div>
      </div>

      <div class="cms-import-list">
        <article v-for="item in run.items" :key="item.id" class="cms-card cms-import-item" :data-risk="!item.importable">
          <label class="cms-import-select">
            <input v-model="selected" type="checkbox" :value="item.id" :disabled="!item.importable || item.status !== 'pending'">
            <strong>{{ labels[item.classification] }}</strong>
          </label>
          <code>{{ item.oldPath || '∅' }} → {{ item.newPath || '∅' }}</code>
          <p>对象：{{ item.targetType === 'member' ? '成员资料' : '文章' }} · 状态：{{ itemStatusLabels[item.status] }}<template v-if="item.draftId"> · 草稿 {{ item.draftId }}</template><template v-if="item.memberProposalId"> · 成员提案 {{ item.memberProposalId }}</template></p>
          <p v-if="item.proposedArticleId">数据库预分配文章 ID：<code>{{ item.proposedArticleId }}</code></p>
          <p v-if="item.warningCodes.length" class="cms-alert cms-alert-warning">{{ item.warningCodes.join('、') }}</p>
          <details v-if="Object.keys(item.conflictDetails).length" class="cms-import-conflict">
            <summary>冲突 / 路径 / 引用审计详情</summary>
            <pre>{{ JSON.stringify(item.conflictDetails, null, 2) }}</pre>
          </details>
          <button
            class="cms-button cms-button-quiet"
            type="button"
            :aria-expanded="artifact?.id === item.id"
            :aria-controls="`artifact-${item.id}`"
            @click="showArtifact(item.id)"
          >
            {{ artifact?.id === item.id ? '收起三方审计材料' : '查看 Base（分支起点）/ Current（数据库当前）/ Proposed（PR 提议）/ Merge（合并结果）' }}
          </button>
          <section
            v-if="artifact?.id === item.id"
            :id="`artifact-${item.id}`"
            class="cms-import-artifact"
          >
            <div class="cms-section-heading">
              <div>
                <h3>内容差异</h3>
                <p class="cms-muted">仿 Git diff：绿色整行和“+”表示新增，红色整行和“-”表示删除；没有底色的是上下文。</p>
              </div>
              <button class="cms-button cms-button-quiet" type="button" @click="artifact = null">关闭</button>
            </div>
            <article v-for="view in artifactViews" :key="view.key" class="cms-import-diff-panel">
              <header>
                <h4>{{ view.label }}</h4>
                <p>{{ view.comparison }}</p>
              </header>
              <p v-if="view.emptyText" class="cms-import-diff-empty">{{ view.emptyText }}</p>
              <div v-if="view.lines.length" class="cms-import-diff" role="table" :aria-label="view.label">
                <div
                  v-for="(line, lineIndex) in view.lines"
                  :key="`${view.key}-${lineIndex}`"
                  class="cms-import-diff-line"
                  :data-kind="line.kind"
                  role="row"
                >
                  <span class="cms-import-diff-number" role="cell">{{ line.oldLine ?? '' }}</span>
                  <span class="cms-import-diff-number" role="cell">{{ line.newLine ?? '' }}</span>
                  <span class="cms-import-diff-prefix" role="cell">{{ line.prefix }}</span>
                  <code role="cell">{{ line.text || ' ' }}</code>
                </div>
              </div>
            </article>
          </section>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cms-import-form { display: grid; grid-template-columns: minmax(260px, 1fr) 160px auto; gap: 1rem; align-items: end; }
.cms-import-form label { display: grid; gap: .45rem; }
.cms-import-toolbar { display: grid; grid-template-columns: auto minmax(260px, 1fr) minmax(260px, 1fr); gap: .75rem; margin: 1rem 0; align-items: start; }
.cms-import-external-action { display: grid; gap: .55rem; padding: .85rem; border: 1px solid color-mix(in srgb, var(--cms-accent, #2563eb) 35%, transparent); border-radius: .75rem; background: color-mix(in srgb, var(--cms-accent, #2563eb) 8%, transparent); }
.cms-import-external-action p { margin: 0; font-size: .88rem; line-height: 1.55; }
.cms-import-external-action-danger { border-color: color-mix(in srgb, var(--cms-danger, #ef4444) 42%, transparent); background: color-mix(in srgb, var(--cms-danger, #ef4444) 8%, transparent); }
.cms-import-list { display: grid; gap: .8rem; }
.cms-import-item[data-risk="true"] { border-color: color-mix(in srgb, var(--cms-danger, #ef4444) 55%, transparent); }
.cms-import-select { display: flex; gap: .65rem; align-items: center; }
.cms-import-item code, .cms-import-summary code { overflow-wrap: anywhere; }
.cms-import-categories { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; padding-left: 1.25rem; }
.cms-import-actions { display: grid; gap: .65rem; margin-top: 1rem; }
.cms-import-action-result { display: flex; align-items: center; gap: .75rem; padding: .8rem 1rem; border: 2px solid; border-radius: .75rem; }
.cms-import-action-result[data-status="succeeded"] { border-color: #16a34a; background: rgba(22, 163, 74, .14); }
.cms-import-action-result[data-status="failed"] { border-color: #dc2626; background: rgba(220, 38, 38, .14); }
.cms-import-action-result[data-status="processing"] { border-color: #d97706; background: rgba(217, 119, 6, .14); }
.cms-import-action-icon { display: grid; place-items: center; width: 2rem; height: 2rem; flex: 0 0 auto; border-radius: 999px; background: #64748b; color: white; font-size: 1.1rem; font-weight: 900; }
.cms-import-action-result[data-status="succeeded"] .cms-import-action-icon { background: #15803d; }
.cms-import-action-result[data-status="failed"] .cms-import-action-icon { background: #b91c1c; }
.cms-import-action-result[data-status="processing"] .cms-import-action-icon { background: #b45309; }
.cms-import-action-result > span:last-child { display: grid; gap: .15rem; }
.cms-import-action-result strong { font-size: 1rem; }
.cms-import-action-result small { font-size: .85rem; }
.cms-import-conflict pre { max-height: 240px; overflow: auto; white-space: pre-wrap; }
.cms-import-artifact { margin-top: 1rem; border-top: 1px solid rgba(127,127,127,.25); padding-top: 1rem; }
.cms-import-diff-panel { margin-top: 1rem; overflow: hidden; border: 1px solid rgba(127,127,127,.3); border-radius: .75rem; }
.cms-import-diff-panel > header { padding: .8rem 1rem; border-bottom: 1px solid rgba(127,127,127,.25); background: rgba(127,127,127,.08); }
.cms-import-diff-panel h4, .cms-import-diff-panel p { margin: 0; }
.cms-import-diff-panel header p { margin-top: .3rem; font-size: .85rem; line-height: 1.5; }
.cms-import-diff { max-height: 460px; overflow: auto; font: .84rem/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: rgba(15, 23, 42, .04); }
.cms-import-diff-line { display: grid; grid-template-columns: 3.5rem 3.5rem 1.75rem minmax(max-content, 1fr); min-height: 1.5rem; border-left: 4px solid transparent; }
.cms-import-diff-line[data-kind="added"] { border-left-color: #16a34a; background: rgba(34, 197, 94, .2); }
.cms-import-diff-line[data-kind="removed"] { border-left-color: #dc2626; background: rgba(239, 68, 68, .2); }
.cms-import-diff-line code { padding: 0 .75rem 0 .25rem; white-space: pre; color: inherit; }
.cms-import-diff-number, .cms-import-diff-prefix { padding: 0 .45rem; text-align: right; user-select: none; color: color-mix(in srgb, currentColor 60%, transparent); background: rgba(127,127,127,.08); }
.cms-import-diff-prefix { text-align: center; font-weight: 800; }
.cms-import-diff-line[data-kind="added"] .cms-import-diff-prefix { color: #15803d; }
.cms-import-diff-line[data-kind="removed"] .cms-import-diff-prefix { color: #b91c1c; }
.cms-import-diff-empty { padding: 1rem; border-left: 4px solid #d97706; background: rgba(245, 158, 11, .12); }
@media (max-width: 900px) {
  .cms-import-form, .cms-import-toolbar { grid-template-columns: 1fr; }
  .cms-import-diff-line { grid-template-columns: 2.5rem 2.5rem 1.5rem minmax(max-content, 1fr); }
}
</style>
