import type { CmsDraft, CmsDraftStatus } from './cms-drafts'

export type CmsReviewAction =
  | 'submitted'
  | 'withdrawn'
  | 'rejected'
  | 'approved'
  | 'reopened'
  | 'resynced'

export interface CmsReviewActor {
  userId: string | null
  account: string | null
  memberName: string | null
}

export interface CmsReviewEvent {
  id: string
  action: CmsReviewAction
  fromStatus: CmsDraftStatus
  toStatus: CmsDraftStatus
  reason: string | null
  metadata: Record<string, unknown>
  actor: CmsReviewActor
  createdAt: string
}

export interface CmsReviewOwner {
  userId: string
  account: string
  memberName: string | null
}

export interface CmsReviewSummary {
  id: string
  articleId: string | null
  collection: CmsDraft['collection']
  title: string
  status: CmsDraftStatus
  owner: CmsReviewOwner
  submittedAt: string
  updatedAt: string
}

export interface CmsDiffPart {
  type: 'same' | 'added' | 'removed'
  value: string
}

export interface CmsReviewComparison {
  baseContentHash: string | null
  currentContentHash: string | null
  hasVersionConflict: boolean
  formal: {
    title: string
    description: string
    authorKeys: string[]
    body: string
  } | null
  draft: {
    title: string
    description: string
    authorKeys: string[]
    body: string
  }
  bodyDiff: CmsDiffPart[]
}

export interface CmsReviewDetail {
  draft: CmsDraft
  owner: CmsReviewOwner
  events: CmsReviewEvent[]
  comparison: CmsReviewComparison
}
