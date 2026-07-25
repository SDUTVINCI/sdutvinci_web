import { createHash } from 'node:crypto'
import { basename, dirname, extname } from 'node:path'
import { and, asc, eq, ilike, or } from 'drizzle-orm'
import type {
  CmsArticleCollection,
  CmsArticleDetail,
  CmsArticleListResponse,
  CmsArticleSummary
} from '../../shared/types/cms-articles'
import { getWikiContentMeta } from '../../utils/wiki-content-meta'
import { getDatabase } from '../db/client'
import { articles } from '../db/schema'
import { listMarkdownFiles, readContentFile } from '../utils/cms-content-path'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'

const collections: CmsArticleCollection[] = ['news', 'wiki']

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

const articlePublicPath = (collection: CmsArticleCollection, relativePath: string) => {
  const stem = `${collection}/${relativePath.slice(0, -extname(relativePath).length)}`
  if (collection === 'wiki') return getWikiContentMeta(stem)?.path || `/${stem}`
  return `/${stem}`
}

const articleDirectory = (collection: CmsArticleCollection, relativePath: string) => {
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
        publicPath: articlePublicPath(collection, relativePath),
        directory: articleDirectory(collection, relativePath),
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

const toSummary = (row: typeof articles.$inferSelect): CmsArticleSummary => ({
  id: row.id,
  collection: row.collection as CmsArticleCollection,
  relativePath: row.relativePath,
  publicPath: row.publicPath,
  directory: row.directory,
  title: row.title,
  frontmatter: row.frontmatter,
  contentHash: row.contentHash,
  updatedAt: row.updatedAt.toISOString()
})

export interface ListCmsArticlesInput {
  query?: string
  collection?: CmsArticleCollection
  directory?: string
}

export const listCmsArticles = async (
  input: ListCmsArticlesInput = {}
): Promise<CmsArticleListResponse> => {
  await synchronizeCmsArticles()
  const filters = [eq(articles.isPresent, 'true')]
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
    .where(eq(articles.isPresent, 'true'))
    .orderBy(asc(articles.directory))

  return {
    articles: rows.map(toSummary),
    directories: directories.map(item => item.directory),
    total: rows.length
  }
}

export const getCmsArticle = async (id: string): Promise<CmsArticleDetail | null> => {
  const db = getDatabase()
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.isPresent, 'true')))
    .limit(1)
  if (!row) return null

  const collection = row.collection as CmsArticleCollection
  const { source } = await readContentFile(collection, row.relativePath)
  const parsed = parseCmsMarkdown(source)
  const title = typeof parsed.frontmatter.title === 'string'
    ? parsed.frontmatter.title.trim()
    : basename(row.relativePath, extname(row.relativePath))
  return {
    ...toSummary(row),
    title,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    contentHash: createHash('sha256').update(source).digest('hex')
  }
}
