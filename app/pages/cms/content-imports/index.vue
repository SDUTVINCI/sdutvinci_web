<script setup lang="ts">
import {
  CONTENT_IMPORT_HIGH_RISK_CONFIRMATION,
  type CmsContentImportRun,
  type ContentImportClassification,
  type ContentImportItemStatus,
  type ContentPrExternalAction
} from '~~/shared/types/cms-content-imports'
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
const classificationFilter = ref<'all' | ContentImportClassification>('all')
const statusFilter = ref<'all' | ContentImportItemStatus>('all')
const highRiskConfirmation = ref('')
const busy = ref(false)
const externalBusyAction = ref<ContentPrExternalAction | null>(null)
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
  imported: '默认安全项目已全部处理',
  failed: '检查失败'
}
const itemStatusLabels = {
  pending: '等待处理',
  imported: '已导入草稿 / 提案',
  skipped: '已跳过',
  blocked: '已阻止'
} as const
const itemStatuses = Object.keys(itemStatusLabels) as ContentImportItemStatus[]
const warningLabels: Record<string, string> = {
  CURRENT_CHANGED_AFTER_DRY_RUN: 'Dry Run 后数据库正式内容已变化，需要重新检查后再处理。',
  HIGH_RISK_OVERRIDE_CONTENT_CONFLICT: '强制导入时发现三方内容冲突，未创建草稿。',
  IMPORT_ACTIVE_DRAFT_EXISTS: '当前账号存在这篇文章的活动草稿（草稿、待审核、已驳回、已通过或已撤回），请先处理该草稿后重试；已发布历史不会触发此阻止。'
}
const externalActionLabels = {
  comment: '在 PR 下留言检查结果',
  close: '关闭 PR',
  delete_branch: '删除 PR 源分支'
} as const
const externalStatusLabels = {
  processing: '正在执行',
  succeeded: '操作成功',
  failed: '操作失败'
} as const
const externalActionState = (action: ContentPrExternalAction) => {
  const actions = (run.value?.externalActions || []).filter(item => item.action === action)
  if (actions.some(item => item.status === 'succeeded')) return 'succeeded' as const
  if (actions.some(item => item.status === 'processing')) return 'processing' as const
  return actions.some(item => item.status === 'failed') ? 'failed' as const : 'idle' as const
}
const commentState = computed(() => externalActionState('comment'))
const closeState = computed(() => externalActionState('close'))
const branchDeleteState = computed(() => externalActionState('delete_branch'))
const externalButtonLabel = (action: 'comment' | 'close') => {
  const state = externalActionState(action)
  if (state === 'succeeded') return action === 'comment' ? '✓ 已留言' : '✓ PR 已关闭'
  if (externalBusyAction.value === action || state === 'processing') {
    return action === 'comment' ? '正在留言…' : '正在关闭…'
  }
  if (state === 'failed') return action === 'comment' ? '留言失败，点击重试' : '关闭失败，点击重试'
  return action === 'comment' ? '把检查结果留言到 PR' : '关闭这个 PR（仅管理员）'
}
const branchDeleteButtonLabel = computed(() => {
  if (branchDeleteState.value === 'succeeded') return '✓ 源分支已删除'
  if (externalBusyAction.value === 'delete_branch' || branchDeleteState.value === 'processing') {
    return '正在删除源分支…'
  }
  if (branchDeleteState.value === 'failed') return '删除失败，核对后重试'
  return '删除源分支（输入分支名确认）'
})
const selectedHighRiskIds = computed(() => run.value?.items
  .filter(item => selected.value.includes(item.id) && item.classification === 'high_risk_syntax')
  .map(item => item.id) || [])
const highRiskConfirmed = computed(() => !selectedHighRiskIds.value.length
  || highRiskConfirmation.value === CONTENT_IMPORT_HIGH_RISK_CONFIRMATION)
const canForceHighRiskItem = (item: CmsContentImportRun['items'][number]) =>
  item.highRiskForceEligible
const canRetryActiveDraftBlock = (item: CmsContentImportRun['items'][number]) =>
  item.status === 'blocked' && item.warningCodes.includes('IMPORT_ACTIVE_DRAFT_EXISTS')
const canSelectItem = (item: CmsContentImportRun['items'][number]) =>
  (item.status === 'pending' || canRetryActiveDraftBlock(item))
  && (item.importable || canForceHighRiskItem(item))
const activeDraftConflict = (item: CmsContentImportRun['items'][number]) => {
  const value = item.conflictDetails.activeDraft
  if (!value || typeof value !== 'object') return null
  const draftId = 'draftId' in value ? value.draftId : null
  const status = 'status' in value ? value.status : null
  return typeof draftId === 'string' && typeof status === 'string'
    ? { draftId, status }
    : null
}
const categoryCounts = computed(() => Object.entries(
  (run.value?.items || []).reduce<Record<string, number>>((result, item) => {
    result[item.classification] = (result[item.classification] || 0) + 1
    return result
  }, {})
))
const statusCounts = computed(() => itemStatuses.map(status => [
  status,
  (run.value?.items || []).filter(item => item.status === status).length
] as const))
const filteredItems = computed(() => (run.value?.items || []).filter(item =>
  (classificationFilter.value === 'all' || item.classification === classificationFilter.value)
  && (statusFilter.value === 'all' || item.status === statusFilter.value)
))
const filteredSelectableItems = computed(() => filteredItems.value.filter(canSelectItem))
const allFilteredSelectableSelected = computed(() => filteredSelectableItems.value.length > 0
  && filteredSelectableItems.value.every(item => selected.value.includes(item.id)))
