import type { CmsDraftStatus } from './cms-drafts'

export interface CmsDashboardStats {
  articles: {
    published: number
    deleted: number
  }
  drafts: {
    total: number
    byStatus: Record<CmsDraftStatus, number>
    scope: 'mine' | 'all'
  }
  pendingReviews: number
  members: number
}
