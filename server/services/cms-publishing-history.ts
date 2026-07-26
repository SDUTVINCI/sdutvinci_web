import { createHash } from 'node:crypto'
import { diffLines } from 'diff'
import { eq } from 'drizzle-orm'
import type {
  CmsArticleHistoryEntry,
  CmsArticleVersion,
  CmsArticleVersionDiff,
  CmsPublishResult
} from '../../shared/types/cms-publishing'
import { getDatabase } from '../db/client'
import {
  articles,
  auditLogs,
  publishRecords
} from '../db/schema'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import { getCmsGitConfig } from '../utils/cms-git-config'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import {
  assertCmsGitCommit,
  atomicWriteCmsGitArticle,
  prepareCmsGitWorktree,
  readCmsGitArticle,
  resetCmsGitWorktree,
  runCmsGit,
  runCmsGitRaw,
  withCmsPublishLock
} from './cms-git-worktree'
import {
  CmsPublishGitError,
  CmsPublishNotFoundError,
  CmsPublishPathError,
  upsertPublishedArticle
} from './cms-publishing'

const sha256 = (source: string) => createHash('sha256').update(source).digest('hex')

const loadArticle = async (articleId: string) => {
  const [article] = await getDatabase()
    .select()
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)
  if (!article) throw new CmsPublishNotFoundError()
  return article
}

const readVersionSource = async (
  gitPath: string,
  commit: string
) => {
  assertCmsGitCommit(commit)
  await runCmsGit(['rev-parse', '--verify', `${commit}^{commit}`])
  return runCmsGitRaw(['show', `${commit}:${gitPath}`])
}

export const listCmsArticleHistory = async (
  articleId: string
): Promise<CmsArticleHistoryEntry[]> => {
  const article = await loadArticle(articleId)
  return withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    const gitPath = `content/${article.collection}/${article.relativePath}`
    const output = await runCmsGit([
      'log',
      '--follow',
      '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
      '--',
      gitPath
    ])
    return output
      .split('\u001e')
      .map(record => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [commitHash, shortHash, authorName, authoredAt, subject] =
          record.split('\u001f')
        return {
          commitHash: commitHash!,
          shortHash: shortHash!,
          authorName: authorName!,
          authoredAt: authoredAt!,
          subject: subject!
        }
      })
  })
}

export const getCmsArticleVersion = async (
  articleId: string,
  commit: string
): Promise<CmsArticleVersion> => {
  const article = await loadArticle(articleId)
  return withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    return {
      articleId,
      commitHash: assertCmsGitCommit(commit),
      source: await readVersionSource(
        `content/${article.collection}/${article.relativePath}`,
        commit
      )
    }
  })
}

export const diffCmsArticleVersions = async (
  articleId: string,
  fromCommit: string,
  toCommit: string
): Promise<CmsArticleVersionDiff> => {
  const article = await loadArticle(articleId)
  return withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    const gitPath = `content/${article.collection}/${article.relativePath}`
    const [from, to] = await Promise.all([
      readVersionSource(gitPath, fromCommit),
      readVersionSource(gitPath, toCommit)
    ])
    return {
      articleId,
      fromCommit: assertCmsGitCommit(fromCommit),
      toCommit: assertCmsGitCommit(toCommit),
      parts: diffLines(from, to).map(part => ({
        type: part.added ? 'added' : part.removed ? 'removed' : 'same',
        value: part.value
      }))
    }
  })
}

export const restoreCmsArticleVersion = async (
  articleId: string,
  commit: string,
  operatorUserId: string
): Promise<CmsPublishResult> => {
  const article = await loadArticle(articleId)
  const safeCommit = assertCmsGitCommit(commit)
  const message = `cms: restore ${article.collection}/${article.relativePath} from ${safeCommit.slice(0, 12)}`
  const db = getDatabase()
  const [attempt] = await db.insert(publishRecords).values({
    articleId,
    operatorUserId,
    operation: 'restore',
    status: 'pending',
    articlePath: `${article.collection}/${article.relativePath}`,
    message,
    metadata: { restoredCommit: safeCommit }
  }).returning()
  try {
    return await withCmsPublishLock(async () => {
      await prepareCmsGitWorktree()
      const gitPath = `content/${article.collection}/${article.relativePath}`
      const source = await readVersionSource(gitPath, safeCommit)
      const current = await readCmsGitArticle(
        article.collection as 'news' | 'wiki',
        article.relativePath
      )
      if (source === current) {
        throw new CmsPublishPathError('所选版本已经是当前版本')
      }
      const parsed = parseCmsMarkdown(source)
      const title = typeof parsed.frontmatter.title === 'string'
        ? parsed.frontmatter.title.trim()
        : article.title
      const written = await atomicWriteCmsGitArticle(
        article.collection as 'news' | 'wiki',
        article.relativePath,
        source
      )
      await runCmsGit(['add', '--', written.gitPath])
      await runCmsGit(['commit', '-m', message, '--', written.gitPath])
      const commitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const config = getCmsGitConfig()
      await runCmsGit(['push', config.CMS_GIT_REMOTE, `HEAD:${config.CMS_GIT_BRANCH}`])
      const now = new Date()
      await db.transaction(async (tx) => {
        await upsertPublishedArticle(tx, {
          articleId,
          collection: article.collection as 'news' | 'wiki',
          relativePath: article.relativePath,
          title,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          contentHash: sha256(source)
        })
        await tx.update(publishRecords).set({
          status: 'succeeded',
          commitHash,
          completedAt: now
        }).where(eq(publishRecords.id, attempt!.id))
        await tx.insert(auditLogs).values({
          actorUserId: operatorUserId,
          action: 'article.restore',
          targetType: 'article',
          targetId: articleId,
          metadata: {
            relativePath: article.relativePath,
            restoredCommit: safeCommit,
            commitHash
          }
        })
      })
      return {
        articleId,
        collection: article.collection as 'news' | 'wiki',
        relativePath: article.relativePath,
        commitHash,
        publishedAt: now.toISOString()
      }
    })
  } catch (error) {
    try {
      await withCmsPublishLock(resetCmsGitWorktree)
    } catch {
      // 原始错误优先。
    }
    await db.update(publishRecords).set({
      status: 'failed',
      failureReason: describeCmsFailure(error),
      completedAt: new Date()
    }).where(eq(publishRecords.id, attempt!.id))
    if (error instanceof CmsPublishPathError) throw error
    throw new CmsPublishGitError(describeCmsFailure(error))
  }
}
