import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import { getDatabase } from '../db/client'
import { articleRevisions, articles } from '../db/schema'
import { listMarkdownFiles, readContentFile } from '../utils/cms-content-path'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'

const collections: CmsArticleCollection[] = ['news', 'wiki']
const advisoryLockName = 'vinci:v2:article-revision-backfill'

type BackfillAction =
  | 'create_revision'
  | 'link_existing_revision'
  | 'already_backfilled'
  | 'skip_deleted'
  | 'skip_not_present'

type BackfillIssueCode =
  | 'active_article_missing_file'
  | 'article_hash_mismatch'
  | 'current_revision_missing'
  | 'current_revision_mismatch'
  | 'existing_revision_conflict'
  | 'unindexed_file'

interface ScannedMarkdown {
  collection: CmsArticleCollection
  relativePath: string
  source: string
  body: string
  frontmatter: Record<string, unknown>
  contentHash: string
  bytes: number
}

interface InternalBackfillItem {
  articleId: string
  collection: CmsArticleCollection
  relativePath: string
  contentHash: string
  bytes: number
  action: BackfillAction
  revisionId: string | null
  source?: string
  body?: string
  frontmatter?: Record<string, unknown>
}

export interface ArticleRevisionBackfillItem {
  articleId: string
  vinciId: string
  collection: CmsArticleCollection
  relativePath: string
  contentHash: string
  bytes: number
  action: BackfillAction
  revisionId: string | null
}

export interface ArticleRevisionBackfillIssue {
  code: BackfillIssueCode
  articleId: string | null
  vinciId: string | null
  collection: CmsArticleCollection
  relativePath: string
  expectedHash?: string
  actualHash?: string
}

export interface ArticleRevisionBackfillReport {
  mode: 'dry-run' | 'apply'
  summary: {
    scannedMarkdownFiles: number
    indexedArticles: number
    activeArticles: number
    createRevisions: number
    linkExistingRevisions: number
    alreadyBackfilled: number
    skippedDeleted: number
    skippedNotPresent: number
    blockers: number
    createdRevisions: number
    linkedArticles: number
  }
  items: ArticleRevisionBackfillItem[]
  issues: ArticleRevisionBackfillIssue[]
}

export class ArticleRevisionBackfillValidationError extends Error {
  readonly report: ArticleRevisionBackfillReport

  constructor(report: ArticleRevisionBackfillReport) {
    super('ARTICLE_REVISION_BACKFILL_VALIDATION_FAILED')
    this.report = report
  }
}

const keyOf = (collection: CmsArticleCollection, relativePath: string) =>
  `${collection}\0${relativePath}`

const sha256 = (source: string) =>
  createHash('sha256').update(source).digest('hex')

const scanMarkdown = async () => {
  const files = new Map<string, ScannedMarkdown>()
  for (const collection of collections) {
    for (const relativePath of await listMarkdownFiles(collection)) {
      const { source } = await readContentFile(collection, relativePath)
      const parsed = parseCmsMarkdown(source)
      files.set(keyOf(collection, relativePath), {
        collection,
        relativePath,
        source,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        contentHash: sha256(source),
        bytes: Buffer.byteLength(source)
      })
    }
  }
  return files
}

const publicItem = (item: InternalBackfillItem): ArticleRevisionBackfillItem => ({
  articleId: item.articleId,
  vinciId: item.articleId,
  collection: item.collection,
  relativePath: item.relativePath,
  contentHash: item.contentHash,
  bytes: item.bytes,
  action: item.action,
  revisionId: item.revisionId
})

const makeReport = (
  mode: ArticleRevisionBackfillReport['mode'],
  scannedMarkdownFiles: number,
  indexedArticles: number,
  activeArticles: number,
  items: InternalBackfillItem[],
  issues: ArticleRevisionBackfillIssue[],
  applied = { createdRevisions: 0, linkedArticles: 0 }
): ArticleRevisionBackfillReport => ({
  mode,
  summary: {
    scannedMarkdownFiles,
    indexedArticles,
    activeArticles,
    createRevisions: items.filter(item => item.action === 'create_revision').length,
    linkExistingRevisions: items.filter(item =>
      item.action === 'link_existing_revision'
    ).length,
    alreadyBackfilled: items.filter(item => item.action === 'already_backfilled').length,
    skippedDeleted: items.filter(item => item.action === 'skip_deleted').length,
    skippedNotPresent: items.filter(item => item.action === 'skip_not_present').length,
    blockers: issues.length,
    createdRevisions: applied.createdRevisions,
    linkedArticles: applied.linkedArticles
  },
  items: items.map(publicItem),
  issues
})

