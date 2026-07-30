import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getDatabase } from '../db/client'
import {
  articles,
  articleRevisions,
  auditLogs,
  contentExportJobs,
  draftAuthors,
  drafts,
  members,
  publishRecords,
  reviewEvents,
  userMembers
} from '../db/schema'
import { invalidatePublicContentCache } from './public-content-cache'
import {
  buildPublishedSource,
  CmsPublishConflictError,
  CmsPublishNotFoundError,
  CmsPublishPathError,
  CmsPublishStateError,
  normalizeRelativePath,
  suggestCmsArticlePath,
  upsertPublishedArticle
} from './cms-publishing-legacy'
import { appendCmsArticleRevision } from './cms-revisions'
import { serializeContentRevision } from './content-export-serialization'

const sha256 = (source: string) =>
  createHash('sha256').update(source).digest('hex')

export interface CmsDatabasePublishTestHooks {
  failAt?: 'after_revision' | 'after_outbox'
}

export const publishCmsDraftDatabase = async (
  draftId: string,
  operatorUserId: string,
  input: { version: number, relativePath?: string },
  testHooks: CmsDatabasePublishTestHooks = {}
): Promise<CmsPublishResult> => {
  const db = getDatabase()
  const committed = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), isNull(drafts.deletedAt)))
      .limit(1)
      .for('update')
    if (!draft) throw new CmsPublishNotFoundError()
    if (draft.status !== 'approved' || draft.version !== input.version) {
      throw new CmsPublishStateError()
    }

    const [review] = await tx
      .select({ actorUserId: reviewEvents.actorUserId })
      .from(reviewEvents)
      .where(and(
        eq(reviewEvents.draftId, draftId),
        eq(reviewEvents.action, 'approved')
      ))
      .orderBy(desc(reviewEvents.createdAt))
      .limit(1)
    if (!review?.actorUserId) throw new CmsPublishStateError()

    const authorRows = await tx
      .select({ memberKey: members.memberKey })
      .from(draftAuthors)
      .innerJoin(members, eq(draftAuthors.memberId, members.id))
      .where(eq(draftAuthors.draftId, draftId))
      .orderBy(draftAuthors.position)
    const [owner] = await tx
      .select({ memberKey: members.memberKey })
      .from(userMembers)
      .innerJoin(members, eq(userMembers.memberId, members.id))
      .where(eq(userMembers.userId, draft.ownerUserId))
      .limit(1)

    const existingArticle = draft.articleId
      ? (await tx
          .select()
          .from(articles)
          .where(eq(articles.id, draft.articleId))
          .limit(1)
          .for('update'))[0]
      : null
    if (draft.articleId && !existingArticle) throw new CmsPublishNotFoundError()
    if (
      existingArticle
      && (existingArticle.deletedAt || existingArticle.isPresent !== 'true')
    ) {
      throw new CmsPublishStateError()
    }
    if (
      existingArticle
      && (
        !existingArticle.currentRevisionId
        || !draft.baseRevisionId
        || draft.baseRevisionId !== existingArticle.currentRevisionId
      )
    ) {
      throw new CmsPublishConflictError()
    }
    if (!existingArticle && draft.baseRevisionId) {
      throw new CmsPublishConflictError()
    }

    const collection = draft.collection as CmsArticleCollection
    const relativePath = normalizeRelativePath(
      existingArticle?.relativePath
      || input.relativePath
      || suggestCmsArticlePath(collection, draft.title, draft.id)
    )
    if (
      existingArticle
      && input.relativePath
      && relativePath !== existingArticle.relativePath
    ) {
      throw new CmsPublishPathError('现有文章不允许在发布时改名或移动')
    }

    const now = new Date()
    const built = buildPublishedSource({
      preservedFrontmatter: draft.preservedFrontmatter,
      title: draft.title,
      description: draft.description,
      authorKeys: authorRows.map(row => row.memberKey),
      ownerMemberKey: owner?.memberKey,
      body: draft.body,
      now
    })
    const contentHash = sha256(built.source)
    const articleId = await upsertPublishedArticle(tx, {
      articleId: draft.articleId,
      collection,
      relativePath,
      title: draft.title,
      frontmatter: built.frontmatter,
      body: draft.body,
      contentHash
    })

    const operationId = randomUUID()
    const message = `cms: database publish ${collection}/${relativePath}`
    await tx.insert(publishRecords).values({
      id: operationId,
      draftId,
      articleId,
      operatorUserId,
      reviewerUserId: review.actorUserId,
      operation: 'publish',
      status: 'succeeded',
      articlePath: `${collection}/${relativePath}`,
      message,
      metadata: {
        authority: 'database',
        draftVersion: draft.version,
        baseRevisionId: draft.baseRevisionId
      },
      completedAt: now
    })

    const revision = await appendCmsArticleRevision(tx, {
      articleId,
      markdownSource: built.source,
      body: draft.body,
      frontmatter: built.frontmatter,
      contentHash,
      sourceKind: 'publish',
      sourceDraftId: draftId,
      publishedByUserId: operatorUserId,
      reviewedByUserId: review.actorUserId,
      sourceOperationId: operationId,
      gitCommitHash: null,
      createdAt: now
    })
    if (testHooks.failAt === 'after_revision') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_REVISION')
    }

    const exportJobId = randomUUID()
    const serialized = serializeContentRevision({
      articleId,
      collection,
      relativePath,
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
      operation: existingArticle ? 'update' : 'create',
      status: 'pending',
      idempotencyKey:
        `article:${articleId}:revision:${revision.id}:${existingArticle ? 'update' : 'create'}`,
      targetPath: serialized.path,
      expectedSha256: serialized.sha256,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    })
    if (testHooks.failAt === 'after_outbox') {
      throw new Error('PHASE5_TEST_FAIL_AFTER_OUTBOX')
    }

    const [published] = await tx
      .update(drafts)
      .set({
        articleId,
        status: 'published',
        baseContentHash: contentHash,
        baseRevisionId: revision.id,
        version: draft.version + 1,
        updatedAt: now
      })
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.status, 'approved'),
        eq(drafts.version, draft.version)
      ))
      .returning({ id: drafts.id })
    if (!published) throw new CmsPublishStateError()

    await tx
      .update(publishRecords)
      .set({
        metadata: {
          authority: 'database',
          draftVersion: draft.version,
          baseRevisionId: draft.baseRevisionId,
          revisionId: revision.id,
          exportJobId
        }
      })
      .where(eq(publishRecords.id, operationId))
    await tx.insert(auditLogs).values({
      actorUserId: operatorUserId,
      action: 'article.publish',
      targetType: 'article',
      targetId: articleId,
      metadata: {
        authority: 'database',
        draftId,
        reviewerUserId: review.actorUserId,
        relativePath,
        previousRevisionId: existingArticle?.currentRevisionId || null,
        revisionId: revision.id,
        exportJobId
      }
    })

    return {
      articleId,
      collection,
      relativePath,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      previousRevisionId: existingArticle?.currentRevisionId || null,
      publishedAt: now.toISOString()
    }
  })

  invalidatePublicContentCache({
    collection: committed.collection,
    articleId: committed.articleId
  })
  return {
    articleId: committed.articleId,
    collection: committed.collection,
    relativePath: committed.relativePath,
    commitHash: null,
    revisionId: committed.revisionId,
    revisionNumber: committed.revisionNumber,
    exportStatus: 'waiting_export',
    publishedAt: committed.publishedAt
  }
}

