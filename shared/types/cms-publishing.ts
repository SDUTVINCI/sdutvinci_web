import type { CmsArticleCollection } from './cms-articles'

export type CmsPublishOperation = 'publish' | 'restore'
export type CmsPublishStatus = 'pending' | 'succeeded' | 'failed'

export interface CmsPublishResult {
  articleId: string
  collection: CmsArticleCollection
  relativePath: string
  commitHash: string | null
  revisionId: string | null
  revisionNumber: number | null
  exportStatus: 'not_applicable' | 'waiting_export'
  publishedAt: string
}

export interface CmsArticleHistoryEntry {
  commitHash: string
  shortHash: string
  authorName: string
  authoredAt: string
  subject: string
  authority?: 'legacy_git' | 'database'
  revisionId?: string
  revisionNumber?: number
}

export interface CmsArticleVersion {
  articleId: string
  commitHash: string
  source: string
  authority?: 'legacy_git' | 'database'
  revisionNumber?: number
}

export interface CmsArticleVersionDiff {
  articleId: string
  fromCommit: string
  toCommit: string
  authority?: 'legacy_git' | 'database'
  parts: Array<{
    type: 'added' | 'removed' | 'same'
    value: string
  }>
}

export interface CmsArticleRevisionHistoryEntry {
  id: string
  articleId: string
  revisionNumber: number
  contentHash: string
  sourceKind: 'backfill' | 'publish' | 'restore' | 'member_publish'
  sourceDraftId: string | null
  publishedByUserId: string | null
  reviewedByUserId: string | null
  restoredFromRevisionId: string | null
  sourceOperationId: string | null
  gitCommitHash: string | null
  createdAt: string
}

export interface CmsArticleRevision extends CmsArticleRevisionHistoryEntry {
  markdownSource: string
  body: string
  frontmatter: Record<string, unknown>
}

export interface CmsArticleRevisionDiff {
  articleId: string
  fromRevisionId: string
  toRevisionId: string
  parts: Array<{
    type: 'added' | 'removed' | 'same'
    value: string
  }>
}
