import { extname } from 'node:path'
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  or
} from 'drizzle-orm'
import type {
  PublicArticle,
  PublicArticleCollection,
  PublicContentSearchResult,
  PublicMember
} from '../../shared/types/public-content'
import { getWikiContentMeta } from '../../utils/wiki-content-meta'
import { getDatabase } from '../db/client'
import {
  articleRevisions,
  articleRedirects,
  articles,
  members
} from '../db/schema'
import { readContentFile } from '../utils/cms-content-path'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import {
  createPublicRevisionCacheKey,
  getCachedPublicRevision,
  setCachedPublicRevision
} from './public-content-cache'

const articleSelection = {
  articleId: articles.id,
  collection: articles.collection,
  relativePath: articles.relativePath,
  publicPath: articles.publicPath,
  articleTitle: articles.title,
  revisionId: articleRevisions.id,
  revisionNumber: articleRevisions.revisionNumber,
  markdownSource: articleRevisions.markdownSource,
  body: articleRevisions.body,
  frontmatter: articleRevisions.frontmatter,
  contentHash: articleRevisions.contentHash,
  revisionCreatedAt: articleRevisions.createdAt
}

type PublishedArticleRow = {
  articleId: string
  collection: string
  relativePath: string
  publicPath: string
  articleTitle: string
  revisionId: string
  revisionNumber: number
  markdownSource: string
  body: string
  frontmatter: Record<string, unknown>
  contentHash: string
  revisionCreatedAt: Date
}

const plainTextDescription = (body: string) =>
  body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

const stringField = (
  record: Record<string, unknown>,
  key: string
) => typeof record[key] === 'string' ? String(record[key]).trim() : ''

const toPublicArticle = (row: PublishedArticleRow): PublicArticle => {
  const collection = row.collection as PublicArticleCollection
  const frontmatter = row.frontmatter || {}
  const title = stringField(frontmatter, 'title') || row.articleTitle
  const description = stringField(frontmatter, 'description')
    || stringField(frontmatter, 'summary')
    || plainTextDescription(row.body)
  const stem = `${collection}/${
    row.relativePath.slice(0, -extname(row.relativePath).length)
  }`
  const wikiMeta = collection === 'wiki'
    ? (getWikiContentMeta(stem) || {})
    : {}
  const cacheKey = createPublicRevisionCacheKey(
    collection,
    row.articleId,
    row.revisionId
  )

  return {
    ...frontmatter,
    ...wikiMeta,
    id: row.articleId,
    vinciId: row.articleId,
    collection,
    relativePath: row.relativePath,
    path: row.publicPath,
    title,
    description,
    body: row.body,
    frontmatter,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    contentHash: row.contentHash,
    cacheKey,
    updatedAt: row.revisionCreatedAt.toISOString()
  }
}

const publishedArticleFilters = (collection?: PublicArticleCollection) => and(
  eq(articles.isPresent, 'true'),
  isNull(articles.deletedAt),
  ...(collection ? [eq(articles.collection, collection)] : [])
)

export const listPublicArticlesFromDatabase = async (
  collection: PublicArticleCollection
): Promise<PublicArticle[]> => {
  const rows = await getDatabase()
    .select(articleSelection)
    .from(articles)
    .innerJoin(
      articleRevisions,
      eq(articles.currentRevisionId, articleRevisions.id)
    )
    .where(publishedArticleFilters(collection))
    .orderBy(
      collection === 'news'
        ? desc(articleRevisions.createdAt)
        : asc(articles.relativePath)
    )

  return rows.map(row => toPublicArticle(row as PublishedArticleRow))
}

export const getPublicArticleFromDatabase = async (
  collection: PublicArticleCollection,
  publicPath: string
): Promise<PublicArticle | null> => {
  const normalizedPath = `/${publicPath.trim().replace(/^\/+|\/+$/g, '')}`
  let [row] = await getDatabase()
    .select(articleSelection)
    .from(articles)
    .innerJoin(
      articleRevisions,
      eq(articles.currentRevisionId, articleRevisions.id)
    )
    .where(and(
      publishedArticleFilters(collection),
      eq(articles.publicPath, normalizedPath)
    ))
    .limit(1)
  if (!row) {
    const [redirect] = await getDatabase()
      .select({ articleId: articleRedirects.articleId })
      .from(articleRedirects)
      .where(eq(articleRedirects.fromPublicPath, normalizedPath))
      .limit(1)
    if (!redirect) return null
    ;[row] = await getDatabase()
      .select(articleSelection)
      .from(articles)
      .innerJoin(articleRevisions, eq(articles.currentRevisionId, articleRevisions.id))
      .where(and(
        publishedArticleFilters(collection),
        eq(articles.id, redirect.articleId)
      ))
      .limit(1)
    if (!row) return null
  }

  const candidate = row as PublishedArticleRow
  const key = createPublicRevisionCacheKey(
    collection,
    candidate.articleId,
    candidate.revisionId
  )
  const cached = getCachedPublicRevision<PublicArticle>(key)
  if (cached) return cached

  return setCachedPublicRevision(key, toPublicArticle(candidate), {
    collection,
    articleId: candidate.articleId,
    revisionId: candidate.revisionId
  })
}

export const searchPublicArticlesFromDatabase = async (
  query: string,
  collection?: PublicArticleCollection
): Promise<PublicContentSearchResult[]> => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []
  const pattern = `%${
    normalizedQuery.replaceAll('%', '\\%').replaceAll('_', '\\_')
  }%`
  const rows = await getDatabase()
    .select(articleSelection)
    .from(articles)
    .innerJoin(
      articleRevisions,
      eq(articles.currentRevisionId, articleRevisions.id)
    )
    .where(and(
      publishedArticleFilters(collection),
      or(
        ilike(articles.title, pattern),
        ilike(articles.relativePath, pattern),
        ilike(articleRevisions.body, pattern)
      )!
    ))
    .orderBy(asc(articles.collection), asc(articles.relativePath))
    .limit(100)

  return rows.map((row) => {
    const item = toPublicArticle(row as PublishedArticleRow)
    return {
      id: item.id,
      collection: item.collection,
      path: item.path,
      title: item.title,
      description: item.description,
      revisionId: item.revisionId,
      contentHash: item.contentHash
    }
  })
}

const toPublicMember = (
  row: typeof members.$inferSelect,
  body = ''
): PublicMember => {
  const metadata = row.metadata || {}
  const memberKey = row.memberKey
  const updatedAt = row.updatedAt.toISOString()
  return {
    ...metadata,
    id: memberKey,
    vinciId: row.id,
    memberKey,
    path: `/team/${encodeURIComponent(memberKey)}`,
    name: row.name,
    image: row.avatarUrl || (
      typeof metadata.image === 'string' ? metadata.image : null
    ),
    body,
    metadata,
    cacheKey: `phase4:members:${row.id}:projection:${updatedAt}`,
    updatedAt
  }
}

export const listPublicMembersFromDatabase = async (): Promise<PublicMember[]> => {
  const rows = await getDatabase()
    .select()
    .from(members)
    .orderBy(asc(members.memberKey))
  return rows.map(row => toPublicMember(row))
}

export const getPublicMemberFromDatabase = async (
  slug: string
): Promise<PublicMember | null> => {
  const [row] = await getDatabase()
    .select()
    .from(members)
    .where(or(
      eq(members.memberKey, slug),
      eq(members.name, slug)
    ))
    .limit(1)
  if (!row) return null

  let body = ''
  if (row.sourcePath) {
    const source = await readContentFile('members', row.sourcePath)
    body = parseCmsMarkdown(source.source).body
  }
  return toPublicMember(row, body)
}
