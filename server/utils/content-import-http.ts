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
        IMPORT_GITHUB_WRITE_NOT_CONFIGURED: '未配置 GitHub 外部写权限',
        IMPORT_PULL_REQUEST_CHANGED: 'PR Head 已变化，请重新 Dry Run'
      } as Record<string, string>)[error.code] || '外部内容导入被安全拒绝',
      data: { code: error.code }
    })
  }
  if (error instanceof ContentImportGitHubError) {
    throw createError({
      statusCode: error.status,
      message: 'GitHub API 请求失败；已保留脱敏错误码',
      data: { code: error.code }
    })
  }
  throw error
}
