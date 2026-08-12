export type PublicContentCollection = 'news' | 'wiki' | 'members'
export type PublicArticleCollection = Exclude<PublicContentCollection, 'members'>
export type PublicContentSourceMode = 'legacy_git' | 'database_shadow' | 'database'
export type PublicContentCandidateEnvironment =
  | 'disabled'
  | 'test'
  | 'staging'
  | 'production'

export interface PublicContentSourceConfig {
  environment: PublicContentCandidateEnvironment
  sources: Record<PublicContentCollection, PublicContentSourceMode>
}

export interface PublicArticle {
  id: string
  vinciId: string
  collection: PublicArticleCollection
  relativePath: string
  path: string
  title: string
  description: string
  body: string
  frontmatter: Record<string, unknown>
  revisionId: string
  revisionNumber: number
  contentHash: string
  requiresAuth: boolean
  cacheKey: string
  updatedAt: string
  [key: string]: unknown
}

export interface PublicMember {
  id: string
  vinciId: string
  memberKey: string
  path: string
  name: string
  image?: string | null
  body: string
  metadata: Record<string, unknown>
  cacheKey: string
  updatedAt: string
  [key: string]: unknown
}

export interface PublicContentSearchResult {
  id: string
  collection: PublicArticleCollection
  path: string
  title: string
  description: string
  revisionId: string
  contentHash: string
}

export interface PublicContentCacheInvalidationInput {
  collection?: PublicArticleCollection
  articleId?: string
  revisionId?: string
}

export interface PublicContentCacheInvalidationResult {
  removed: number
  remaining: number
}