const planArticleRevisionBackfill = async () => {
  const db = getDatabase()
  const files = await scanMarkdown()
  const scannedMarkdownFiles = files.size
  const articleRows = await db
    .select()
    .from(articles)
    .orderBy(asc(articles.collection), asc(articles.relativePath))
  const revisionRows = await db
    .select()
    .from(articleRevisions)
    .orderBy(asc(articleRevisions.articleId), asc(articleRevisions.revisionNumber))
  const revisionsByArticle = new Map<string, typeof revisionRows>()
  for (const revision of revisionRows) {
    const rows = revisionsByArticle.get(revision.articleId) || []
    rows.push(revision)
    revisionsByArticle.set(revision.articleId, rows)
  }

  const items: InternalBackfillItem[] = []
  const issues: ArticleRevisionBackfillIssue[] = []

  for (const article of articleRows) {
    const collection = article.collection as CmsArticleCollection
    if (!collections.includes(collection)) continue
    const fileKey = keyOf(collection, article.relativePath)
    const file = files.get(fileKey)
    if (file) files.delete(fileKey)

    if (article.deletedAt) {
      items.push({
        articleId: article.id,
        collection,
        relativePath: article.relativePath,
        contentHash: file?.contentHash || article.contentHash,
        bytes: file?.bytes || 0,
        action: 'skip_deleted',
        revisionId: article.currentRevisionId
      })
      continue
    }
    if (article.isPresent !== 'true') {
      items.push({
        articleId: article.id,
        collection,
        relativePath: article.relativePath,
        contentHash: file?.contentHash || article.contentHash,
        bytes: file?.bytes || 0,
        action: 'skip_not_present',
        revisionId: article.currentRevisionId
      })
      continue
    }
    if (!file) {
      issues.push({
        code: 'active_article_missing_file',
        articleId: article.id,
        vinciId: article.id,
        collection,
        relativePath: article.relativePath,
        expectedHash: article.contentHash
      })
      continue
    }
    if (file.contentHash !== article.contentHash) {
      issues.push({
        code: 'article_hash_mismatch',
        articleId: article.id,
        vinciId: article.id,
        collection,
        relativePath: article.relativePath,
        expectedHash: article.contentHash,
        actualHash: file.contentHash
      })
      continue
    }

    const revisions = revisionsByArticle.get(article.id) || []
    const current = article.currentRevisionId
      ? revisions.find(revision => revision.id === article.currentRevisionId)
      : undefined
    const first = revisions.find(revision => revision.revisionNumber === 1)

    if (article.currentRevisionId && !current) {
      issues.push({
        code: 'current_revision_missing',
        articleId: article.id,
        vinciId: article.id,
        collection,
        relativePath: article.relativePath,
        expectedHash: file.contentHash
      })
      continue
    }
    if (current) {
      if (
        current.contentHash !== file.contentHash
        || current.markdownSource !== file.source
      ) {
        issues.push({
          code: 'current_revision_mismatch',
          articleId: article.id,
          vinciId: article.id,
          collection,
          relativePath: article.relativePath,
          expectedHash: current.contentHash,
          actualHash: file.contentHash
        })
        continue
      }
      items.push({
        articleId: article.id,
        collection,
        relativePath: article.relativePath,
        contentHash: file.contentHash,
        bytes: file.bytes,
        action: 'already_backfilled',
        revisionId: current.id,
        source: file.source,
        body: file.body,
        frontmatter: file.frontmatter
      })
      continue
    }
    if (first) {
      if (
        first.contentHash !== file.contentHash
        || first.markdownSource !== file.source
      ) {
        issues.push({
          code: 'existing_revision_conflict',
          articleId: article.id,
          vinciId: article.id,
          collection,
          relativePath: article.relativePath,
          expectedHash: first.contentHash,
          actualHash: file.contentHash
        })
        continue
      }
      items.push({
        articleId: article.id,
        collection,
        relativePath: article.relativePath,
        contentHash: file.contentHash,
        bytes: file.bytes,
        action: 'link_existing_revision',
        revisionId: first.id,
        source: file.source,
        body: file.body,
        frontmatter: file.frontmatter
      })
      continue
    }
    if (revisions.length) {
      issues.push({
        code: 'existing_revision_conflict',
        articleId: article.id,
        vinciId: article.id,
        collection,
        relativePath: article.relativePath,
        actualHash: file.contentHash
      })
      continue
    }
    items.push({
      articleId: article.id,
      collection,
      relativePath: article.relativePath,
      contentHash: file.contentHash,
      bytes: file.bytes,
      action: 'create_revision',
      revisionId: null,
      source: file.source,
      body: file.body,
      frontmatter: file.frontmatter
    })
  }

  for (const file of files.values()) {
    issues.push({
      code: 'unindexed_file',
      articleId: null,
      vinciId: null,
      collection: file.collection,
      relativePath: file.relativePath,
      actualHash: file.contentHash
    })
  }

  return {
    scannedMarkdownFiles,
    indexedArticles: articleRows.length,
    activeArticles: articleRows.filter(article =>
      article.isPresent === 'true' && !article.deletedAt
    ).length,
    items,
    issues
  }
}

