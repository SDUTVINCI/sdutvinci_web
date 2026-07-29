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
    contributors: unknown
    updatedAt: unknown
    publishedAt: unknown
  }
  baseContentHash: string | null
  baseRevisionId: string | null
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
  version: number
  lockLeaseId: string
}
