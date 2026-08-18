import { createError, type H3Event } from 'h3'
import { ContentImportGitHubError } from '../services/content-import-github'
import {
  canUseContentPrImport,
  ContentPrImportError,
  requireContentPrImportEnabled
} from '../services/content-pr-import'
import { requireCmsRequestAuth } from './cms-http'

export const requireContentImportAuth = async (event: H3Event) => {
  const auth = await requireCmsRequestAuth(event)
  try {
    requireContentPrImportEnabled()
  } catch (error) {
    throwContentImportHttpError(error)
  }
  if (!canUseContentPrImport(auth.user.roles)) {
    throw createError({ statusCode: 403, message: '没有外部内容导入权限' })
  }
  return auth
}

export const throwContentImportHttpError = (error: unknown): never => {
  if (error instanceof ContentPrImportError) {
    throw createError({
      statusCode: error.status,
      message: ({
        CONTENT_PR_IMPORT_DISABLED: '外部内容导入未启用',
        IMPORT_REPOSITORY_FORBIDDEN: '只允许配置的 Vinci 内容仓库',
        IMPORT_PULL_REQUEST_INVALID: 'PR 不合法、已关闭或不是以 main 为基线',
        IMPORT_PULL_FILE_COUNT_INVALID: 'PR 文件数量不合法',
        IMPORT_BASE_SNAPSHOT_UNAVAILABLE: '无法读取 PR Base Snapshot',
        IMPORT_BASE_SNAPSHOT_INVALID: 'PR Base Snapshot 格式不合法',
        IMPORT_BASE_SNAPSHOT_DUPLICATE: 'PR Base Snapshot 存在重复 ID 或路径',
        IMPORT_RUN_NOT_FOUND: '导入运行不存在',
        IMPORT_ITEM_NOT_FOUND: '导入项目不存在',
        IMPORT_ITEM_COUNT_INVALID: '所选导入项目数量不合法',
        IMPORT_HIGH_RISK_SELECTION_INVALID: '只能强制导入已明确选择的高风险文章项目',
        IMPORT_HIGH_RISK_CONFIRMATION_REQUIRED: '强制导入高风险内容需要输入指定确认短语',
        IMPORT_GITHUB_WRITE_NOT_CONFIGURED: '未配置 GitHub 外部写权限',
        IMPORT_PULL_REQUEST_CHANGED: 'PR 源分支或 Head 已变化，请重新 Dry Run',
        IMPORT_EXTERNAL_ACTION_IN_PROGRESS: '同一项 GitHub 操作正在执行，请稍后刷新',
        IMPORT_BRANCH_CLEANUP_NOT_CONFIGURED: '服务器未配置独立的 PR 源分支清理权限',
        IMPORT_BRANCH_CLEANUP_EXTERNAL_FORK: '外部 Fork 的源分支必须由提交者自行删除',
        IMPORT_BRANCH_CLEANUP_CONFIRMATION_INVALID: '源分支名称确认不匹配，已拒绝删除',
        IMPORT_BRANCH_CLEANUP_REQUIRES_CLOSED_PR: '必须先成功关闭 PR，才能删除源分支'
      } as Record<string, string>)[error.code] || '外部内容导入被安全拒绝',
      data: { code: error.code }
    })
  }
  if (error instanceof ContentImportGitHubError) {
    if (error.code === 'GITHUB_PULL_FILE_LIMIT_EXCEEDED') {
      throw createError({
        statusCode: error.status,
        message: 'PR 文件数量超过服务器允许的导入上限',
        data: { code: error.code }
      })
    }
    if (error.code === 'GITHUB_BRANCH_DELETE_REJECTED') {
      throw createError({
        statusCode: error.status,
        message: 'GitHub 拒绝删除源分支；请确认它不是默认分支或受保护分支',
        data: { code: error.code }
      })
    }
    throw createError({
      statusCode: error.status,
      message: 'GitHub API 请求失败；已保留脱敏错误码',
      data: { code: error.code }
    })
  }
  throw error
}
