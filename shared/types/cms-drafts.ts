import type { CmsArticleCollection } from './cms-articles'

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
  status: 'draft'
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
  collection: CmsArticleCollection
  title: string
  version: number
  updatedAt: string
}

export interface CmsDraftSaveInput {
  title: string
  description: string
  body: string
  authorKeys: string[]
  version: number
}
