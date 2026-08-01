import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import type {
  CmsDraft,
  CmsDraftAuthor,
  CmsDraftSaveInput,
  CmsDraftStatus,
  CmsDraftSummary
} from '../../shared/types/cms-drafts'
import { assessMarkdownVisualSafety } from '../../shared/utils/cms-markdown-safety'
import { getDatabase } from '../db/client'
import {
  auditLogs,
  draftAuthors,
  drafts,
  editLocks,
  members,
  userMembers,
  users
} from '../db/schema'
import { getCmsArticle } from './cms-articles'
import { assertCmsDraftEditLease } from './cms-edit-locks'

export class CmsDraftConflictError extends Error {
  constructor() {
    super('DRAFT_VERSION_CONFLICT')
  }
}

export class CmsDraftNotFoundError extends Error {
  constructor() {
    super('DRAFT_NOT_FOUND')
  }
}

export class CmsDraftStateError extends Error {
  constructor() {
    super('DRAFT_STATE_INVALID')
  }
}

const editableFrontmatterKeys = new Set(['title', 'description', 'authors'])

const preserveFrontmatter = (frontmatter: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !editableFrontmatterKeys.has(key))
  )

const systemFrontmatterFrom = (frontmatter: Record<string, unknown>) => ({
  contributors: frontmatter.contributors ?? null,
  updatedAt: frontmatter.updatedAt ?? null,
  publishedAt: frontmatter.publishedAt ?? null
})

const loadDraftAuthors = async (draftIds: string[]) => {
  const byDraft = new Map<string, CmsDraftAuthor[]>()
  if (!draftIds.length) return byDraft

  const rows = await getDatabase()
    .select({
      draftId: draftAuthors.draftId,
      memberId: members.id,
      memberKey: members.memberKey,
      name: members.name,
      avatarUrl: members.avatarUrl
    })
    .from(draftAuthors)
    .innerJoin(members, eq(draftAuthors.memberId, members.id))
    .where(inArray(draftAuthors.draftId, draftIds))
    .orderBy(asc(draftAuthors.draftId), asc(draftAuthors.position))

  for (const row of rows) {
    const current = byDraft.get(row.draftId) || []
    current.push({
      memberId: row.memberId,
      memberKey: row.memberKey,
      name: row.name,
      avatarUrl: row.avatarUrl
    })
    byDraft.set(row.draftId, current)
  }
  return byDraft
}

const rowsToDrafts = async (rows: Array<typeof drafts.$inferSelect>): Promise<CmsDraft[]> => {
  const authors = await loadDraftAuthors(rows.map(row => row.id))
  return rows.map(row => ({
    id: row.id,
    articleId: row.articleId,
    ownerUserId: row.ownerUserId,
    collection: row.collection as CmsArticleCollection,
    title: row.title,
    description: row.description,
    body: row.body,
    authors: authors.get(row.id) || [],
    preservedFrontmatter: row.preservedFrontmatter,
    systemFrontmatter: systemFrontmatterFrom(row.preservedFrontmatter),
    baseContentHash: row.baseContentHash,
    baseRevisionId: row.baseRevisionId,
    proposedAction: row.proposedAction as CmsDraft['proposedAction'],
    proposedRelativePath: row.proposedRelativePath,
    proposedArticleId: row.proposedArticleId,
    status: row.status as CmsDraftStatus,
    isDeleted: Boolean(row.deletedAt),
    deletedAt: row.deletedAt?.toISOString() || null,
    version: row.version,
    visualMode: assessMarkdownVisualSafety(row.body),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSavedAt: row.lastSavedAt.toISOString()
  }))
}

const loadDraftRow = async (
  draftId: string,
  requesterUserId: string,
  allowAdmin = false
) => {
  const [row] = await getDatabase()
    .select()
    .from(drafts)
    .where(and(
      eq(drafts.id, draftId),
      isNull(drafts.deletedAt),
      ...(allowAdmin ? [] : [eq(drafts.ownerUserId, requesterUserId)])
    ))
    .limit(1)
  return row || null
}

const resolveAuthorMembers = async (authorKeys: string[]) => {
  const keys = [...new Set(authorKeys.map(key => key.trim().toLowerCase()))]
  if (!keys.length) return []

  const rows = await getDatabase()
    .select({ id: members.id, memberKey: members.memberKey })
    .from(members)
    .where(inArray(members.memberKey, keys))
  const byKey = new Map(rows.map(row => [row.memberKey, row]))
  if (rows.length !== keys.length) {
    const missing = keys.filter(key => !byKey.has(key))
    throw new Error(`UNKNOWN_DRAFT_AUTHORS:${missing.join(',')}`)
  }
  return keys.map(key => byKey.get(key)!)
}

const currentMemberKey = async (userId: string) => {
  const [row] = await getDatabase()
    .select({ memberKey: members.memberKey })
    .from(userMembers)
    .innerJoin(members, eq(userMembers.memberId, members.id))
    .where(eq(userMembers.userId, userId))
    .limit(1)
  return row?.memberKey
}

