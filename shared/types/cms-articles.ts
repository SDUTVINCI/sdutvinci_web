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
}

export interface CmsArticleListResponse {
  articles: CmsArticleSummary[]
  directories: string[]
  total: number
  deletedTotal?: number
}
