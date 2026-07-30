import { and, desc, eq } from 'drizzle-orm'
import type { CmsArticleDetail } from '../../shared/types/cms-articles'
import { getDatabase } from '../db/client'
import { contentExportJobs } from '../db/schema'

const cmsExportFailureMessage = (code: string) => {
  switch (code) {
    case 'CONTENT_EXPORT_GIT_FAILED':
      return '内容仓库暂时不可写或拒绝了更新；数据库正式状态不受影响。'
    case 'CONTENT_EXPORT_CONSISTENCY_FAILED':
      return '内容仓库一致性检查未通过；导出已安全停止，数据库正式状态不受影响。'
    default:
      return '导出失败详情已记录并脱敏；数据库正式状态不受影响。'
  }
}

export const getCmsArticleExportStatus = async (
  articleId: string,
  currentRevisionId: string | null,
  enabled: boolean
): Promise<CmsArticleDetail['exportStatus']> => {
  if (!enabled) {
    return {
      state: 'not_applicable',
      currentRevisionId,
      currentJobId: null,
      currentJobStatus: null,
      currentJobAttemptCount: null,
      currentJobNextAttemptAt: null,
      currentJobLastErrorCode: null,
      currentJobLastError: null,
      canRetry: false,
      latestExportedRevisionId: null,
      latestExportedCommitHash: null
    }
  }

  const db = getDatabase()
  const [currentJob, latestExported] = await Promise.all([
    currentRevisionId
      ? db
          .select()
          .from(contentExportJobs)
          .where(and(
            eq(contentExportJobs.targetType, 'article'),
            eq(contentExportJobs.targetId, articleId),
            eq(contentExportJobs.revisionId, currentRevisionId)
          ))
          .orderBy(desc(contentExportJobs.createdAt))
          .limit(1)
          .then(rows => rows[0] || null)
      : Promise.resolve(null),
    db
      .select()
      .from(contentExportJobs)
      .where(and(
        eq(contentExportJobs.targetType, 'article'),
        eq(contentExportJobs.targetId, articleId),
        eq(contentExportJobs.status, 'succeeded')
      ))
      .orderBy(desc(contentExportJobs.completedAt), desc(contentExportJobs.createdAt))
      .limit(1)
      .then(rows => rows[0] || null)
  ])

  const currentJobStatus = currentJob?.status as
    | 'pending'
    | 'processing'
    | 'succeeded'
    | 'failed'
    | undefined
  const state: CmsArticleDetail['exportStatus']['state'] =
    !currentRevisionId
      ? 'untracked'
      : currentJobStatus === 'pending' || currentJobStatus === 'processing'
        ? 'waiting_export'
        : currentJobStatus === 'failed'
          ? 'export_failed'
          : currentJobStatus === 'succeeded'
            ? 'synchronized'
            : latestExported
              ? 'export_behind'
              : 'untracked'

  return {
    state,
    currentRevisionId,
    currentJobId: currentJob?.id || null,
    currentJobStatus: currentJobStatus || null,
    currentJobAttemptCount: currentJob?.attemptCount ?? null,
    currentJobNextAttemptAt: currentJobStatus === 'pending'
      ? currentJob?.nextAttemptAt.toISOString() || null
      : null,
    currentJobLastErrorCode: currentJob?.lastErrorCode || null,
    currentJobLastError: currentJob?.lastErrorCode
      ? cmsExportFailureMessage(currentJob.lastErrorCode)
      : null,
    canRetry: currentJobStatus === 'failed',
    latestExportedRevisionId: latestExported?.revisionId || null,
    latestExportedCommitHash: latestExported?.exportedCommitHash || null
  }
}
