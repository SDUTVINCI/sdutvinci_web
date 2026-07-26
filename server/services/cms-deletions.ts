import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getDatabase } from '../db/client'
import {
  articleDeletionEvents,
  articles,
  auditLogs
} from '../db/schema'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import {
  atomicWriteCmsGitArticle,
  cmsGitArticlePath,
  prepareCmsGitWorktree,
  readCmsGitArticle,
  removeCmsGitArticle,
  resetCmsGitWorktree,
  runCmsGit,
  runCmsGitRaw,
  withCmsPublishLock
} from './cms-git-worktree'
import { getCmsGitConfig } from '../utils/cms-git-config'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import { upsertPublishedArticle } from './cms-publishing'

const sha256 = (source: string) => createHash('sha256').update(source).digest('hex')

export class CmsArticleDeletionNotFoundError extends Error {
  constructor() { super('ARTICLE_DELETION_NOT_FOUND') }
}

export class CmsArticleDeletionStateError extends Error {
  constructor(message = 'ARTICLE_DELETION_STATE_INVALID') { super(message) }
}

export class CmsArticleDeletionGitError extends Error {
  constructor(message: string) { super(message) }
}

const loadArticle = async (articleId: string, deleted: boolean) => {
  const [article] = await getDatabase()
    .select()
    .from(articles)
    .where(and(
      eq(articles.id, articleId),
      deleted ? isNotNull(articles.deletedAt) : eq(articles.isPresent, 'true'),
      ...(deleted ? [] : [isNull(articles.deletedAt)])
    ))
    .limit(1)
  return article || null
}

const gitPathFor = (article: typeof articles.$inferSelect) =>
  `content/${article.collection}/${article.relativePath}`

const resetAfterFailure = async () => {
  try { await withCmsPublishLock(resetCmsGitWorktree) } catch { /* 保留原始错误 */ }
}

export const deleteCmsArticle = async (
  articleId: string,
  operatorUserId: string
): Promise<CmsPublishResult> => {
  const article = await loadArticle(articleId, false)
  if (!article || article.deletedAt) throw new CmsArticleDeletionNotFoundError()
  const collection = article.collection as CmsArticleCollection
  const message = `cms: delete ${collection}/${article.relativePath}`

  try {
    return await withCmsPublishLock(async () => {
      await prepareCmsGitWorktree()
      const source = await readCmsGitArticle(collection, article.relativePath)
      if (sha256(source) !== article.contentHash) {
        throw new CmsArticleDeletionStateError('正式文章已发生变化，请重新同步后再删除')
      }
      const sourceCommitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const removed = await removeCmsGitArticle(collection, article.relativePath)
      await runCmsGit(['add', '--all', '--', removed.gitPath])
      await runCmsGit(['commit', '-m', message, '--', removed.gitPath])
      const commitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const config = getCmsGitConfig()
      await runCmsGit(['push', config.CMS_GIT_REMOTE, `HEAD:${config.CMS_GIT_BRANCH}`])
      const now = new Date()
      await getDatabase().transaction(async (tx) => {
        await tx.update(articles).set({
          isPresent: 'false',
          deletedAt: now,
          deletedByUserId: operatorUserId,
          updatedAt: now
        }).where(and(eq(articles.id, articleId), eq(articles.isPresent, 'true')))
        await tx.insert(articleDeletionEvents).values({
          articleId,
          actorUserId: operatorUserId,
          operation: 'delete',
          articlePath: `${collection}/${article.relativePath}`,
          sourceCommitHash,
          commitHash,
          metadata: { contentHash: article.contentHash }
        })
        await tx.insert(auditLogs).values({
          actorUserId: operatorUserId,
          action: 'article.delete',
          targetType: 'article',
          targetId: articleId,
          metadata: { relativePath: article.relativePath, sourceCommitHash, commitHash }
        })
      })
      return {
        articleId,
        collection,
        relativePath: article.relativePath,
        commitHash,
        publishedAt: now.toISOString()
      }
    })
  } catch (error) {
    await resetAfterFailure()
    if (error instanceof CmsArticleDeletionStateError) throw error
    throw new CmsArticleDeletionGitError(describeCmsFailure(error))
  }
}

export const restoreCmsArticle = async (
  articleId: string,
  operatorUserId: string
): Promise<CmsPublishResult> => {
  const article = await loadArticle(articleId, true)
  if (!article || !article.deletedAt) throw new CmsArticleDeletionNotFoundError()
  const [deletion] = await getDatabase()
    .select()
    .from(articleDeletionEvents)
    .where(and(
      eq(articleDeletionEvents.articleId, articleId),
      eq(articleDeletionEvents.operation, 'delete')
    ))
    .orderBy(desc(articleDeletionEvents.createdAt))
    .limit(1)
  if (!deletion) throw new CmsArticleDeletionStateError('找不到可恢复的删除版本')

  const collection = article.collection as CmsArticleCollection
  const gitPath = gitPathFor(article)
  const message = `cms: restore ${collection}/${article.relativePath}`
  try {
    return await withCmsPublishLock(async () => {
      await prepareCmsGitWorktree()
      const resolved = cmsGitArticlePath(collection, article.relativePath)
      try {
        await access(resolved.target)
        throw new CmsArticleDeletionStateError('远端文章路径已存在，无法安全恢复')
      } catch (error: any) {
        if (error instanceof CmsArticleDeletionStateError) throw error
        if (error?.code !== 'ENOENT') throw error
      }
      await runCmsGit(['rev-parse', '--verify', `${deletion.sourceCommitHash}^{commit}`])
      const source = await runCmsGitRaw(['show', `${deletion.sourceCommitHash}:${gitPath}`])
      const parsed = parseCmsMarkdown(source)
      const written = await atomicWriteCmsGitArticle(collection, article.relativePath, source)
      await runCmsGit(['add', '--', written.gitPath])
      await runCmsGit(['commit', '-m', message, '--', written.gitPath])
      const commitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const config = getCmsGitConfig()
      await runCmsGit(['push', config.CMS_GIT_REMOTE, `HEAD:${config.CMS_GIT_BRANCH}`])
      const now = new Date()
      await getDatabase().transaction(async (tx) => {
        await upsertPublishedArticle(tx, {
          articleId,
          collection,
          relativePath: article.relativePath,
          title: typeof parsed.frontmatter.title === 'string'
            ? parsed.frontmatter.title.trim()
            : article.title,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          contentHash: sha256(source)
        })
        await tx.insert(articleDeletionEvents).values({
          articleId,
          actorUserId: operatorUserId,
          operation: 'restore',
          articlePath: `${collection}/${article.relativePath}`,
          sourceCommitHash: deletion.commitHash,
          commitHash,
          metadata: { restoredFromCommit: deletion.sourceCommitHash }
        })
        await tx.insert(auditLogs).values({
          actorUserId: operatorUserId,
          action: 'article.restore',
          targetType: 'article',
          targetId: articleId,
          metadata: {
            relativePath: article.relativePath,
            restoredFromCommit: deletion.sourceCommitHash,
            commitHash
          }
        })
      })
      return {
        articleId,
        collection,
        relativePath: article.relativePath,
        commitHash,
        publishedAt: now.toISOString()
      }
    })
  } catch (error) {
    await resetAfterFailure()
    if (error instanceof CmsArticleDeletionStateError) throw error
    throw new CmsArticleDeletionGitError(describeCmsFailure(error))
  }
}