const toggleAllFilteredSelectable = () => {
  const visibleIds = new Set(filteredSelectableItems.value.map(item => item.id))
  selected.value = allFilteredSelectableSelected.value
    ? selected.value.filter(id => !visibleIds.has(id))
    : [...new Set([...selected.value, ...visibleIds])]
}
const warningText = (code: string) => warningLabels[code] || code
const blockedReason = (item: CmsContentImportRun['items'][number]) => {
  if (item.status !== 'blocked') return null
  const knownReasons = item.warningCodes
    .map(code => warningLabels[code])
    .filter((reason): reason is string => Boolean(reason))
  return knownReasons.length
    ? knownReasons.join(' ')
    : '该项在执行导入时未能创建草稿或提案；这条旧记录没有保存更具体的阻止原因。'
}
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
    classificationFilter.value = 'all'
    statusFilter.value = 'all'
    highRiskConfirmation.value = ''
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
      {
        method: 'POST',
        headers: csrfHeaders(),
        body: {
          itemIds: selected.value,
          forceHighRiskItemIds: selectedHighRiskIds.value,
          highRiskConfirmation: selectedHighRiskIds.value.length
            ? highRiskConfirmation.value : undefined
        }
      }
    )
    run.value = response.run
    selected.value = []
    highRiskConfirmation.value = ''
    message.value = '所选项目已创建为数据库草稿/提案；仍需提交审核、批准和明确发布。'
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
  if (externalActionState(action) === 'succeeded' || externalActionState(action) === 'processing') return
  const prompt = action === 'comment'
    ? '确定要在这个 PR 下留言吗？系统只会发送不含正文和敏感信息的检查摘要；不会合并 PR、批准草稿或发布内容。'
    : '确定要关闭这个 PR 吗？关闭表示不再继续处理这个提案，但不会合并 PR、发布内容，也不会删除已经创建的草稿或成员提案。'
  if (!window.confirm(prompt)) return
  busy.value = true
  externalBusyAction.value = action
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
  } finally {
    externalBusyAction.value = null
    busy.value = false
  }
}

const deleteSourceBranch = async () => {
  if (!run.value?.headRef || run.value.branchCleanup.status !== 'available') return
  if (closeState.value !== 'succeeded' || branchDeleteState.value === 'succeeded'
    || branchDeleteState.value === 'processing') return
  const branch = run.value.headRef
  const confirmation = window.prompt(
    `删除源分支属于不可逆清理操作。请输入完整分支名“${branch}”确认；草稿、提案和审计记录不会被删除。`
  )
  if (confirmation === null) return
  if (confirmation !== branch) {
    failure.value = '分支名输入不一致，未执行删除。'
    return
  }
  busy.value = true
  externalBusyAction.value = 'delete_branch'
  failure.value = ''
  try {
    await $fetch(`/api/cms/content-imports/${run.value.id}/delete-branch`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: { confirm: 'DELETE_PULL_REQUEST_BRANCH', branch }
    })
    await refreshRun()
    message.value = `源分支 ${branch} 已删除；导入草稿、提案和审计记录仍然保留。`
  } catch (error: any) {
    failure.value = error?.data?.message || error?.message || '删除 PR 源分支失败'
  } finally {
    externalBusyAction.value = null
    busy.value = false
  }
}
</script>

