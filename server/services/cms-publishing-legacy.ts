import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getDatabase } from '../db/client'
import {
  articles,
  auditLogs,
  draftAuthors,
  drafts,
  members,
  publishRecords,
  reviewEvents,
  userMembers
} from '../db/schema'
import { parseCmsMarkdown, writeCmsMarkdown } from '../utils/cms-frontmatter'
import { getCmsGitConfig } from '../utils/cms-git-config'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import { isCmsRevisionShadowEnabled } from '../utils/cms-v2-flags'
import {
  atomicWriteCmsGitArticle,
  cmsGitArticlePath,
  prepareCmsGitWorktree,
  readCmsGitArticle,
  resetCmsGitWorktree,
  runCmsGit,
  withCmsPublishLock
} from './cms-git-worktree'
import {
  getCmsArticleDirectory,
  getCmsArticlePublicPath
} from './cms-articles'
import { appendCmsArticleRevision } from './cms-revisions'

export class CmsPublishNotFoundError extends Error {
  constructor() {
    super('PUBLISH_DRAFT_NOT_FOUND')
  }
}

export class CmsPublishStateError extends Error {
  constructor() {
    super('PUBLISH_DRAFT_STATE_INVALID')
  }
}

export class CmsPublishConflictError extends Error {
  constructor() {
    super('PUBLISH_CONTENT_CONFLICT')
  }
}

export class CmsPublishPathError extends Error {
  constructor(message = 'PUBLISH_PATH_INVALID') {
    super(message)
  }
}

export class CmsPublishGitError extends Error {
  constructor(message: string) {
    super(message)
  }
}

const sha256 = (source: string) => createHash('sha256').update(source).digest('hex')

export const normalizeRelativePath = (value: string) => {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (
    !normalized
    || !normalized.endsWith('.md')
    || normalized.split('/').some(segment => !segment || segment === '..' || segment === '.')
  ) {
    throw new CmsPublishPathError()
  }
  return normalized
}

const slugFromTitle = (title: string) => {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'article'
}

export const suggestCmsArticlePath = (
  collection: CmsArticleCollection,
  title: string,
  draftId: string,
  now = new Date()
) => {
  const suffix = draftId.slice(0, 8)
  const stem = `${slugFromTitle(title)}-${suffix}`
  if (collection === 'news') {
    return `${now.toISOString().slice(0, 10)}-${stem}.md`
  }
  return `${stem}.md`
}

