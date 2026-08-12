export type CmsArticleCollection = 'news' | 'wiki'

export interface CmsArticleSummary {
  id: string
  collection: CmsArticleCollection
  relativePath: string
  publicPath: string
  directory: string
  title: string
  frontmatter: Record<string, unknown>
  contentHash: string
  requiresAuth: boolean
  isDeleted: boolean
  isPresent: boolean
  updatedAt: string
}

export interface CmsArticleDetail extends CmsArticleSummary {
  body: string
  currentRevision: {
    id: string
    revisionNumber: number
    contentHash: string
    createdAt: string
  } | null
  exportStatus: {
    state:
      | 'not_applicable'
      | 'untracked'
      | 'waiting_export'
      | 'export_failed'
      | 'synchronized'
      | 'export_behind'
    currentRevisionId: string | null
    currentJobId: string | null
    currentJobStatus: 'pending' | 'processing' | 'succeeded' | 'failed' | null
    currentJobAttemptCount: number | null
    currentJobNextAttemptAt: string | null
    currentJobLastErrorCode: string | null
    currentJobLastError: string | null
    canRetry: boolean
    latestExportedRevisionId: string | null
    latestExportedCommitHash: string | null
  }
}

export interface CmsArticleListResponse {
  articles: CmsArticleSummary[]
  directories: string[]
  total: number
  deletedTotal?: number
}

export const CMS_ARTICLE_VISIBILITY_MAX_ITEMS = 500

export interface CmsArticleVisibilityUpdateResult {
  requiresAuth: boolean
  updatedIds: string[]
  unchangedIds: string[]
}
