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