const descriptionFromBody = (body: string) => {
  const paragraph = body
    .split(/\n\s*\n/)
    .map(value => value
      .replace(/```[\s\S]*?```/g, '')
      .replace(/!\[[^\]]*]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/^[#>*+\-\d.\s]+/gm, '')
      .replace(/[`_*~]/g, '')
      .trim())
    .find(Boolean)
  return (paragraph || '').slice(0, 240)
}

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : []

export const buildPublishedSource = (input: {
  preservedFrontmatter: Record<string, unknown>
  title: string
  description: string
  authorKeys: string[]
  ownerMemberKey?: string
  body: string
  now: Date
}) => {
  const existing = input.preservedFrontmatter
  const authors = [...new Set(input.authorKeys)]
  const contributors = [...new Set([
    ...stringArray(existing.contributors),
    ...(input.ownerMemberKey && !authors.includes(input.ownerMemberKey)
      ? [input.ownerMemberKey]
      : [])
  ])]
  const frontmatter: Record<string, unknown> = {
    ...existing,
    title: input.title.trim(),
    description: input.description.trim() || descriptionFromBody(input.body),
    authors,
    ...(contributors.length ? { contributors } : {}),
    publishedAt: typeof existing.publishedAt === 'string' && existing.publishedAt
      ? existing.publishedAt
      : input.now.toISOString(),
    updatedAt: input.now.toISOString()
  }
  const source = writeCmsMarkdown(frontmatter, input.body)
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) {
    throw new Error('发布内容超过 2 MiB 限制')
  }
  const parsed = parseCmsMarkdown(source)
  if (
    parsed.frontmatter.title !== frontmatter.title
    || !Array.isArray(parsed.frontmatter.authors)
    || parsed.body !== input.body
  ) {
    throw new Error('生成的 Markdown 未通过完整性校验')
  }
  return { source, frontmatter }
}

export const upsertPublishedArticle = async (
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  input: {
    articleId: string | null
    collection: CmsArticleCollection
    relativePath: string
    title: string
    frontmatter: Record<string, unknown>
    body: string
    contentHash: string
    allowCreateWithArticleId?: boolean
  }
) => {
  const values = {
    collection: input.collection,
    relativePath: input.relativePath,
    publicPath: getCmsArticlePublicPath(input.collection, input.relativePath),
    directory: getCmsArticleDirectory(input.collection, input.relativePath),
    title: input.title,
    frontmatter: input.frontmatter,
    searchText: `${input.title}\n${input.relativePath}\n${input.body}`.toLowerCase(),
    contentHash: input.contentHash,
    isPresent: 'true',
    deletedAt: null,
    deletedByUserId: null,
    scannedAt: new Date(),
    updatedAt: new Date()
  }
  if (input.articleId) {
    const [updated] = await tx
      .update(articles)
      .set(values)
      .where(eq(articles.id, input.articleId))
      .returning({ id: articles.id })
    if (!updated && input.allowCreateWithArticleId) {
      const [created] = await tx.insert(articles).values({
        id: input.articleId,
        ...values
      }).onConflictDoNothing({
        target: [articles.collection, articles.relativePath]
      }).returning({ id: articles.id })
      if (!created) throw new CmsPublishPathError('新文章目标路径或预分配 ID 已存在')
      return created.id
    }
    if (!updated) throw new CmsPublishNotFoundError()
    return updated.id
  }
  const [created] = await tx
    .insert(articles)
    .values(values)
    .onConflictDoNothing({
      target: [articles.collection, articles.relativePath]
    })
    .returning({ id: articles.id })
  if (!created) throw new CmsPublishPathError('新文章目标路径已存在')
  return created.id
}

export const publishCmsDraftGitFirst = async (
  draftId: string,
  operatorUserId: string,
  input: { version: number, relativePath?: string }
): Promise<CmsPublishResult> => {
  const db = getDatabase()
  const revisionShadowEnabled = isCmsRevisionShadowEnabled()
  const [draft] = await db.select().from(drafts).where(and(
    eq(drafts.id, draftId),
    isNull(drafts.deletedAt)
  )).limit(1)
  if (!draft) throw new CmsPublishNotFoundError()
  if (draft.status !== 'approved' || draft.version !== input.version) {
    throw new CmsPublishStateError()
  }
  const [review] = await db
    .select({ actorUserId: reviewEvents.actorUserId })
    .from(reviewEvents)
    .where(and(eq(reviewEvents.draftId, draftId), eq(reviewEvents.action, 'approved')))
    .orderBy(desc(reviewEvents.createdAt))
    .limit(1)
  if (!review?.actorUserId) throw new CmsPublishStateError()
  const authorRows = await db
    .select({ memberKey: members.memberKey })
    .from(draftAuthors)
    .innerJoin(members, eq(draftAuthors.memberId, members.id))
    .where(eq(draftAuthors.draftId, draftId))
    .orderBy(draftAuthors.position)
  const [owner] = await db
    .select({ memberKey: members.memberKey })
    .from(userMembers)
    .innerJoin(members, eq(userMembers.memberId, members.id))
    .where(eq(userMembers.userId, draft.ownerUserId))
    .limit(1)
  const existingArticle = draft.articleId
    ? (await db.select().from(articles).where(eq(articles.id, draft.articleId)).limit(1))[0]
    : null
  if (draft.articleId && !existingArticle) throw new CmsPublishNotFoundError()
  const relativePath = normalizeRelativePath(
    existingArticle?.relativePath
    || input.relativePath
    || suggestCmsArticlePath(
      draft.collection as CmsArticleCollection,
      draft.title,
      draft.id
    )
  )
  if (existingArticle && input.relativePath && relativePath !== existingArticle.relativePath) {
    throw new CmsPublishPathError('现有文章不允许在发布时改名或移动')
  }
  const message = `cms: publish ${draft.collection}/${relativePath}`
  const [attempt] = await db.insert(publishRecords).values({
    draftId,
    articleId: draft.articleId,
    operatorUserId,
    reviewerUserId: review.actorUserId,
    operation: 'publish',
    status: 'pending',
    articlePath: `${draft.collection}/${relativePath}`,
    message,
    metadata: { draftVersion: draft.version }
  }).returning()

  try {
    return await withCmsPublishLock(async () => {
      await prepareCmsGitWorktree()
      if (existingArticle) {
        const currentSource = await readCmsGitArticle(
          draft.collection as CmsArticleCollection,
          relativePath
        )
        if (sha256(currentSource) !== draft.baseContentHash) {
          throw new CmsPublishConflictError()
        }
      } else {
        const { target } = cmsGitArticlePath(
          draft.collection as CmsArticleCollection,
          relativePath
        )
        try {
          await access(target)
          throw new CmsPublishPathError('新文章目标路径已存在')
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error
        }
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
      const written = await atomicWriteCmsGitArticle(
        draft.collection as CmsArticleCollection,
        relativePath,
        built.source
      )
      await runCmsGit(['add', '--', written.gitPath])
      await runCmsGit(['commit', '-m', message, '--', written.gitPath])
      const commitHash = await runCmsGit(['rev-parse', 'HEAD'])
      const config = getCmsGitConfig()
      await runCmsGit(['push', config.CMS_GIT_REMOTE, `HEAD:${config.CMS_GIT_BRANCH}`])
      const contentHash = sha256(built.source)

      const publishedResult = await db.transaction(async (tx) => {
        const resolvedArticleId = await upsertPublishedArticle(tx, {
          articleId: draft.articleId,
          collection: draft.collection as CmsArticleCollection,
          relativePath,
          title: draft.title,
          frontmatter: built.frontmatter,
          body: draft.body,
          contentHash
        })
        const revision = revisionShadowEnabled
          ? await appendCmsArticleRevision(tx, {
              articleId: resolvedArticleId,
              markdownSource: built.source,
              body: draft.body,
              frontmatter: built.frontmatter,
              contentHash,
              sourceKind: 'publish',
              sourceDraftId: draftId,
              publishedByUserId: operatorUserId,
              reviewedByUserId: review.actorUserId,
              sourceOperationId: attempt!.id,
              gitCommitHash: commitHash,
              createdAt: now
            })
          : null
        const [published] = await tx
          .update(drafts)
          .set({
            articleId: resolvedArticleId,
            status: 'published',
            baseContentHash: contentHash,
            ...(revision ? { baseRevisionId: revision.id } : {}),
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
        await tx.update(publishRecords).set({
          articleId: resolvedArticleId,
          status: 'succeeded',
          commitHash,
          completedAt: now
        }).where(eq(publishRecords.id, attempt!.id))
        await tx.insert(auditLogs).values({
          actorUserId: operatorUserId,
          action: 'article.publish',
          targetType: 'article',
          targetId: resolvedArticleId,
          metadata: {
            draftId,
            reviewerUserId: review.actorUserId,
            relativePath,
            commitHash,
            revisionId: revision?.id || null
          }
        })
        return {
          articleId: resolvedArticleId,
          revisionId: revision?.id || null,
          revisionNumber: revision?.revisionNumber || null
        }
      })
      return {
        articleId: publishedResult.articleId,
        collection: draft.collection as CmsArticleCollection,
        relativePath,
        commitHash,
        revisionId: publishedResult.revisionId,
        revisionNumber: publishedResult.revisionNumber,
        exportStatus: 'not_applicable',
        publishedAt: now.toISOString()
      }
    })
  } catch (error) {
    try {
      await withCmsPublishLock(resetCmsGitWorktree)
    } catch {
      // 原始失败原因优先保留；下次发布会再次验证工作区状态。
    }
    await db.update(publishRecords).set({
      status: 'failed',
      failureReason: describeCmsFailure(error),
      completedAt: new Date()
    }).where(eq(publishRecords.id, attempt!.id))
    if (
      error instanceof CmsPublishConflictError
      || error instanceof CmsPublishPathError
      || error instanceof CmsPublishStateError
    ) {
      throw error
    }
    throw new CmsPublishGitError(describeCmsFailure(error))
  }
}
