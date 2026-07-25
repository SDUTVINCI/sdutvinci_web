import { and, count, eq, isNotNull, isNull } from 'drizzle-orm'
import type { CmsDashboardStats } from '../../shared/types/cms-dashboard'
import { cmsDraftStatuses } from '../../shared/types/cms-drafts'
import { getDatabase } from '../db/client'
import { articles, drafts, members } from '../db/schema'
import { synchronizeCmsArticles } from './cms-articles'

export const getCmsDashboardStats = async (
  userId: string,
  isAdmin: boolean
): Promise<CmsDashboardStats> => {
  await synchronizeCmsArticles()
  const db = getDatabase()
  const draftFilter = and(
    isNull(drafts.deletedAt),
    ...(isAdmin ? [] : [eq(drafts.ownerUserId, userId)])
  )
  const [publishedRows, deletedRows, memberRows, draftRows, pendingRows] = await Promise.all([
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
    ))
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
    members: memberRows[0]?.value || 0
  }
}
