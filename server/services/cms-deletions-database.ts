import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getDatabase } from '../db/client'
import {
  articleDeletionEvents,
  articleRevisions,
  articles,
  auditLogs,
  contentExportJobs,
  publishRecords
} from '../db/schema'
import {
  CmsArticleDeletionNotFoundError,
  CmsArticleDeletionStateError
} from './cms-deletions-legacy'
import { upsertPublishedArticle } from './cms-publishing-legacy'
import { appendCmsArticleRevision } from './cms-revisions'
import { invalidatePublicContentCache } from './public-content-cache'
import { serializeContentRevision } from './content-export-serialization'

export interface CmsDatabaseDeletionTestHooks {
  failAt?: 'after_state' | 'after_revision' | 'after_outbox'
}

export const deleteCmsArticleDatabase = async (
  articleId: string,
  operatorUserId: string,
  testHooks: CmsDatabaseDeletionTestHooks = {}
): Promise<CmsPublishResult> => {
  const db = getDatabase()
  const committed = await db.transaction(async (tx) => {
    const [article] = await tx
      .select()
      .from(articles)
      .where(and(
        eq(articles.id, articleId),
        eq(articles.isPresent, 'true'),
        isNull(articles.deletedAt)
      ))
      .limit(1)
      .for('update')
    if (!article) throw new CmsArticleDeletionNotFoundError()
    if (!article.currentRevisionId) {
      throw new CmsArticleDeletionStateError('当前数据库 Revision 不存在')
    }
    const [revision] = await tx
      .select()
      .from(articleRevisions)
      .where(and(
        eq(articleRevisions.id, article.currentRevisionId),
        eq(articleRevisions.articleId, articleId)
      ))
      .limit(1)
    if (!revision) {
      throw new CmsArticleDeletionStateError('当前数据库 Revision 不存在')
    }

    const now = new Date()
    const [updated] = await tx
      .update(articles)
      .set({
        isPresent: 'false',
        deletedAt: now,
        deletedByUserId: operatorUserId,
        updatedAt: now
      })
      .where(and(
        eq(articles.id, articleId),
        eq(articles.currentRevisionId, revision.id),
        isNull(articles.deletedAt)
      ))
      .returning({ id: articles.id })
    if (!updated) throw new CmsArticleDeletionStateError()
    if (testHooks.failAt === 'after_state') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_DELETE_STATE')
    }

    const exportJobId = randomUUID()
    const serialized = serializeContentRevision({
      articleId,
      collection: article.collection as CmsArticleCollection,
      relativePath: article.relativePath,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      frontmatter: revision.frontmatter,
      body: revision.body,
      revisionCreatedAt: revision.createdAt
    })
    await tx.insert(contentExportJobs).values({
      id: exportJobId,
      targetType: 'article',
      targetId: articleId,
      revisionId: revision.id,
      operation: 'delete',
      status: 'pending',
      idempotencyKey: `article:${articleId}:revision:${revision.id}:delete`,
      targetPath: serialized.path,
      previousPath: serialized.path,
      expectedSha256: serialized.sha256,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    })
    if (testHooks.failAt === 'after_outbox') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_DELETE_OUTBOX')
    }

    await tx.insert(articleDeletionEvents).values({
      articleId,
      actorUserId: operatorUserId,
      operation: 'delete',
      articlePath: `${article.collection}/${article.relativePath}`,
      sourceRevisionId: revision.id,
      resultRevisionId: revision.id,
      exportJobId,
      metadata: {
        authority: 'database',
        contentHash: revision.contentHash
      }
    })
    await tx.insert(auditLogs).values({
      actorUserId: operatorUserId,
      action: 'article.delete',
      targetType: 'article',
      targetId: articleId,
      metadata: {
        authority: 'database',
        relativePath: article.relativePath,
        revisionId: revision.id,
        exportJobId
      }
    })
    return { article, revision, publishedAt: now.toISOString() }
  })

  invalidatePublicContentCache({
    collection: committed.article.collection as CmsArticleCollection,
    articleId
  })
  return {
    articleId,
    collection: committed.article.collection as CmsArticleCollection,
    relativePath: committed.article.relativePath,
    commitHash: null,
    revisionId: committed.revision.id,
    revisionNumber: committed.revision.revisionNumber,
    exportStatus: 'waiting_export',
    publishedAt: committed.publishedAt
  }
}

