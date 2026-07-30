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
  reconciliation: {
    status: 'processing' | 'succeeded' | 'failed' | 'busy'
    startedAt: string
    completedAt: string | null
    resultCommitHash: string | null
    differenceCount: number
    summary: string | null
  } | null
}
