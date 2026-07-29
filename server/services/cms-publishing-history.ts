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
  getContentPublishMode,
  isCmsDatabaseAuthorityEnabled,
  isCmsRevisionShadowEnabled
} from '../utils/cms-v2-flags'
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
import {
  appendCmsArticleRevision,
  diffCmsArticleRevisions,
  findCmsRevisionForSource,
  getCmsArticleRevision,
  listCmsArticleRevisions
} from './cms-revisions'
import { restoreCmsArticleRevisionDatabase } from './cms-publishing-database'

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
  if (isCmsDatabaseAuthorityEnabled()) {
    return (await listCmsArticleRevisions(articleId)).map(revision => ({
      commitHash: revision.id,
      shortHash: `r${revision.revisionNumber}`,
      authorName: revision.publishedByUserId || 'system',
      authoredAt: revision.createdAt,
      subject: revision.sourceKind === 'restore'
        ? `恢复为 Revision #${revision.revisionNumber}`
        : `数据库 Revision #${revision.revisionNumber}`,
      authority: 'database',
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber
    }))
  }
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
          subject: subject!,
          authority: 'legacy_git' as const
        }
      })
  })
}

export const getCmsArticleVersion = async (
  articleId: string,
  commit: string
): Promise<CmsArticleVersion> => {
  if (isCmsDatabaseAuthorityEnabled()) {
    const revision = await getCmsArticleRevision(articleId, commit)
    return {
      articleId,
      commitHash: revision.id,
      source: revision.markdownSource,
      authority: 'database',
      revisionNumber: revision.revisionNumber
    }
  }
  const article = await loadArticle(articleId)
  return withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    return {
      articleId,
      commitHash: assertCmsGitCommit(commit),
      source: await readVersionSource(
        `content/${article.collection}/${article.relativePath}`,
        commit
      ),
      authority: 'legacy_git'
    }
  })
}

export const diffCmsArticleVersions = async (
  articleId: string,
  fromCommit: string,
  toCommit: string,
  scope: 'source' | 'body' = 'source'
): Promise<CmsArticleVersionDiff> => {
  if (isCmsDatabaseAuthorityEnabled()) {
    const diff = await diffCmsArticleRevisions(articleId, fromCommit, toCommit)
    return {
      articleId,
      fromCommit: diff.fromRevisionId,
      toCommit: diff.toRevisionId,
      authority: 'database',
      parts: diff.parts
    }
  }
  const article = await loadArticle(articleId)
  return withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    const gitPath = `content/${article.collection}/${article.relativePath}`
    const [from, to] = await Promise.all([
      readVersionSource(gitPath, fromCommit),
      readVersionSource(gitPath, toCommit)
    ])
    const fromValue = scope === 'body' ? parseCmsMarkdown(from).body : from
    const toValue = scope === 'body' ? parseCmsMarkdown(to).body : to
    return {
      articleId,
      fromCommit: assertCmsGitCommit(fromCommit),
      toCommit: assertCmsGitCommit(toCommit),
      authority: 'legacy_git',
      parts: diffLines(fromValue, toValue).map(part => ({
        type: part.added ? 'added' : part.removed ? 'removed' : 'same',
        value: part.value
      }))
    }
  })
}

const restoreCmsArticleSource = async (
  article: Awaited<ReturnType<typeof loadArticle>>,
  operatorUserId: string,
  input: {
    message: string
    metadata: Record<string, unknown>
    loadSource: (gitPath: string) => Promise<string>
    restoredFromRevisionId?: string | null
  }
): Promise<CmsPublishResult> => {
  const articleId = article.id
  const revisionShadowEnabled = isCmsRevisionShadowEnabled()
  const db = getDatabase()
  const [attempt] = await db.insert(publishRecords).values({
    articleId,
    operatorUserId,
    operation: 'restore',
    status: 'pending',
    articlePath: `${article.collection}/${article.relativePath}`,
    message: input.message,
    metadata: input.metadata
  }).returning()
  try {
    return await withCmsPublishLock(async () => {
      await prepareCmsGitWorktree()
      const gitPath = `content/${article.collection}/${article.relativePath}`
      const source = await input.loadSource(gitPath)
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
      await runCmsGit(['commit', '-m', input.message, '--', written.gitPath])
      const commitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const config = getCmsGitConfig()
      await runCmsGit(['push', config.CMS_GIT_REMOTE, `HEAD:${config.CMS_GIT_BRANCH}`])
      const now = new Date()
      const contentHash = sha256(source)
      const restoredFromRevision = revisionShadowEnabled
        ? input.restoredFromRevisionId
          ? { id: input.restoredFromRevisionId }
          : await findCmsRevisionForSource(articleId, source, contentHash)
        : null
      const restored = await db.transaction(async (tx) => {
        await upsertPublishedArticle(tx, {
          articleId,
          collection: article.collection as 'news' | 'wiki',
          relativePath: article.relativePath,
          title,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          contentHash
        })
        const revision = revisionShadowEnabled
          ? await appendCmsArticleRevision(tx, {
              articleId,
              markdownSource: source,
              body: parsed.body,
              frontmatter: parsed.frontmatter,
              contentHash,
              sourceKind: 'restore',
              publishedByUserId: operatorUserId,
              restoredFromRevisionId: restoredFromRevision?.id || null,
              sourceOperationId: attempt!.id,
              gitCommitHash: commitHash,
              createdAt: now
            })
          : null
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
            ...input.metadata,
            commitHash,
            revisionId: revision?.id || null
          }
        })
        return {
          revisionId: revision?.id || null,
          revisionNumber: revision?.revisionNumber || null
        }
      })
      return {
        articleId,
        collection: article.collection as 'news' | 'wiki',
        relativePath: article.relativePath,
        commitHash,
        revisionId: restored.revisionId,
        revisionNumber: restored.revisionNumber,
        exportStatus: 'not_applicable',
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

export const restoreCmsArticleVersion = async (
  articleId: string,
  commit: string,
  operatorUserId: string
): Promise<CmsPublishResult> => {
  if (getContentPublishMode() === 'database') {
    return restoreCmsArticleRevisionDatabase(articleId, commit, operatorUserId)
  }
  const article = await loadArticle(articleId)
  const safeCommit = assertCmsGitCommit(commit)
  return restoreCmsArticleSource(article, operatorUserId, {
    message: `cms: restore ${article.collection}/${article.relativePath} from ${safeCommit.slice(0, 12)}`,
    metadata: { restoredCommit: safeCommit },
    loadSource: gitPath => readVersionSource(gitPath, safeCommit)
  })
}

export const restoreCmsArticleRevision = async (
  articleId: string,
  revisionId: string,
  operatorUserId: string
): Promise<CmsPublishResult> => {
  if (getContentPublishMode() === 'database') {
    return restoreCmsArticleRevisionDatabase(
      articleId,
      revisionId,
      operatorUserId
    )
  }
  const [article, revision] = await Promise.all([
    loadArticle(articleId),
    getCmsArticleRevision(articleId, revisionId)
  ])
  return restoreCmsArticleSource(article, operatorUserId, {
    message: `cms: restore ${article.collection}/${article.relativePath} from revision ${revision.revisionNumber}`,
    metadata: {
      restoredRevisionId: revision.id,
      restoredRevisionNumber: revision.revisionNumber
    },
    loadSource: async () => revision.markdownSource,
    restoredFromRevisionId: revision.id
  })
}
