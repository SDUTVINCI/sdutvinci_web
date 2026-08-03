import { createHash } from 'node:crypto'
import { basename, dirname, extname } from 'node:path'
import { and, asc, eq, ilike, isNotNull, isNull, or } from 'drizzle-orm'
import type {
  CmsArticleCollection,
  CmsArticleDetail,
  CmsArticleListResponse,
  CmsArticleSummary
} from '../../shared/types/cms-articles'
import { getWikiContentMeta } from '../../utils/wiki-content-meta'
import { getDatabase } from '../db/client'
import { articleRevisions, articles } from '../db/schema'
import { listMarkdownFiles, readContentFile } from '../utils/cms-content-path'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import {
  isCmsDatabaseAuthorityEnabled,
  isCmsRevisionShadowEnabled
} from '../utils/cms-v2-flags'
import { readCmsGitArticle } from './cms-git-worktree'
import { getCmsArticleExportStatus } from './cms-export-status'

const collections: CmsArticleCollection[] = ['news', 'wiki']

const readShadowArticleSource = async (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  try {
    return await readCmsGitArticle(collection, relativePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return (await readContentFile(collection, relativePath)).source
  }
}

interface ScannedArticle {
  collection: CmsArticleCollection
  relativePath: string
  publicPath: string
  directory: string
  title: string
  frontmatter: Record<string, unknown>
  searchText: string
  contentHash: string
}

export const getCmsArticlePublicPath = (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  const stem = `${collection}/${relativePath.slice(0, -extname(relativePath).length)}`
  if (collection === 'wiki') return getWikiContentMeta(stem)?.path || `/${stem}`
  const legacyNewsStem = stem
    .split('/')
    .map(segment => segment
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/')
  if (collection === 'news') return `/${legacyNewsStem}`
  return `/${stem}`
}

export const getCmsArticleDirectory = (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  const parent = dirname(relativePath).replaceAll('\\', '/')
  return parent === '.' ? collection : `${collection}/${parent}`
}

export const synchronizeCmsArticles = async () => {
  const db = getDatabase()
  const scanned: ScannedArticle[] = []

  for (const collection of collections) {
    for (const relativePath of await listMarkdownFiles(collection)) {
      const { source } = await readContentFile(collection, relativePath)
      const parsed = parseCmsMarkdown(source)
      const title = typeof parsed.frontmatter.title === 'string'
        ? parsed.frontmatter.title.trim()
        : basename(relativePath, extname(relativePath))
      scanned.push({
        collection,
        relativePath,
        publicPath: getCmsArticlePublicPath(collection, relativePath),
        directory: getCmsArticleDirectory(collection, relativePath),
        title,
        frontmatter: parsed.frontmatter,
        searchText: `${title}\n${relativePath}\n${parsed.body}`.toLowerCase(),
        contentHash: createHash('sha256').update(source).digest('hex')
      })
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(articles).set({ isPresent: 'false', scannedAt: new Date() })
    for (const item of scanned) {
      await tx.insert(articles).values(item).onConflictDoUpdate({
        target: [articles.collection, articles.relativePath],
        set: {
          publicPath: item.publicPath,
          directory: item.directory,
          title: item.title,
          frontmatter: item.frontmatter,
          searchText: item.searchText,
          contentHash: item.contentHash,
          isPresent: 'true',
          scannedAt: new Date(),
          updatedAt: new Date()
        }
      })
    }
  })
  return scanned.length
}

export const refreshCmsArticlesForRequest = async () => {
  if (!isCmsRevisionShadowEnabled() && !isCmsDatabaseAuthorityEnabled()) {
    await synchronizeCmsArticles()
  }
}

const toSummary = (row: typeof articles.$inferSelect): CmsArticleSummary => ({
  id: row.id,
  collection: row.collection as CmsArticleCollection,
  relativePath: row.relativePath,
  publicPath: row.publicPath,
  directory: row.directory,
  title: row.title,
  frontmatter: row.frontmatter,
  contentHash: row.contentHash,
  isDeleted: Boolean(row.deletedAt),
  isPresent: row.isPresent === 'true',
  updatedAt: row.updatedAt.toISOString()
})

export interface ListCmsArticlesInput {
  query?: string
  collection?: CmsArticleCollection
  directory?: string
  status?: 'published' | 'deleted' | 'all'
  includeDeleted?: boolean
}

export const listCmsArticles = async (
  input: ListCmsArticlesInput = {}
): Promise<CmsArticleListResponse> => {
  await refreshCmsArticlesForRequest()
  const includeDeleted = input.includeDeleted || input.status === 'deleted' || input.status === 'all'
  const filters = includeDeleted
    ? [or(
        isNotNull(articles.deletedAt),
        and(eq(articles.isPresent, 'true'), isNull(articles.deletedAt))
      )!]
    : [eq(articles.isPresent, 'true'), isNull(articles.deletedAt)]
  if (input.status === 'published') {
    filters.push(eq(articles.isPresent, 'true'), isNull(articles.deletedAt))
  } else if (input.status === 'deleted') {
    filters.push(isNotNull(articles.deletedAt))
  }
  if (input.collection) filters.push(eq(articles.collection, input.collection))
  if (input.directory) filters.push(eq(articles.directory, input.directory))
  if (input.query?.trim()) {
    const query = `%${input.query.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    filters.push(or(ilike(articles.title, query), ilike(articles.searchText, query))!)
  }

  const rows = await getDatabase()
    .select()
    .from(articles)
    .where(and(...filters))
    .orderBy(asc(articles.collection), asc(articles.relativePath))
  const directories = await getDatabase()
    .selectDistinct({ directory: articles.directory })
    .from(articles)
    .where(and(
      ...(input.status === 'deleted' || input.includeDeleted
        ? []
        : [eq(articles.isPresent, 'true'), isNull(articles.deletedAt)]),
      ...(input.status === 'deleted' ? [isNotNull(articles.deletedAt)] : [])
    ))
    .orderBy(asc(articles.directory))

  return {
    articles: rows.map(toSummary),
    directories: directories.map(item => item.directory),
    total: rows.length,
    deletedTotal: input.includeDeleted
      ? (await getDatabase()
          .select({ id: articles.id })
          .from(articles)
          .where(isNotNull(articles.deletedAt))).length
      : undefined
  }
}

export const getCmsArticle = async (
  id: string,
  includeDeleted = false
): Promise<CmsArticleDetail | null> => {
  const db = getDatabase()
  const [row] = await db
    .select()
    .from(articles)
    .where(and(
      eq(articles.id, id),
      ...(includeDeleted ? [] : [eq(articles.isPresent, 'true'), isNull(articles.deletedAt)])
    ))
    .limit(1)
  if (!row) return null

  const collection = row.collection as CmsArticleCollection
  const databaseAuthority = isCmsDatabaseAuthorityEnabled()
  const [currentRevision] = row.currentRevisionId
    ? await db
        .select()
        .from(articleRevisions)
        .where(and(
          eq(articleRevisions.id, row.currentRevisionId),
          eq(articleRevisions.articleId, row.id)
        ))
        .limit(1)
    : []
  if (databaseAuthority && !currentRevision) {
    throw new Error('ARTICLE_CURRENT_REVISION_MISSING')
  }

  if (databaseAuthority) {
    const revision = currentRevision!
    const title = typeof revision.frontmatter.title === 'string'
      ? revision.frontmatter.title.trim()
      : row.title
    return {
      ...toSummary(row),
      title,
      frontmatter: revision.frontmatter,
      body: revision.body,
      contentHash: revision.contentHash,
      currentRevision: {
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        createdAt: revision.createdAt.toISOString()
      },
      exportStatus: await getCmsArticleExportStatus(
        row.id,
        row.currentRevisionId,
        true
      )
    }
  }

  let source: string
  try {
    source = isCmsRevisionShadowEnabled()
      ? await readShadowArticleSource(collection, row.relativePath)
      : (await readContentFile(collection, row.relativePath)).source
  } catch (error) {
    if (!includeDeleted) throw error
    source = ''
  }
  if (!source) {
    return {
      ...toSummary(row),
      title: row.title,
      frontmatter: row.frontmatter,
      body: '',
      contentHash: row.contentHash,
      currentRevision: currentRevision
        ? {
            id: currentRevision.id,
            revisionNumber: currentRevision.revisionNumber,
            contentHash: currentRevision.contentHash,
            createdAt: currentRevision.createdAt.toISOString()
          }
        : null,
      exportStatus: await getCmsArticleExportStatus(
        row.id,
        row.currentRevisionId,
        false
      )
    }
  }
  const parsed = parseCmsMarkdown(source)
  const title = typeof parsed.frontmatter.title === 'string'
    ? parsed.frontmatter.title.trim()
    : basename(row.relativePath, extname(row.relativePath))
  return {
    ...toSummary(row),
    title,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    contentHash: createHash('sha256').update(source).digest('hex'),
    currentRevision: currentRevision
      ? {
          id: currentRevision.id,
          revisionNumber: currentRevision.revisionNumber,
          contentHash: currentRevision.contentHash,
          createdAt: currentRevision.createdAt.toISOString()
        }
      : null,
    exportStatus: await getCmsArticleExportStatus(
      row.id,
      row.currentRevisionId,
      false
    )
  }
}

export const resolveCmsArticleByPublicPath = async (publicPath: string) => {
  const normalized = `/${publicPath.trim().replace(/^\/+|\/+$/g, '')}`
  const [row] = await getDatabase()
    .select({ id: articles.id, publicPath: articles.publicPath })
    .from(articles)
    .where(and(
      eq(articles.publicPath, normalized),
      eq(articles.isPresent, 'true'),
      isNull(articles.deletedAt)
    ))
    .limit(1)
  return row || null
}