const replaceDraftAuthors = async (
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  draftId: string,
  authorKeys: string[]
) => {
  const resolved = await resolveAuthorMembers(authorKeys)
  await tx.delete(draftAuthors).where(eq(draftAuthors.draftId, draftId))
  if (resolved.length) {
    await tx.insert(draftAuthors).values(resolved.map((member, position) => ({
      draftId,
      memberId: member.id,
      position
    })))
  }
}

export const getCmsDraft = async (
  draftId: string,
  requesterUserId: string,
  allowAdmin = false
) => {
  const row = await loadDraftRow(draftId, requesterUserId, allowAdmin)
  return row ? (await rowsToDrafts([row]))[0]! : null
}

export const getCmsDraftForReview = async (draftId: string) => {
  const [row] = await getDatabase()
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), isNull(drafts.deletedAt)))
    .limit(1)
  return row ? (await rowsToDrafts([row]))[0]! : null
}

export const findCmsDraftForArticle = async (
  articleId: string,
  ownerUserId: string
) => {
  const [row] = await getDatabase()
    .select()
    .from(drafts)
    .where(and(
      eq(drafts.articleId, articleId),
      eq(drafts.ownerUserId, ownerUserId),
      isNull(drafts.deletedAt)
    ))
    .limit(1)
  return row ? (await rowsToDrafts([row]))[0]! : null
}

export const listCmsDrafts = async (
  ownerUserId: string,
  input: { status?: CmsDraftStatus, deleted?: boolean } = {},
  allowAll = false
): Promise<CmsDraftSummary[]> => {
  const filters = allowAll ? [] : [eq(drafts.ownerUserId, ownerUserId)]
  filters.push(input.deleted ? isNotNull(drafts.deletedAt) : isNull(drafts.deletedAt))
  if (input.status) filters.push(eq(drafts.status, input.status))
  const rows = await getDatabase()
    .select({ draft: drafts, ownerAccount: users.account })
    .from(drafts)
    .innerJoin(users, eq(drafts.ownerUserId, users.id))
    .where(and(...filters))
    .orderBy(desc(drafts.updatedAt))
  return rows.map(({ draft: row, ownerAccount }) => ({
    id: row.id,
    articleId: row.articleId,
    ownerUserId: row.ownerUserId,
    ownerAccount,
    collection: row.collection as CmsArticleCollection,
    title: row.title,
    proposedAction: row.proposedAction as CmsDraftSummary['proposedAction'],
    proposedRelativePath: row.proposedRelativePath,
    status: row.status as CmsDraftStatus,
    isDeleted: Boolean(row.deletedAt),
    deletedAt: row.deletedAt?.toISOString() || null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  }))
}

export class CmsDraftDeleteConflictError extends Error {
  constructor(message = 'DRAFT_DELETE_CONFLICT') {
    super(message)
  }
}

export const deleteCmsDraft = async (
  draftId: string,
  actorUserId: string,
  allowAdmin = false
) => {
  const db = getDatabase()
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(drafts)
      .where(and(
        eq(drafts.id, draftId),
        isNull(drafts.deletedAt),
        ...(allowAdmin ? [] : [eq(drafts.ownerUserId, actorUserId)])
      ))
      .limit(1)
    if (!current) throw new CmsDraftNotFoundError()
    const now = new Date()
    const [deleted] = await tx
      .update(drafts)
      .set({ deletedAt: now, deletedByUserId: actorUserId, updatedAt: now })
      .where(and(eq(drafts.id, draftId), isNull(drafts.deletedAt)))
      .returning({ id: drafts.id })
    if (!deleted) throw new CmsDraftDeleteConflictError()
    await tx.delete(editLocks).where(and(
      eq(editLocks.targetType, current.articleId ? 'article' : 'draft'),
      eq(editLocks.targetId, current.articleId || current.id),
      or(
        eq(editLocks.holderUserId, current.ownerUserId),
        eq(editLocks.holderUserId, actorUserId)
      )
    ))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'draft.delete',
      targetType: 'draft',
      targetId: draftId,
      metadata: {
        ownerUserId: current.ownerUserId,
        articleId: current.articleId,
        status: current.status
      }
    })
    return { id: draftId, deletedAt: now.toISOString() }
  })
}

export const restoreCmsDraft = async (
  draftId: string,
  actorUserId: string,
  allowAdmin = false
) => {
  const db = getDatabase()
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(drafts)
        .where(and(
          eq(drafts.id, draftId),
          isNotNull(drafts.deletedAt),
          ...(allowAdmin ? [] : [eq(drafts.ownerUserId, actorUserId)])
        ))
        .limit(1)
      if (!current) throw new CmsDraftNotFoundError()
      const [restored] = await tx
        .update(drafts)
        .set({ deletedAt: null, deletedByUserId: null, updatedAt: new Date() })
        .where(and(eq(drafts.id, draftId), isNotNull(drafts.deletedAt)))
        .returning()
      if (!restored) throw new CmsDraftDeleteConflictError()
      await tx.insert(auditLogs).values({
        actorUserId,
        action: 'draft.restore',
        targetType: 'draft',
        targetId: draftId,
        metadata: {
          ownerUserId: current.ownerUserId,
          articleId: current.articleId,
          status: current.status
        }
      })
      return (await rowsToDrafts([restored]))[0]!
    })
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new CmsDraftDeleteConflictError('该文章已有活动草稿，无法恢复此草稿')
    }
    throw error
  }
}

