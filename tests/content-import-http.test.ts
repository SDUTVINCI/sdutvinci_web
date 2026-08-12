import { describe, expect, it } from 'vitest'
import { ContentImportGitHubError } from '../server/services/content-import-github'
import { throwContentImportHttpError } from '../server/utils/content-import-http'
import { getContentImportConfig, resetContentImportConfigForTests } from '../server/utils/content-import-config'
import { contentImportSelectionSchema } from '../server/utils/content-import-request'
import { CONTENT_IMPORT_HIGH_RISK_CONFIRMATION } from '../shared/types/cms-content-imports'

describe('内容 PR 导入 HTTP 错误', () => {
  it('默认允许最多 500 个 PR 文件，同时保留有界上限', () => {
    const previous = process.env.CONTENT_PR_IMPORT_MAX_FILES
    delete process.env.CONTENT_PR_IMPORT_MAX_FILES
    resetContentImportConfigForTests()
    try {
      expect(getContentImportConfig().CONTENT_PR_IMPORT_MAX_FILES).toBe(500)
    } finally {
      if (previous === undefined) delete process.env.CONTENT_PR_IMPORT_MAX_FILES
      else process.env.CONTENT_PR_IMPORT_MAX_FILES = previous
      resetContentImportConfigForTests()
    }
  })

  it('批量导入项目数量跟随同一个 500 文件上限', () => {
    const ids = Array.from({ length: 500 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    expect(contentImportSelectionSchema().parse({ itemIds: ids }).itemIds).toHaveLength(500)
    expect(() => contentImportSelectionSchema().parse({
      itemIds: [...ids, '00000000-0000-4000-8000-000000000500']
    })).toThrow()
  })

  it('高风险强制项必须属于所选项并提供准确确认短语', () => {
    const itemId = '00000000-0000-4000-8000-000000000001'
    expect(contentImportSelectionSchema().parse({
      itemIds: [itemId],
      forceHighRiskItemIds: [itemId],
      highRiskConfirmation: CONTENT_IMPORT_HIGH_RISK_CONFIRMATION
    }).forceHighRiskItemIds).toEqual([itemId])
    expect(() => contentImportSelectionSchema().parse({
      itemIds: [itemId], forceHighRiskItemIds: [itemId], highRiskConfirmation: '确认'
    })).toThrow()
    expect(() => contentImportSelectionSchema().parse({
      itemIds: [itemId],
      forceHighRiskItemIds: ['00000000-0000-4000-8000-000000000002'],
      highRiskConfirmation: CONTENT_IMPORT_HIGH_RISK_CONFIRMATION
    })).toThrow()
  })

  it('将 PR 文件数量上限显示为本地安全限制，而不是 GitHub API 故障', () => {
    expect(() => throwContentImportHttpError(
      new ContentImportGitHubError('GITHUB_PULL_FILE_LIMIT_EXCEEDED', 422)
    )).toThrow(expect.objectContaining({
      statusCode: 422,
      message: 'PR 文件数量超过服务器允许的导入上限',
      data: { code: 'GITHUB_PULL_FILE_LIMIT_EXCEEDED' }
    }))
  })

  it('其他 GitHub API 错误继续使用脱敏通用提示', () => {
    expect(() => throwContentImportHttpError(
      new ContentImportGitHubError('GITHUB_API_FAILED', 503)
    )).toThrow(expect.objectContaining({
      statusCode: 503,
      message: 'GitHub API 请求失败；已保留脱敏错误码',
      data: { code: 'GITHUB_API_FAILED' }
    }))
  })
})