export const restoreCmsArticleRevisionDatabase = async (
  articleId: string,
  sourceRevisionId: string,
  operatorUserId: string,
  testHooks: CmsDatabasePublishTestHooks = {}
): Promise<CmsPublishResult> => {
  const db = getDatabase()
  const committed = await db.transaction(async (tx) => {
    const [article] = await tx
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1)
      .for('update')
    if (!article) throw new CmsPublishNotFoundError()
    if (article.deletedAt || article.isPresent !== 'true') {
      throw new CmsPublishStateError()
    }
    if (!article.currentRevisionId) throw new CmsPublishConflictError()

    const [sourceRevision] = await tx
      .select()
      .from(articleRevisions)
      .where(and(
        eq(articleRevisions.id, sourceRevisionId),
        eq(articleRevisions.articleId, articleId)
      ))
      .limit(1)
    if (!sourceRevision) throw new CmsPublishNotFoundError()
    if (sourceRevision.id === article.currentRevisionId) {
      throw new CmsPublishPathError('所选 Revision 已经是当前版本')
    }

    const now = new Date()
    const operationId = randomUUID()
    const message =
      `cms: database restore ${article.collection}/${article.relativePath}`
      + ` from revision ${sourceRevision.revisionNumber}`
    await tx.insert(publishRecords).values({
      id: operationId,
      articleId,
      operatorUserId,
      operation: 'restore',
      status: 'succeeded',
      articlePath: `${article.collection}/${article.relativePath}`,
      message,
      metadata: {
        authority: 'database',
        restoredRevisionId: sourceRevision.id,
        restoredRevisionNumber: sourceRevision.revisionNumber
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
      throw new Error('PHASE5_TEST_FAIL_AFTER_REVISION')
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
      throw new Error('PHASE5_TEST_FAIL_AFTER_OUTBOX')
    }

    await tx.update(publishRecords).set({
      metadata: {
        authority: 'database',
        restoredRevisionId: sourceRevision.id,
        restoredRevisionNumber: sourceRevision.revisionNumber,
        revisionId: revision.id,
        exportJobId
      }
    }).where(eq(publishRecords.id, operationId))
    await tx.insert(auditLogs).values({
      actorUserId: operatorUserId,
      action: 'article.restore',
      targetType: 'article',
      targetId: articleId,
      metadata: {
        authority: 'database',
        relativePath: article.relativePath,
        previousRevisionId: article.currentRevisionId,
        restoredFromRevisionId: sourceRevision.id,
        revisionId: revision.id,
        exportJobId
      }
    })
    return {
      article,
      revision,
      publishedAt: now.toISOString()
    }
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