export const createCmsDraftForArticle = async (
  articleId: string,
  ownerUserId: string
) => {
  const existing = await findCmsDraftForArticle(articleId, ownerUserId)
  if (existing && existing.status !== 'published') return existing
  if (existing?.status === 'published') {
    const [reopened] = await getDatabase().transaction(async (tx) => {
      const result = await tx
        .update(drafts)
        .set({
          status: 'draft',
          version: sql`${drafts.version} + 1`,
          lastSavedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(
          eq(drafts.id, existing.id),
          eq(drafts.ownerUserId, ownerUserId),
          eq(drafts.status, 'published')
        ))
        .returning()
      if (!result[0]) throw new CmsDraftConflictError()
      await tx.insert(auditLogs).values({
        actorUserId: ownerUserId,
        action: 'draft.reopen_after_publish',
        targetType: 'draft',
        targetId: existing.id,
        metadata: {
          articleId,
          baseContentHash: existing.baseContentHash,
          baseRevisionId: existing.baseRevisionId
        }
      })
      return result
    })
    return (await rowsToDrafts([reopened!]))[0]!
  }

  const article = await getCmsArticle(articleId)
  if (!article) throw new Error('ARTICLE_NOT_FOUND')
  const frontmatter = article.frontmatter
  const authorKeys = Array.isArray(frontmatter.authors)
    ? frontmatter.authors.filter(value => typeof value === 'string') as string[]
    : []

  try {
    const [created] = await getDatabase().transaction(async (tx) => {
      const result = await tx.insert(drafts).values({
        articleId,
        ownerUserId,
        collection: article.collection,
        title: article.title,
        description: typeof frontmatter.description === 'string'
          ? frontmatter.description
          : '',
        body: article.body,
        preservedFrontmatter: preserveFrontmatter(frontmatter),
        baseContentHash: article.contentHash,
        baseRevisionId: article.currentRevision?.id || null
      }).returning()
      await replaceDraftAuthors(tx, result[0]!.id, authorKeys)
      await tx.insert(auditLogs).values({
        actorUserId: ownerUserId,
        action: 'draft.create',
        targetType: 'draft',
        targetId: result[0]!.id,
        metadata: {
          articleId,
          baseContentHash: article.contentHash,
          baseRevisionId: article.currentRevision?.id || null
        }
      })
      return result
    })
    return (await rowsToDrafts([created!]))[0]!
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '23505'
    ) {
      const concurrent = await findCmsDraftForArticle(articleId, ownerUserId)
      if (concurrent) return concurrent
    }
    throw error
  }
}

export const createCmsNewArticleDraft = async (
  collection: CmsArticleCollection,
  title: string,
  ownerUserId: string
) => {
  const defaultAuthor = await currentMemberKey(ownerUserId)
  const [created] = await getDatabase().transaction(async (tx) => {
    const result = await tx.insert(drafts).values({
      articleId: null,
      ownerUserId,
      collection,
      title: title.trim(),
      description: '',
      body: '',
      preservedFrontmatter: {},
      baseContentHash: null
    }).returning()
    await replaceDraftAuthors(tx, result[0]!.id, defaultAuthor ? [defaultAuthor] : [])
    await tx.insert(auditLogs).values({
      actorUserId: ownerUserId,
      action: 'draft.create',
      targetType: 'draft',
      targetId: result[0]!.id,
      metadata: { articleId: null, collection }
    })
    return result
  })
  return (await rowsToDrafts([created!]))[0]!
}

export const saveCmsDraft = async (
  draftId: string,
  requesterUserId: string,
  input: CmsDraftSaveInput,
  allowAdmin = false
) => {
  if (!await loadDraftRow(draftId, requesterUserId, allowAdmin)) {
    throw new CmsDraftNotFoundError()
  }
  const authorKeys = [...new Set(input.authorKeys)]
  await resolveAuthorMembers(authorKeys)

  const updated = await getDatabase().transaction(async (tx) => {
    await assertCmsDraftEditLease(tx, draftId, requesterUserId, input.lockLeaseId)
    const [row] = await tx
      .update(drafts)
      .set({
        title: input.title.trim(),
        description: input.description.trim(),
        body: input.body,
        version: sql`${drafts.version} + 1`,
        lastSavedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(drafts.id, draftId),
        ...(allowAdmin ? [] : [eq(drafts.ownerUserId, requesterUserId)]),
        eq(drafts.status, 'draft'),
        eq(drafts.version, input.version)
      ))
      .returning()
    if (!row) {
      const [current] = await tx
        .select({ status: drafts.status, version: drafts.version })
        .from(drafts)
        .where(eq(drafts.id, draftId))
        .limit(1)
      if (current && current.status !== 'draft') throw new CmsDraftStateError()
      throw new CmsDraftConflictError()
    }
    await replaceDraftAuthors(tx, draftId, authorKeys)
    return row
  })

  return (await rowsToDrafts([updated]))[0]!
}
