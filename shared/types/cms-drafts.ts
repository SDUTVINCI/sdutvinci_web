import type { CmsArticleCollection } from './cms-articles'

export const cmsDraftStatuses = [
  'draft',
  'pending_review',
  'rejected',
  'approved',
  'published',
  'withdrawn'
] as const

export type CmsDraftStatus = typeof cmsDraftStatuses[number]

export interface CmsDraftAuthor {
  memberId: string
  memberKey: string
  name: string
  avatarUrl: string | null
}

export interface CmsDraft {
  id: string
  articleId: string | null
  ownerUserId: string
  collection: CmsArticleCollection
  title: string
  description: string
  body: string
  authors: CmsDraftAuthor[]
  preservedFrontmatter: Record<string, unknown>
  systemFrontmatter: {
    contributors: string[]
    updatedAt: string | null
    updatedAtOverride: string | null
    publishedAt: string | null
    publishedAtOverride: string | null
  }
  baseContentHash: string | null
  baseRevisionId: string | null
  proposedAction: 'edit' | 'move' | 'delete'
  proposedRelativePath: string | null
  proposedArticleId: string | null
  status: CmsDraftStatus
  isDeleted: boolean
  deletedAt: string | null
  version: number
  visualMode: {
    allowed: boolean
    reasons: string[]
  }
  createdAt: string
  updatedAt: string
  lastSavedAt: string
}

export interface CmsDraftSummary {
  id: string
  articleId: string | null
  ownerUserId: string
  ownerAccount: string
  collection: CmsArticleCollection
  title: string
  proposedAction: 'edit' | 'move' | 'delete'
  proposedRelativePath: string | null
  status: CmsDraftStatus
  isDeleted: boolean
  deletedAt: string | null
  version: number
  updatedAt: string
}

export interface CmsDraftSaveInput {
  title: string
  description: string
  body: string
  authorKeys: string[]
  contributorKeys: string[]
  updatedAtOverride: string | null
  publishedAtOverride: string | null
  version: number
  lockLeaseId: string
}