<template>
  <section class="cms-page cms-import-page">
    <header class="cms-page-header">
      <div>
        <p class="cms-eyebrow">PULL REQUEST / THREE-WAY REVIEW</p>
        <h1>外部内容导入</h1>
        <p>先检查 PR 改了什么，再把确认安全的内容变成待审核草稿。正式内容始终以数据库为准。</p>
      </div>
    </header>

    <section class="cms-import-guardrail">
      <span class="cms-import-guardrail-icon" aria-hidden="true">✓</span>
      <div>
        <p class="cms-import-kicker">安全边界</p>
        <h2>检查和导入，都不会直接发布内容</h2>
        <p>Dry Run 只读检查；导入只创建待审核草稿或成员提案。不会批准、发布、Merge（合并）PR，也不会写入正式 Revision。</p>
        <p class="cms-import-guardrail-detail">成员 PR 只允许修改公开资料；登录账号、密码、角色权限、账号绑定、会话和安全状态会被直接拒绝。</p>
      </div>
    </section>

    <div v-if="message" class="cms-import-feedback" data-tone="success" role="status">
      <span aria-hidden="true">✓</span><p>{{ message }}</p>
    </div>
    <div v-if="failure" class="cms-import-feedback" data-tone="error" role="alert">
      <span aria-hidden="true">!</span><p>{{ failure }}</p>
    </div>

    <form class="cms-card cms-import-form" @submit.prevent="dryRun">
      <header class="cms-import-form-heading">
        <span class="cms-import-step">01</span>
        <div>
          <p class="cms-import-kicker">开始检查</p>
          <h2>选择一个 Pull Request</h2>
          <p>填入内容仓库和 PR 编号，系统会读取分支起点、当前数据库内容和 PR 提议进行对比。</p>
        </div>
      </header>
      <div class="cms-import-form-fields">
        <label class="cms-import-field cms-import-field-repository">
          <span class="cms-import-field-heading">
            <strong>内容仓库</strong>
            <small>OWNER / REPOSITORY</small>
          </span>
          <span class="cms-import-input-shell">
            <span class="cms-import-input-prefix cms-import-input-prefix-repo" aria-hidden="true">REPO</span>
            <input v-model="repository" class="cms-input" required autocomplete="off" spellcheck="false" placeholder="组织名/仓库名">
          </span>
          <small class="cms-import-field-help">例如：SDUTVINCI/sdutvinci_content</small>
        </label>
        <label class="cms-import-field cms-import-field-pr">
          <span class="cms-import-field-heading">
            <strong>PR 编号</strong>
            <small>PULL REQUEST</small>
          </span>
          <span class="cms-import-input-shell">
            <span class="cms-import-input-prefix cms-import-input-prefix-number" aria-hidden="true">#</span>
            <input v-model.number="pullRequestNumber" class="cms-input" type="number" inputmode="numeric" min="1" required placeholder="123">
          </span>
          <small class="cms-import-field-help">只填数字，不需要粘贴完整链接</small>
        </label>
        <button class="cms-import-run-button" type="submit" :disabled="busy">
          <span>
            <small>READ-ONLY CHECK</small>
            <strong>{{ busy ? '正在读取并检查…' : '执行完整 Dry Run' }}</strong>
          </span>
          <span class="cms-import-run-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </form>

    <template v-if="run">
      <section class="cms-card cms-import-summary">
        <header class="cms-import-summary-heading">
          <div>
            <p class="cms-import-kicker">检查报告</p>
            <h2>PR #{{ run.pullRequestNumber }}</h2>
          </div>
          <span class="cms-import-run-status">{{ runStatusLabels[run.status] }}</span>
        </header>
        <div class="cms-import-commits">
          <article>
            <span>BASE · 分支起点</span>
            <code>{{ run.baseCommitHash }}</code>
          </article>
          <span class="cms-import-commit-arrow" aria-hidden="true">→</span>
          <article>
            <span>HEAD · PR 最新提交</span>
            <code>{{ run.headCommitHash }}</code>
          </article>
        </div>
        <div class="cms-import-stats">
          <article><strong>{{ run.itemCount }}</strong><span>变更文件</span></article>
          <article data-tone="success"><strong>{{ run.importableCount }}</strong><span>可以导入</span></article>
          <article data-tone="danger"><strong>{{ run.conflictCount }}</strong><span>默认阻止 / 冲突</span></article>
          <article data-tone="cyan"><strong>{{ run.importedCount }}</strong><span>已经导入</span></article>
        </div>
        <div class="cms-import-audit-line">
          <span><i aria-hidden="true" />Dry Run 已写入审计记录</span>
          <span>PR 外部操作 {{ run.externalActions.length }} 条</span>
        </div>
        <section class="cms-import-filter-panel" aria-label="导入结果筛选">
          <header>
            <div>
              <strong>结果筛选</strong>
              <span>风险分类和处理状态可组合使用</span>
            </div>
            <span>显示 {{ filteredItems.length }} / {{ run.itemCount }} 项</span>
          </header>
          <div class="cms-import-filter-row">
            <span>风险分类</span>
            <div class="cms-import-category-filters" role="group" aria-label="按风险分类筛选文件">
              <button
                type="button"
                :aria-pressed="classificationFilter === 'all'"
                @click="classificationFilter = 'all'"
              >
                <span>全部分类</span><strong>{{ run.itemCount }}</strong>
              </button>
              <button
                v-for="[classification, itemCount] in categoryCounts"
                :key="classification"
                type="button"
                :aria-pressed="classificationFilter === classification"
                @click="classificationFilter = classification as ContentImportClassification"
              >
                <span>{{ labels[classification as ContentImportClassification] }}</span><strong>{{ itemCount }}</strong>
              </button>
            </div>
          </div>
          <div class="cms-import-filter-row">
            <span>处理状态</span>
            <div class="cms-import-category-filters cms-import-status-filters" role="group" aria-label="按处理状态筛选文件">
              <button
                type="button"
                :aria-pressed="statusFilter === 'all'"
                @click="statusFilter = 'all'"
              >
                <span>全部状态</span><strong>{{ run.itemCount }}</strong>
              </button>
              <button
                v-for="[status, itemCount] in statusCounts"
                :key="status"
                type="button"
                :data-status="status"
                :aria-pressed="statusFilter === status"
                @click="statusFilter = status"
              >
                <span>{{ itemStatusLabels[status] }}</span><strong>{{ itemCount }}</strong>
              </button>
            </div>
          </div>
        </section>
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

      <section class="cms-import-operations">
        <header>
          <div>
            <p class="cms-import-kicker">下一步操作</p>
            <h2>确认检查结果后再继续</h2>
          </div>
          <div class="cms-import-selection-actions">
            <span>{{ selected.length }} 项已选择</span>
            <button
              class="cms-button cms-button-quiet"
              type="button"
              :disabled="!filteredSelectableItems.length || busy"
              @click="toggleAllFilteredSelectable"
            >
              {{ allFilteredSelectableSelected
                ? `取消全选当前结果（${filteredSelectableItems.length}）`
                : `全选当前可导入结果（${filteredSelectableItems.length}）` }}
            </button>
          </div>
        </header>
        <div class="cms-import-toolbar">
          <article class="cms-import-operation" data-tone="primary">
            <span class="cms-import-operation-index">01</span>
            <h3>创建待审核内容</h3>
            <p>安全项目直接创建草稿；高风险 HTML / Vue / MDC 必须逐项勾选并输入确认短语。都不会直接发布。</p>
            <label v-if="selectedHighRiskIds.length" class="cms-import-force-confirmation">
              <span>即将强制导入 {{ selectedHighRiskIds.length }} 个高风险项目。请输入：</span>
              <code>{{ CONTENT_IMPORT_HIGH_RISK_CONFIRMATION }}</code>
              <input
                v-model="highRiskConfirmation"
                class="cms-input"
                autocomplete="off"
                :placeholder="CONTENT_IMPORT_HIGH_RISK_CONFIRMATION"
              >
            </label>
            <button class="cms-button cms-import-operation-button" type="button" :disabled="busy || !selected.length || !highRiskConfirmed" @click="importSelected">
              导入所选项目（{{ selected.length }}）
            </button>
          </article>
          <article class="cms-import-operation" data-tone="comment">
            <span class="cms-import-operation-index">02</span>
            <h3>通知 PR 提交者</h3>
            <p>在 PR 下发送一条脱敏摘要，说明哪些项目可导入、哪些被阻止；不会合并或发布。</p>
            <button
              class="cms-button cms-import-operation-button"
              type="button"
              :data-state="commentState"
              :disabled="busy || commentState === 'succeeded' || commentState === 'processing'"
              @click="externalAction('comment')"
            >
              {{ externalButtonLabel('comment') }}
            </button>
          </article>
          <article v-if="isAdmin" class="cms-import-operation" data-tone="danger">
            <span class="cms-import-operation-index">03</span>
            <h3>结束并清理这个提案</h3>
            <p>先关闭 PR；如源分支位于官方内容仓库，再单独确认删除。草稿、成员提案和审计记录始终保留。</p>
            <button
              class="cms-button cms-import-operation-button"
              type="button"
              :data-state="closeState"
              :disabled="busy || closeState === 'succeeded' || closeState === 'processing'"
              @click="externalAction('close')"
            >
              {{ externalButtonLabel('close') }}
            </button>
            <section v-if="run.headRef" class="cms-import-branch-cleanup" :data-status="run.branchCleanup.status">
              <div>
                <span>关闭后的可选清理</span>
                <code>{{ run.headRepositoryId }}:{{ run.headRef }}</code>
              </div>
              <p>{{ run.branchCleanup.reason }}</p>
              <button
                v-if="run.branchCleanup.status === 'available'"
                class="cms-button cms-import-branch-delete-button"
                type="button"
                :data-state="branchDeleteState"
                :disabled="busy || closeState !== 'succeeded' || branchDeleteState === 'succeeded' || branchDeleteState === 'processing'"
                @click="deleteSourceBranch"
              >
                {{ closeState === 'succeeded' ? branchDeleteButtonLabel : '请先关闭 PR' }}
              </button>
            </section>
          </article>
        </div>
      </section>

      <div class="cms-import-list">
        <article v-for="item in filteredItems" :key="item.id" class="cms-card cms-import-item" :data-risk="!item.importable">
          <header class="cms-import-item-heading">
            <label class="cms-import-select">
              <input v-model="selected" type="checkbox" :value="item.id" :disabled="!canSelectItem(item)">
              <span>
                <small>{{ item.targetType === 'member' ? '成员资料' : '文章内容' }}</small>
                <strong>{{ labels[item.classification] }}</strong>
                <em v-if="canForceHighRiskItem(item) && canRetryActiveDraftBlock(item)">重新尝试强制导入（仍需输入确认短语）</em>
                <em v-else-if="canForceHighRiskItem(item) && item.status === 'pending'">强制导入此高风险项（仍需输入确认短语）</em>
                <em v-else-if="canRetryActiveDraftBlock(item)">重新尝试导入此项</em>
                <em v-else-if="canSelectItem(item)">选择导入此项</em>
              </span>
            </label>
            <span class="cms-import-item-status" :data-status="item.status">{{ itemStatusLabels[item.status] }}</span>
          </header>
          <div class="cms-import-path">
            <code>{{ item.oldPath || '∅' }}</code><span aria-hidden="true">→</span><code>{{ item.newPath || '∅' }}</code>
          </div>
          <p v-if="item.draftId || item.memberProposalId" class="cms-import-item-reference"><template v-if="item.draftId">草稿 {{ item.draftId }}</template><template v-if="item.memberProposalId">成员提案 {{ item.memberProposalId }}</template></p>
          <p v-if="item.proposedArticleId">数据库预分配文章 ID：<code>{{ item.proposedArticleId }}</code></p>
          <p v-if="item.warningCodes.length" class="cms-alert cms-alert-warning">{{ item.warningCodes.map(warningText).join(' ') }}</p>
          <p v-if="blockedReason(item)" class="cms-import-blocked-reason">
            <strong>阻止原因：</strong>{{ blockedReason(item) }}
          </p>
          <p v-if="activeDraftConflict(item)" class="cms-import-item-reference">
            <NuxtLink :to="`/cms/drafts/${activeDraftConflict(item)!.draftId}`">打开冲突草稿并处理</NuxtLink>
          </p>
          <p v-else-if="canRetryActiveDraftBlock(item)" class="cms-import-item-reference">
            这是旧的可重试阻止记录；勾选后系统会重新检查当前是否仍有活动草稿。
          </p>
          <p v-if="canForceHighRiskItem(item) && item.status === 'pending'" class="cms-import-force-warning">
            此项默认阻止。请先查看审计材料；确实需要时可逐项勾选，并在上方输入确认短语后强制创建待审核草稿。
          </p>
          <p v-else-if="item.classification === 'high_risk_syntax' && item.status === 'pending'" class="cms-import-force-warning">
            此项还包含未知扩展语法或三方内容冲突，不能通过高风险人工确认覆盖，需先修改 PR。
          </p>
          <details v-if="Object.keys(item.conflictDetails).length" class="cms-import-conflict">
            <summary>冲突 / 路径 / 引用审计详情</summary>
            <pre>{{ JSON.stringify(item.conflictDetails, null, 2) }}</pre>
          </details>
          <button
            class="cms-button cms-import-diff-trigger"
            type="button"
            :aria-expanded="artifact?.id === item.id"
            :aria-controls="`artifact-${item.id}`"
            @click="showArtifact(item.id)"
          >
            <span>{{ artifact?.id === item.id ? '收起三方审计材料' : '查看 Base（分支起点）/ Current（数据库当前）/ Proposed（PR 提议）/ Merge（合并结果）' }}</span>
            <span aria-hidden="true">{{ artifact?.id === item.id ? '↑' : '↓' }}</span>
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
.cms-import-page {
  display: grid;
  gap: 18px;
  --import-cyan-soft: color-mix(in srgb, var(--cyan) 11%, var(--surface));
  --import-line: color-mix(in srgb, var(--line) 82%, transparent);
}

