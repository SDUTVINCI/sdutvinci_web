import { isDeepStrictEqual } from 'node:util'
import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  CmsArticleRevision,
  CmsArticleRevisionDiff,
  CmsArticleRevisionHistoryEntry
} from '../../shared/types/cms-publishing'
import { diffLines } from 'diff'
import { getDatabase } from '../db/client'
import {
  articleRevisions,
  articles
} from '../db/schema'
import { assertCmsRevisionHistoryEnabled } from '../utils/cms-v2-flags'

export class CmsRevisionNotFoundError extends Error {
  constructor() {
    super('CMS_REVISION_NOT_FOUND')
  }
}

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

interface AppendCmsArticleRevisionInput {
  articleId: string
  markdownSource: string
  body: string
  frontmatter: Record<string, unknown>
  contentHash: string
  sourceKind: 'publish' | 'restore'
  sourceDraftId?: string | null
  publishedByUserId: string
  reviewedByUserId?: string | null
  restoredFromRevisionId?: string | null
  sourceOperationId: string
  gitCommitHash: string | null
  createdAt: Date
}

const toHistoryEntry = (
  revision: typeof articleRevisions.$inferSelect
): CmsArticleRevisionHistoryEntry => ({
  id: revision.id,
  articleId: revision.articleId,
  revisionNumber: revision.revisionNumber,
  contentHash: revision.contentHash,
  sourceKind: revision.sourceKind as CmsArticleRevisionHistoryEntry['sourceKind'],
  sourceDraftId: revision.sourceDraftId,
  publishedByUserId: revision.publishedByUserId,
  reviewedByUserId: revision.reviewedByUserId,
  restoredFromRevisionId: revision.restoredFromRevisionId,
  sourceOperationId: revision.sourceOperationId,
  gitCommitHash: revision.gitCommitHash,
  createdAt: revision.createdAt.toISOString()
})

const assertSameOperation = (
  revision: typeof articleRevisions.$inferSelect,
  input: AppendCmsArticleRevisionInput
) => {
  if (
    revision.articleId !== input.articleId
    || revision.markdownSource !== input.markdownSource
    || revision.body !== input.body
    || !isDeepStrictEqual(revision.frontmatter, input.frontmatter)
    || revision.contentHash !== input.contentHash
    || revision.sourceKind !== input.sourceKind
    || revision.sourceDraftId !== (input.sourceDraftId || null)
    || revision.publishedByUserId !== input.publishedByUserId
    || revision.reviewedByUserId !== (input.reviewedByUserId || null)
    || revision.restoredFromRevisionId !== (input.restoredFromRevisionId || null)
    || revision.sourceOperationId !== input.sourceOperationId
    || revision.gitCommitHash !== input.gitCommitHash
  ) {
    throw new Error('REVISION_OPERATION_CONFLICT')
  }
}

export const appendCmsArticleRevision = async (
  tx: CmsTransaction,
  input: AppendCmsArticleRevisionInput
) => {
  await tx.execute(sql`
    select id
    from ${articles}
    where ${articles.id} = ${input.articleId}
    for update
  `)

  const [existingOperation] = await tx
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.sourceOperationId, input.sourceOperationId))
    .limit(1)
  if (existingOperation) {
    assertSameOperation(existingOperation, input)
    return existingOperation
  }

  if (input.gitCommitHash) {
    const [existingCommit] = await tx
      .select()
      .from(articleRevisions)
      .where(and(
        eq(articleRevisions.articleId, input.articleId),
        eq(articleRevisions.gitCommitHash, input.gitCommitHash)
      ))
      .limit(1)
    if (existingCommit) {
      assertSameOperation(existingCommit, input)
      return existingCommit
    }
  }

  const [latest] = await tx
    .select({ revisionNumber: articleRevisions.revisionNumber })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, input.articleId))
    .orderBy(desc(articleRevisions.revisionNumber))
    .limit(1)
  const [created] = await tx
    .insert(articleRevisions)
    .values({
      articleId: input.articleId,
      revisionNumber: (latest?.revisionNumber || 0) + 1,
      markdownSource: input.markdownSource,
      body: input.body,
      frontmatter: input.frontmatter,
      contentHash: input.contentHash,
      sourceKind: input.sourceKind,
      sourceDraftId: input.sourceDraftId || null,
      publishedByUserId: input.publishedByUserId,
      reviewedByUserId: input.reviewedByUserId || null,
      restoredFromRevisionId: input.restoredFromRevisionId || null,
      sourceOperationId: input.sourceOperationId,
      gitCommitHash: input.gitCommitHash,
      createdAt: input.createdAt
    })
    .returning()
  if (!created) throw new Error('REVISION_INSERT_FAILED')
  await tx
    .update(articles)
    .set({ currentRevisionId: created.id })
    .where(eq(articles.id, input.articleId))
  return created
}

const loadRevision = async (articleId: string, revisionId: string) => {
  const [revision] = await getDatabase()
    .select()
    .from(articleRevisions)
    .where(and(
      eq(articleRevisions.articleId, articleId),
      eq(articleRevisions.id, revisionId)
    ))
    .limit(1)
  if (!revision) throw new CmsRevisionNotFoundError()
  return revision
}

export const listCmsArticleRevisions = async (
  articleId: string
): Promise<CmsArticleRevisionHistoryEntry[]> => {
  assertCmsRevisionHistoryEnabled()
  const [article] = await getDatabase()
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)
  if (!article) throw new CmsRevisionNotFoundError()
  const rows = await getDatabase()
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(
      desc(articleRevisions.revisionNumber),
      desc(articleRevisions.createdAt)
    )
  return rows.map(toHistoryEntry)
}

export const getCmsArticleRevision = async (
  articleId: string,
  revisionId: string
): Promise<CmsArticleRevision> => {
  assertCmsRevisionHistoryEnabled()
  const revision = await loadRevision(articleId, revisionId)
  return {
    ...toHistoryEntry(revision),
    markdownSource: revision.markdownSource,
    body: revision.body,
    frontmatter: revision.frontmatter
  }
}

export const diffCmsArticleRevisions = async (
  articleId: string,
  fromRevisionId: string,
  toRevisionId: string
): Promise<CmsArticleRevisionDiff> => {
  assertCmsRevisionHistoryEnabled()
  const [from, to] = await Promise.all([
    loadRevision(articleId, fromRevisionId),
    loadRevision(articleId, toRevisionId)
  ])
  return {
    articleId,
    fromRevisionId,
    toRevisionId,
    parts: diffLines(from.body, to.body).map(part => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'same',
      value: part.value
    }))
  }
}

export const findCmsRevisionForSource = async (
  articleId: string,
  markdownSource: string,
  contentHash: string
) => {
  const rows = await getDatabase()
    .select()
    .from(articleRevisions)
    .where(and(
      eq(articleRevisions.articleId, articleId),
      eq(articleRevisions.contentHash, contentHash)
    ))
    .orderBy(desc(articleRevisions.revisionNumber))
  return rows.find(row => row.markdownSource === markdownSource) || null
}