export const dryRunArticleRevisionBackfill = async () => {
  const plan = await planArticleRevisionBackfill()
  return makeReport(
    'dry-run',
    plan.scannedMarkdownFiles,
    plan.indexedArticles,
    plan.activeArticles,
    plan.items,
    plan.issues
  )
}

export const applyArticleRevisionBackfill = async () => {
  const plan = await planArticleRevisionBackfill()
  const dryRunReport = makeReport(
    'apply',
    plan.scannedMarkdownFiles,
    plan.indexedArticles,
    plan.activeArticles,
    plan.items,
    plan.issues
  )
  if (plan.issues.length) {
    throw new ArticleRevisionBackfillValidationError(dryRunReport)
  }

  const candidates = plan.items.filter(item =>
    ['create_revision', 'link_existing_revision'].includes(item.action)
  )
  let createdRevisions = 0
  let linkedArticles = 0

  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${advisoryLockName}))`)
    if (candidates.length) {
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(inArray(articles.id, candidates.map(item => item.articleId)))
        .orderBy(asc(articles.collection), asc(articles.relativePath))
        .for('update')
    }

    for (const item of candidates) {
      const [article] = await tx
        .select()
        .from(articles)
        .where(eq(articles.id, item.articleId))
        .limit(1)
      if (
        !article
        || article.deletedAt
        || article.isPresent !== 'true'
        || article.contentHash !== item.contentHash
      ) {
        throw new Error(`ARTICLE_REVISION_BACKFILL_ARTICLE_CHANGED:${item.articleId}`)
      }

      const { source } = await readContentFile(item.collection, item.relativePath)
      if (source !== item.source || sha256(source) !== item.contentHash) {
        throw new Error(`ARTICLE_REVISION_BACKFILL_FILE_CHANGED:${item.articleId}`)
      }

      const revisions = await tx
        .select()
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, item.articleId))
        .orderBy(asc(articleRevisions.revisionNumber))
      const current = article.currentRevisionId
        ? revisions.find(revision => revision.id === article.currentRevisionId)
        : undefined
      if (article.currentRevisionId) {
        if (
          !current
          || current.contentHash !== item.contentHash
          || current.markdownSource !== source
        ) {
          throw new Error(`ARTICLE_REVISION_BACKFILL_CURRENT_CHANGED:${item.articleId}`)
        }
        continue
      }

      let revision = revisions.find(row => row.revisionNumber === 1)
      if (revision) {
        if (
          revision.contentHash !== item.contentHash
          || revision.markdownSource !== source
        ) {
          throw new Error(`ARTICLE_REVISION_BACKFILL_REVISION_CONFLICT:${item.articleId}`)
        }
      } else {
        if (revisions.length) {
          throw new Error(`ARTICLE_REVISION_BACKFILL_REVISION_SEQUENCE:${item.articleId}`)
        }
        const [inserted] = await tx
          .insert(articleRevisions)
          .values({
            articleId: item.articleId,
            revisionNumber: 1,
            markdownSource: source,
            body: item.body!,
            frontmatter: item.frontmatter!,
            contentHash: item.contentHash,
            sourceKind: 'backfill'
          })
          .returning()
        revision = inserted!
        createdRevisions += 1
      }

      const [linked] = await tx
        .update(articles)
        .set({ currentRevisionId: revision.id })
        .where(and(
          eq(articles.id, item.articleId),
          isNull(articles.currentRevisionId)
        ))
        .returning({ id: articles.id })
      if (!linked) {
        throw new Error(`ARTICLE_REVISION_BACKFILL_LINK_CONFLICT:${item.articleId}`)
      }
      linkedArticles += 1
    }
  })

  const verified = await planArticleRevisionBackfill()
  const report = makeReport(
    'apply',
    verified.scannedMarkdownFiles,
    verified.indexedArticles,
    verified.activeArticles,
    verified.items,
    verified.issues,
    { createdRevisions, linkedArticles }
  )
  if (verified.issues.length) {
    throw new ArticleRevisionBackfillValidationError(report)
  }
  return report
}