.cms-import-page > .cms-page-header { margin-bottom: 0; }
.cms-import-page h2, .cms-import-page h3, .cms-import-page p { margin-top: 0; }
.cms-import-kicker { margin-bottom: 5px; color: var(--cyan); font-size: .7rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }

.cms-import-guardrail {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--green) 24%, var(--line));
  border-radius: 16px;
  background: linear-gradient(110deg, color-mix(in srgb, var(--green) 9%, var(--surface)), color-mix(in srgb, var(--surface) 97%, transparent));
  box-shadow: 0 14px 35px color-mix(in srgb, #000 8%, transparent);
}

.cms-import-guardrail-icon,
.cms-import-feedback > span {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--green) 18%, transparent);
  color: var(--green);
  font-weight: 950;
}

.cms-import-guardrail h2 { margin-bottom: 5px; font-size: 1.05rem; letter-spacing: -.015em; }
.cms-import-guardrail p:not(.cms-import-kicker) { margin-bottom: 0; color: var(--ink-soft); font-size: .86rem; line-height: 1.65; }
.cms-import-guardrail .cms-import-guardrail-detail { margin-top: 4px; color: var(--muted); }

.cms-import-feedback {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--green) 42%, var(--line));
  border-radius: 14px;
  background: color-mix(in srgb, var(--green) 12%, var(--surface));
  box-shadow: 0 10px 28px color-mix(in srgb, var(--green) 8%, transparent);
}