export const restoreCmsDeletedArticleDatabase = async (
  articleId: string,
  operatorUserId: string,
  testHooks: CmsDatabaseDeletionTestHooks = {}
): Promise<CmsPublishResult> => {
  const db = getDatabase()
  const committed = await db.transaction(async (tx) => {
    const [article] = await tx
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), isNotNull(articles.deletedAt)))
      .limit(1)
      .for('update')
    if (!article) throw new CmsArticleDeletionNotFoundError()
    if (!article.currentRevisionId) {
      throw new CmsArticleDeletionStateError('找不到可恢复的数据库 Revision')
    }
    const [sourceRevision] = await tx
      .select()
      .from(articleRevisions)
      .where(and(
        eq(articleRevisions.id, article.currentRevisionId),
        eq(articleRevisions.articleId, articleId)
      ))
      .limit(1)
    if (!sourceRevision) {
      throw new CmsArticleDeletionStateError('找不到可恢复的数据库 Revision')
    }

    const now = new Date()
    const operationId = randomUUID()
    await tx.insert(publishRecords).values({
      id: operationId,
      articleId,
      operatorUserId,
      operation: 'restore',
      status: 'succeeded',
      articlePath: `${article.collection}/${article.relativePath}`,
      message:
        `cms: database restore deleted ${article.collection}/${article.relativePath}`,
      metadata: {
        authority: 'database',
        restoreDeleted: true,
        sourceRevisionId: sourceRevision.id
      },
      completedAt: now
    })
    await upsertPublishedArticle(tx, {
      articleId,
      collection: article.collection as CmsArticleCollection,
      relativePath: article.relativePath,
      title: typeof sourceRevision.frontmatter.title === 'string'
        ? sourceRevision.frontmatter.title.trim()
        : article.title,
      frontmatter: sourceRevision.frontmatter,
      body: sourceRevision.body,
      contentHash: sourceRevision.contentHash
    })
    const revision = await appendCmsArticleRevision(tx, {
      articleId,
      markdownSource: sourceRevision.markdownSource,
      body: sourceRevision.body,
      frontmatter: sourceRevision.frontmatter,
      contentHash: sourceRevision.contentHash,
      sourceKind: 'restore',
      publishedByUserId: operatorUserId,
      restoredFromRevisionId: sourceRevision.id,
      sourceOperationId: operationId,
      gitCommitHash: null,
      createdAt: now
    })
    if (testHooks.failAt === 'after_revision') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_DELETE_RESTORE_REVISION')
    }

    const exportJobId = randomUUID()
    const serialized = serializeContentRevision({
      articleId,
      collection: article.collection as CmsArticleCollection,
      relativePath: article.relativePath,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      frontmatter: revision.frontmatter,
      body: revision.body,
      revisionCreatedAt: revision.createdAt
    })
    await tx.insert(contentExportJobs).values({
      id: exportJobId,
      targetType: 'article',
      targetId: articleId,
      revisionId: revision.id,
      operation: 'update',
      status: 'pending',
      idempotencyKey: `article:${articleId}:revision:${revision.id}:update`,
      targetPath: serialized.path,
      expectedSha256: serialized.sha256,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    })
    if (testHooks.failAt === 'after_outbox') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_DELETE_RESTORE_OUTBOX')
    }

    await tx.update(publishRecords).set({
      metadata: {
        authority: 'database',
        restoreDeleted: true,
        sourceRevisionId: sourceRevision.id,
        revisionId: revision.id,
        exportJobId
      }
    }).where(eq(publishRecords.id, operationId))
    await tx.insert(articleDeletionEvents).values({
      articleId,
      actorUserId: operatorUserId,
      operation: 'restore',
      articlePath: `${article.collection}/${article.relativePath}`,
      sourceRevisionId: sourceRevision.id,
      resultRevisionId: revision.id,
      exportJobId,
      metadata: { authority: 'database' }
    })
    await tx.insert(auditLogs).values({
      actorUserId: operatorUserId,
      action: 'article.restore',
      targetType: 'article',
      targetId: articleId,
      metadata: {
        authority: 'database',
        relativePath: article.relativePath,
        restoredFromRevisionId: sourceRevision.id,
        revisionId: revision.id,
        exportJobId
      }
    })
    return { article, revision, publishedAt: now.toISOString() }
  })

  invalidatePublicContentCache({
    collection: committed.article.collection as CmsArticleCollection,
    articleId
  })
  return {
    articleId,
    collection: committed.article.collection as CmsArticleCollection,
    relativePath: committed.article.relativePath,
    commitHash: null,
    revisionId: committed.revision.id,
    revisionNumber: committed.revision.revisionNumber,
    exportStatus: 'waiting_export',
    publishedAt: committed.publishedAt
  }
}
