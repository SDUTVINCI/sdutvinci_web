import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { CmsDashboardStats } from '../../shared/types/cms-dashboard'
import { cmsDraftStatuses } from '../../shared/types/cms-drafts'
import { getDatabase } from '../db/client'
import {
  articles,
  contentReconciliationRequests,
  contentReconciliationRuns,
  drafts,
  members
} from '../db/schema'
import { refreshCmsArticlesForRequest } from './cms-articles'

export const getCmsDashboardStats = async (
  userId: string,
  isAdmin: boolean
): Promise<CmsDashboardStats> => {
  await refreshCmsArticlesForRequest()
  const db = getDatabase()
  const draftFilter = and(
    isNull(drafts.deletedAt),
    ...(isAdmin ? [] : [eq(drafts.ownerUserId, userId)])
  )
  const [
    publishedRows,
    deletedRows,
    memberRows,
    draftRows,
    pendingRows,
    reconciliationRows,
    reconciliationRequestRows
  ] = await Promise.all([
    db.select({ value: count() }).from(articles).where(and(
      eq(articles.isPresent, 'true'),
      isNull(articles.deletedAt)
    )),
    db.select({ value: count() }).from(articles).where(isNotNull(articles.deletedAt)),
    db.select({ value: count() }).from(members),
    db.select({ status: drafts.status, value: count() })
      .from(drafts)
      .where(draftFilter)
      .groupBy(drafts.status),
    db.select({ value: count() }).from(drafts).where(and(
      eq(drafts.status, 'pending_review'),
      isNull(drafts.deletedAt)
    )),
    db.select().from(contentReconciliationRuns)
      .orderBy(desc(contentReconciliationRuns.startedAt))
      .limit(1),
    db.select().from(contentReconciliationRequests)
      .orderBy(desc(contentReconciliationRequests.createdAt))
      .limit(1)
  ])
  const byStatus = Object.fromEntries(cmsDraftStatuses.map(status => [status, 0])) as
    CmsDashboardStats['drafts']['byStatus']
  for (const row of draftRows) {
    if (cmsDraftStatuses.includes(row.status as keyof typeof byStatus)) {
      byStatus[row.status as keyof typeof byStatus] = row.value
    }
  }
  return {
    articles: {
      published: publishedRows[0]?.value || 0,
      deleted: deletedRows[0]?.value || 0
    },
    drafts: {
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      byStatus,
      scope: isAdmin ? 'all' : 'mine'
    },
    pendingReviews: pendingRows[0]?.value || 0,
    members: memberRows[0]?.value || 0,
    reconciliation: reconciliationRows[0]
      ? {
          status: reconciliationRows[0].status as
            'processing' | 'succeeded' | 'failed' | 'busy',
          startedAt: reconciliationRows[0].startedAt.toISOString(),
          completedAt: reconciliationRows[0].completedAt?.toISOString() || null,
          resultCommitHash: reconciliationRows[0].resultCommitHash,
          differenceCount:
            reconciliationRows[0].addedCount
            + reconciliationRows[0].missingCount
            + reconciliationRows[0].modifiedCount
            + reconciliationRows[0].extraCount
            + reconciliationRows[0].metadataMismatchCount,
          summary: reconciliationRows[0].status === 'failed'
            ? '全量对账失败；请由维护者查看脱敏运维报告。'
            : reconciliationRows[0].status === 'busy'
              ? '增量导出或另一轮对账正在运行，本轮未写仓库。'
              : null
        }
      : null,
    reconciliationRequest: reconciliationRequestRows[0]
      ? {
          id: reconciliationRequestRows[0].id,
          status: reconciliationRequestRows[0].status as
            'pending' | 'processing' | 'succeeded' | 'failed' | 'busy',
          createdAt: reconciliationRequestRows[0].createdAt.toISOString(),
          completedAt: reconciliationRequestRows[0].completedAt?.toISOString() || null,
          errorSummary: reconciliationRequestRows[0].errorSummary
        }
      : null
  }
}