.cms-import-feedback p { margin: 0; color: var(--ink); font-size: .9rem; font-weight: 750; }
.cms-import-feedback[data-tone="error"] { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); background: color-mix(in srgb, var(--red) 11%, var(--surface)); }
.cms-import-feedback[data-tone="error"] > span { background: color-mix(in srgb, var(--red) 18%, transparent); color: var(--red); }

.cms-import-form {
  display: block;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--cyan) 25%, var(--line));
}

.cms-import-form::before { display: none; }
.cms-import-form-heading { display: flex; gap: 15px; padding: 22px 24px 18px; border-bottom: 1px solid var(--import-line); }
.cms-import-form-heading h2 { margin-bottom: 5px; font-size: 1.35rem; letter-spacing: -.025em; }
.cms-import-form-heading p:last-child { margin-bottom: 0; color: var(--muted); font-size: .85rem; line-height: 1.55; }
.cms-import-step { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--cyan) 30%, var(--line)); border-radius: 11px; background: var(--import-cyan-soft); color: var(--cyan); font: 800 .72rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }

.cms-import-form-fields { display: grid; grid-template-columns: minmax(300px, 1fr) 210px 270px; gap: 16px; align-items: end; padding: 22px 24px 24px; }
.cms-import-field { display: grid; gap: 8px; min-width: 0; }
.cms-import-field-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.cms-import-field-heading strong { color: var(--ink); font-size: .86rem; }
.cms-import-field-heading small { color: var(--muted); font: 700 .58rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
.cms-import-field-help { color: var(--muted); font-size: .7rem; }

.cms-import-input-shell {
  display: flex;
  min-width: 0;
  height: 54px;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--line) 92%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--paper) 72%, var(--surface));
  box-shadow: 0 1px 0 color-mix(in srgb, #fff 5%, transparent) inset, 0 8px 24px color-mix(in srgb, #000 10%, transparent);
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.cms-import-input-shell:hover { border-color: color-mix(in srgb, var(--cyan) 36%, var(--line)); }
.cms-import-input-shell:focus-within { border-color: var(--cyan); background: color-mix(in srgb, var(--cyan) 4%, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cyan) 14%, transparent), 0 12px 30px color-mix(in srgb, #000 13%, transparent); }
.cms-import-input-prefix { display: grid; flex: 0 0 auto; place-items: center; border-right: 1px solid var(--import-line); background: color-mix(in srgb, var(--cyan) 7%, var(--surface)); color: color-mix(in srgb, var(--cyan) 82%, var(--ink)); }
.cms-import-input-prefix-repo { width: 62px; font: 850 .62rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
.cms-import-input-prefix-number { width: 48px; font-size: 1.25rem; font-weight: 850; }
.cms-input { width: 100%; min-width: 0; border: 0; outline: 0; padding: 0 15px; background: transparent; color: var(--ink); font: 650 .94rem/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; caret-color: var(--cyan); }
.cms-input::placeholder { color: color-mix(in srgb, var(--muted) 62%, transparent); font-weight: 550; }
.cms-input[type="number"] { appearance: textfield; }
.cms-input[type="number"]::-webkit-inner-spin-button, .cms-input[type="number"]::-webkit-outer-spin-button { margin: 0; appearance: none; }

.cms-import-run-button {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 19px;
  padding: 9px 10px 9px 17px;
  border: 1px solid color-mix(in srgb, var(--cyan) 55%, transparent);
  border-radius: 12px;
  background: linear-gradient(115deg, color-mix(in srgb, var(--cyan) 78%, #08343a), color-mix(in srgb, var(--cyan) 45%, #10272b));
  color: #f7ffff;
  cursor: pointer;
  box-shadow: 0 11px 28px color-mix(in srgb, var(--cyan) 17%, transparent);
  transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}

.cms-import-run-button:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 15px 34px color-mix(in srgb, var(--cyan) 23%, transparent); }
.cms-import-run-button:disabled { cursor: wait; filter: saturate(.55); opacity: .62; transform: none; }
.cms-import-run-button > span:first-child { display: grid; gap: 3px; text-align: left; }
.cms-import-run-button small { color: color-mix(in srgb, #fff 62%, transparent); font: 750 .54rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; }
.cms-import-run-button strong { font-size: .9rem; }
.cms-import-run-arrow { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid color-mix(in srgb, #fff 24%, transparent); border-radius: 9px; background: color-mix(in srgb, #fff 10%, transparent); font-size: 1.1rem; }

.cms-import-summary { min-height: 0; gap: 22px; padding: 26px; }
.cms-import-summary::before { width: 132px; height: 132px; }
.cms-import-summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.cms-import-summary-heading h2 { margin: 0; font-size: clamp(1.7rem, 3vw, 2.35rem); letter-spacing: -.045em; }
.cms-import-run-status { position: relative; z-index: 1; padding: 7px 11px; border: 1px solid color-mix(in srgb, var(--green) 32%, var(--line)); border-radius: 999px; background: color-mix(in srgb, var(--green) 10%, var(--surface)); color: var(--green); font-size: .75rem; font-weight: 850; }
.cms-import-commits { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 12px; align-items: center; }
.cms-import-commits article { display: grid; gap: 7px; min-width: 0; padding: 13px 15px; border: 1px solid var(--import-line); border-radius: 12px; background: color-mix(in srgb, var(--paper) 56%, var(--surface)); }
.cms-import-commits span { color: var(--muted); font: 750 .62rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .07em; }
.cms-import-commits code { overflow: hidden; color: var(--ink-soft); font-size: .74rem; text-overflow: ellipsis; white-space: nowrap; }
.cms-import-commit-arrow { color: var(--cyan) !important; font-size: 1.1rem !important; }
.cms-import-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--import-line); border-radius: 14px; }
.cms-import-stats article { display: grid; gap: 4px; padding: 16px 18px; border-right: 1px solid var(--import-line); background: color-mix(in srgb, var(--paper) 40%, var(--surface)); }
.cms-import-stats article:last-child { border-right: 0; }
.cms-import-stats strong { color: var(--ink); font-size: 1.65rem; letter-spacing: -.04em; line-height: 1; }
.cms-import-stats span { color: var(--muted); font-size: .72rem; }
.cms-import-stats article[data-tone="success"] strong { color: var(--green); }
.cms-import-stats article[data-tone="danger"] strong { color: var(--red); }
.cms-import-stats article[data-tone="cyan"] strong { color: var(--cyan); }
.cms-import-audit-line { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; color: var(--muted); font-size: .76rem; }
.cms-import-audit-line span { display: inline-flex; gap: 7px; align-items: center; }
.cms-import-audit-line i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 9px color-mix(in srgb, var(--green) 75%, transparent); }
.cms-import-categories { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 0; padding: 0; list-style: none; }
.cms-import-categories li { display: inline-flex; gap: 8px; align-items: center; padding: 6px 8px 6px 11px; border: 1px solid var(--import-line); border-radius: 999px; background: color-mix(in srgb, var(--paper) 46%, var(--surface)); color: var(--ink-soft); font-size: .72rem; }
.cms-import-categories strong { display: grid; min-width: 21px; height: 21px; place-items: center; border-radius: 999px; background: var(--import-cyan-soft); color: var(--cyan); font-size: .68rem; }

.cms-import-actions { display: grid; gap: 9px; padding-top: 2px; }
.cms-import-action-result { display: flex; align-items: center; gap: 12px; padding: 13px 15px; border: 1px solid; border-radius: 13px; }
.cms-import-action-result[data-status="succeeded"] { border-color: color-mix(in srgb, var(--green) 45%, var(--line)); background: color-mix(in srgb, var(--green) 11%, var(--surface)); }
.cms-import-action-result[data-status="failed"] { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); background: color-mix(in srgb, var(--red) 11%, var(--surface)); }
.cms-import-action-result[data-status="processing"] { border-color: color-mix(in srgb, #d97706 45%, var(--line)); background: color-mix(in srgb, #d97706 11%, var(--surface)); }
.cms-import-action-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: #64748b; color: white; font-size: 1rem; font-weight: 950; }
.cms-import-action-result[data-status="succeeded"] .cms-import-action-icon { background: #15803d; }
.cms-import-action-result[data-status="failed"] .cms-import-action-icon { background: #b91c1c; }
.cms-import-action-result[data-status="processing"] .cms-import-action-icon { background: #b45309; }
.cms-import-action-result > span:last-child { display: grid; gap: 2px; }
.cms-import-action-result strong { font-size: .9rem; }
.cms-import-action-result small { color: var(--muted); font-size: .76rem; }

.cms-import-operations { display: grid; gap: 14px; padding-top: 8px; }
.cms-import-operations > header { display: flex; align-items: end; justify-content: space-between; gap: 18px; }
.cms-import-operations > header h2 { margin-bottom: 0; font-size: 1.35rem; letter-spacing: -.025em; }
.cms-import-selection-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 9px; }
.cms-import-selection-actions > span { padding: 6px 10px; border-radius: 999px; background: var(--import-cyan-soft); color: var(--cyan); font-size: .72rem; font-weight: 850; }
.cms-import-selection-actions .cms-button { min-height: 36px; padding: 7px 11px; font-size: .75rem; }
.cms-import-toolbar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.cms-import-operation { position: relative; display: flex; min-height: 205px; flex-direction: column; gap: 7px; padding: 18px; overflow: hidden; border: 1px solid var(--import-line); border-radius: 16px; background: color-mix(in srgb, var(--surface) 96%, var(--cyan) 4%); box-shadow: 0 12px 30px color-mix(in srgb, #000 8%, transparent); }
.cms-import-operation::after { position: absolute; top: -35px; right: -35px; width: 92px; height: 92px; border: 1px solid color-mix(in srgb, var(--cyan) 12%, transparent); border-radius: 50%; content: ""; }
.cms-import-operation-index { color: var(--cyan); font: 850 .64rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
.cms-import-operation h3 { margin-bottom: 2px; font-size: 1rem; }
.cms-import-operation p { margin-bottom: 15px; color: var(--muted); font-size: .78rem; line-height: 1.6; }
.cms-import-operation-button { width: 100%; min-height: 44px; margin-top: auto; border-color: color-mix(in srgb, var(--cyan) 32%, var(--line)); background: var(--import-cyan-soft); color: color-mix(in srgb, var(--cyan) 88%, var(--ink)); }
.cms-import-operation-button:hover { border-color: var(--cyan); background: color-mix(in srgb, var(--cyan) 17%, var(--surface)); transform: translateY(-1px); }
.cms-import-operation-button[data-state="succeeded"],
.cms-import-operation-button[data-state="succeeded"]:hover {
  border-color: color-mix(in srgb, var(--green) 42%, var(--line));
  background: color-mix(in srgb, var(--green) 13%, var(--surface));
  color: var(--green);
  cursor: default;
  opacity: 1;
  transform: none;
}
.cms-import-force-confirmation { display: grid; gap: 7px; margin: 3px 0 10px; padding: 12px; border: 1px solid color-mix(in srgb, #d97706 45%, var(--line)); border-radius: 11px; background: color-mix(in srgb, #d97706 9%, var(--surface)); }
.cms-import-force-confirmation span { color: var(--ink-soft); font-size: .75rem; line-height: 1.45; }
.cms-import-force-confirmation code { color: #d97706; font-size: .73rem; font-weight: 850; }
.cms-import-force-confirmation .cms-input { height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); font-size: .78rem; }
.cms-import-force-warning { margin: 12px 0 0; padding: 11px 13px; border-left: 4px solid #d97706; background: color-mix(in srgb, #d97706 10%, var(--surface)); color: var(--ink-soft); font-size: .78rem; line-height: 1.55; }
.cms-import-operation[data-tone="primary"] { border-color: color-mix(in srgb, var(--green) 26%, var(--line)); }
.cms-import-operation[data-tone="primary"] .cms-import-operation-index { color: var(--green); }
.cms-import-operation[data-tone="primary"] .cms-import-operation-button { border-color: color-mix(in srgb, var(--green) 32%, var(--line)); background: color-mix(in srgb, var(--green) 13%, var(--surface)); color: var(--green); }
.cms-import-operation[data-tone="danger"] { border-color: color-mix(in srgb, var(--red) 24%, var(--line)); }
.cms-import-operation[data-tone="danger"]::after { border-color: color-mix(in srgb, var(--red) 12%, transparent); }
.cms-import-operation[data-tone="danger"] .cms-import-operation-index { color: var(--red); }
.cms-import-operation[data-tone="danger"] .cms-import-operation-button { border-color: color-mix(in srgb, var(--red) 30%, var(--line)); background: transparent; color: var(--red); }
.cms-import-operation[data-tone="danger"] .cms-import-operation-button:hover { border-color: var(--red); background: color-mix(in srgb, var(--red) 10%, var(--surface)); }
.cms-import-operation[data-tone="danger"] .cms-import-operation-button[data-state="succeeded"],
.cms-import-operation[data-tone="danger"] .cms-import-operation-button[data-state="succeeded"]:hover {
  border-color: color-mix(in srgb, var(--green) 42%, var(--line));
  background: color-mix(in srgb, var(--green) 13%, var(--surface));
  color: var(--green);
}
.cms-import-branch-cleanup { display: grid; gap: 7px; margin-top: 9px; padding-top: 12px; border-top: 1px dashed color-mix(in srgb, var(--red) 24%, var(--line)); }
.cms-import-branch-cleanup > div { display: grid; gap: 4px; }
.cms-import-branch-cleanup span { color: var(--ink-soft); font-size: .69rem; font-weight: 850; letter-spacing: .04em; }
.cms-import-branch-cleanup code { overflow: hidden; color: var(--muted); font-size: .68rem; text-overflow: ellipsis; white-space: nowrap; }
.cms-import-branch-cleanup p { margin: 0; font-size: .7rem; line-height: 1.5; }
.cms-import-branch-delete-button { width: 100%; min-height: 38px; border-color: color-mix(in srgb, var(--red) 32%, var(--line)); background: color-mix(in srgb, var(--red) 7%, var(--surface)); color: var(--red); font-size: .73rem; }
.cms-import-branch-delete-button:hover { border-color: var(--red); background: color-mix(in srgb, var(--red) 12%, var(--surface)); }
.cms-import-branch-delete-button[data-state="succeeded"],
.cms-import-branch-delete-button[data-state="succeeded"]:hover { border-color: color-mix(in srgb, var(--green) 42%, var(--line)); background: color-mix(in srgb, var(--green) 13%, var(--surface)); color: var(--green); cursor: default; opacity: 1; }

.cms-import-list { display: grid; gap: 12px; padding-top: 4px; }
.cms-import-item { min-height: 0; gap: 14px; padding: 21px 22px; overflow: visible; }
.cms-import-item::before { width: 74px; height: 74px; }
.cms-import-item[data-risk="true"] { --card-accent: var(--red); border-color: color-mix(in srgb, var(--red) 32%, var(--line)); }
.cms-import-item-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.cms-import-select { display: flex; min-width: 0; gap: 12px; align-items: center; cursor: pointer; }
.cms-import-select input { width: 19px; height: 19px; flex: 0 0 auto; accent-color: var(--cyan); }
.cms-import-select input:disabled { cursor: not-allowed; opacity: .45; }
.cms-import-select > span { display: grid; gap: 3px; }
.cms-import-select small { color: var(--muted); font-size: .66rem; font-weight: 750; letter-spacing: .08em; }
.cms-import-select strong { color: var(--ink); font-size: 1rem; }
.cms-import-item-status { position: relative; z-index: 1; flex: 0 0 auto; padding: 6px 9px; border: 1px solid var(--import-line); border-radius: 999px; background: color-mix(in srgb, var(--paper) 44%, var(--surface)); color: var(--muted); font-size: .68rem; font-weight: 800; }
.cms-import-item-status[data-status="imported"] { border-color: color-mix(in srgb, var(--green) 28%, var(--line)); color: var(--green); }
.cms-import-item-status[data-status="blocked"] { border-color: color-mix(in srgb, var(--red) 28%, var(--line)); color: var(--red); }
.cms-import-path { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 11px 13px; border: 1px solid var(--import-line); border-radius: 11px; background: color-mix(in srgb, var(--paper) 54%, var(--surface)); }
.cms-import-path code { min-width: 0; overflow: hidden; color: var(--ink-soft); font-size: .74rem; text-overflow: ellipsis; white-space: nowrap; }
.cms-import-path span { color: var(--cyan); }
.cms-import-item-reference { width: fit-content; margin-bottom: 0; padding: 5px 8px; border-radius: 7px; background: var(--import-cyan-soft); color: var(--cyan); font-size: .72rem; font-weight: 750; }
.cms-import-item > p { margin-bottom: 0; color: var(--muted); font-size: .8rem; }
.cms-import-item code, .cms-import-summary code { overflow-wrap: anywhere; }
.cms-import-conflict { border: 1px solid var(--import-line); border-radius: 10px; background: color-mix(in srgb, var(--paper) 42%, var(--surface)); }
.cms-import-conflict summary { padding: 11px 13px; color: var(--ink-soft); cursor: pointer; font-size: .78rem; font-weight: 750; }
.cms-import-conflict pre { max-height: 240px; margin: 0; padding: 0 13px 13px; overflow: auto; white-space: pre-wrap; }
.cms-import-diff-trigger { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 14px; border-color: var(--import-line); background: color-mix(in srgb, var(--paper) 38%, var(--surface)); color: var(--ink-soft); text-align: left; }
.cms-import-diff-trigger:hover { border-color: color-mix(in srgb, var(--cyan) 40%, var(--line)); background: var(--import-cyan-soft); color: var(--cyan); }

.cms-import-artifact { margin-top: 2px; padding-top: 4px; border-top: 1px solid var(--import-line); }
.cms-import-artifact .cms-section-heading { margin-top: 20px; }
.cms-import-diff-panel { margin-top: 12px; overflow: hidden; border: 1px solid var(--import-line); border-radius: 13px; background: color-mix(in srgb, var(--paper) 35%, var(--surface)); }
.cms-import-diff-panel > header { padding: 13px 15px; border-bottom: 1px solid var(--import-line); background: color-mix(in srgb, var(--cyan) 5%, var(--surface)); }
.cms-import-diff-panel h4, .cms-import-diff-panel p { margin: 0; }
.cms-import-diff-panel h4 { font-size: .9rem; }
.cms-import-diff-panel header p { margin-top: 4px; color: var(--muted); font-size: .76rem; line-height: 1.5; }
.cms-import-diff { max-height: 460px; overflow: auto; background: color-mix(in srgb, var(--paper) 62%, #0c1114); font: .79rem/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.cms-import-diff-line { display: grid; grid-template-columns: 3.5rem 3.5rem 1.75rem minmax(max-content, 1fr); min-height: 1.6rem; border-left: 3px solid transparent; }
.cms-import-diff-line[data-kind="added"] { border-left-color: #22c55e; background: rgba(34, 197, 94, .17); }
.cms-import-diff-line[data-kind="removed"] { border-left-color: #ef4444; background: rgba(239, 68, 68, .17); }
.cms-import-diff-line code { padding: 0 .75rem 0 .25rem; white-space: pre; color: inherit; }
.cms-import-diff-number, .cms-import-diff-prefix { padding: 0 .45rem; border-right: 1px solid color-mix(in srgb, var(--line) 55%, transparent); background: rgba(127,127,127,.07); color: color-mix(in srgb, currentColor 52%, transparent); text-align: right; user-select: none; }
.cms-import-diff-prefix { text-align: center; font-weight: 900; }
.cms-import-diff-line[data-kind="added"] .cms-import-diff-prefix { color: #4ade80; }
.cms-import-diff-line[data-kind="removed"] .cms-import-diff-prefix { color: #f87171; }
.cms-import-diff-empty { margin: 0; padding: 14px 15px; border-left: 4px solid #d97706; background: rgba(245, 158, 11, .1); color: var(--ink-soft); font-size: .8rem; }

.cms-import-category-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 0;
}

.cms-import-filter-panel { display: grid; gap: 15px; padding: 17px 18px; border: 1px solid var(--import-line); border-radius: 14px; background: color-mix(in srgb, var(--paper) 38%, var(--surface)); }
.cms-import-filter-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cms-import-filter-panel > header > div { display: grid; gap: 3px; }
.cms-import-filter-panel > header strong { color: var(--ink); font-size: .88rem; }
.cms-import-filter-panel > header span { color: var(--muted); font-size: .72rem; }
.cms-import-filter-panel > header > span { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: var(--import-cyan-soft); color: var(--cyan); font-weight: 800; }
.cms-import-filter-row { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 12px; align-items: start; }
.cms-import-filter-row > span { padding-top: 9px; color: var(--muted); font-size: .7rem; font-weight: 800; letter-spacing: .05em; }

.cms-import-category-filters button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border: 1px solid var(--import-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-size: .76rem;
  font-weight: 750;
}

.cms-import-category-filters button[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--cyan) 62%, var(--line));
  background: var(--import-cyan-soft);
  color: var(--ink);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--cyan) 10%, transparent);
}

.cms-import-category-filters strong {
  min-width: 1.5rem;
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cyan) 12%, transparent);
  color: var(--cyan);
  text-align: center;
}

.cms-import-status-filters button[data-status="imported"] strong { color: var(--green); }
.cms-import-status-filters button[data-status="blocked"] strong { color: var(--red); }
.cms-import-status-filters button[data-status="skipped"] strong { color: #d97706; }
.cms-import-blocked-reason { padding: 11px 13px; border-left: 4px solid var(--red); background: color-mix(in srgb, var(--red) 9%, var(--surface)); color: var(--ink-soft) !important; line-height: 1.55; }
.cms-import-blocked-reason strong { color: var(--red); }

.cms-import-select em {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: .7rem;
  font-style: normal;
  font-weight: 650;
}

.cms-import-item[data-risk="true"] .cms-import-select em {
  color: var(--red);
}

@media (max-width: 1080px) {
  .cms-import-form-fields { grid-template-columns: minmax(260px, 1fr) 180px; }
  .cms-import-run-button { grid-column: 1 / -1; margin-bottom: 0; }
  .cms-import-toolbar { grid-template-columns: 1fr; }
  .cms-import-operation { min-height: 0; }
}

@media (max-width: 700px) {
  .cms-import-page { gap: 14px; }
  .cms-import-guardrail { padding: 16px; }
  .cms-import-form-heading { padding: 18px 17px 15px; }
  .cms-import-form-fields { grid-template-columns: 1fr; padding: 18px 17px 20px; }
  .cms-import-run-button { grid-column: auto; }
  .cms-import-field-heading small { display: none; }
  .cms-import-summary { padding: 20px 17px; }
  .cms-import-summary-heading { align-items: flex-start; flex-direction: column; }
  .cms-import-filter-panel > header { align-items: flex-start; flex-direction: column; }
  .cms-import-filter-row { grid-template-columns: 1fr; gap: 5px; }
  .cms-import-filter-row > span { padding-top: 0; }
  .cms-import-commits { grid-template-columns: 1fr; }
  .cms-import-commit-arrow { transform: rotate(90deg); justify-self: center; }
  .cms-import-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cms-import-stats article:nth-child(2) { border-right: 0; }
  .cms-import-stats article:nth-child(-n+2) { border-bottom: 1px solid var(--import-line); }
  .cms-import-operations > header { align-items: flex-start; flex-direction: column; }
  .cms-import-selection-actions { width: 100%; justify-content: flex-start; }
  .cms-import-item { padding: 18px 16px; }
  .cms-import-item-heading { align-items: flex-start; }
  .cms-import-path { grid-template-columns: 1fr; }
  .cms-import-path span { transform: rotate(90deg); justify-self: center; }
  .cms-import-diff-trigger span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cms-import-diff-line { grid-template-columns: 2.5rem 2.5rem 1.5rem minmax(max-content, 1fr); }
}
</style>
