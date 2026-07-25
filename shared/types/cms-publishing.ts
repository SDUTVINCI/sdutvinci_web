import type { CmsArticleCollection } from './cms-articles'

export type CmsPublishOperation = 'publish' | 'restore'
export type CmsPublishStatus = 'pending' | 'succeeded' | 'failed'

export interface CmsPublishResult {
  articleId: string
  collection: CmsArticleCollection
  relativePath: string
  commitHash: string
  publishedAt: string
}

export interface CmsArticleHistoryEntry {
  commitHash: string
  shortHash: string
  authorName: string
  authoredAt: string
  subject: string
}

export interface CmsArticleVersion {
  articleId: string
  commitHash: string
  source: string
}

export interface CmsArticleVersionDiff {
  articleId: string
  fromCommit: string
  toCommit: string
  parts: Array<{
    type: 'added' | 'removed' | 'same'
    value: string
  }>
}
